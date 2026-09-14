/**
 * cloud — every write the app makes to the household's shared copy.
 *
 * Pure functions: each takes exactly what it writes and returns a verdict. No
 * store reads, no retries, no swallowed errors — the outbox decides what to do
 * with a failure, and the person who made the change is told about it.
 *
 * What this replaces: the item column set used to be spelled out in seven
 * places that disagreed; nine writes were fire-and-forget IIFEs with empty
 * catches, so a refused change looked exactly like a saved one on the device
 * that made it (photos, heirs and decisions all failed that way in practice).
 *
 * Identity is by user id. Display names ride along only as caches for other
 * devices to show (`decided_by_name`, `created_by_name`, `author_name`); the
 * database's triggers stamp and check the ids that matter.
 */

import type { Collection, Decision, HeirVisibility, Item, ItemMessage, Person, Room } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export type CloudResult =
  | { ok: true }
  | {
      ok: false;
      /** True when trying again later could succeed (network, expired token). */
      retry: boolean;
      /** A sentence a family member can read. */
      error: string;
      /** Postgres / PostgREST code, for diagnostics. */
      code?: string;
    };

const OK: CloudResult = { ok: true };

type PgError = { message: string; code?: string; details?: string | null; hint?: string | null };

/**
 * Sort a failure into "try again later" or "this will never work".
 *
 * Only transient faults are retryable. A refusal — row-level security, a
 * trigger saying only the owner may decide — is final: retrying it forever is
 * how a queue silently fills with changes that can never land.
 */
export function classify(error: PgError | null | undefined, thrown?: unknown): CloudResult {
  if (!error && !thrown) return OK;
  if (thrown) {
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, retry: true, error: /fetch|network|offline|timed? ?out/i.test(msg) ? 'No connection.' : msg };
  }
  const e = error!;
  const msg = e.message ?? 'Unknown error';
  if (/fetch|network|timed? ?out/i.test(msg)) return { ok: false, retry: true, error: 'No connection.', code: e.code };
  if (e.code === 'PGRST301' || /jwt expired/i.test(msg)) {
    return { ok: false, retry: true, error: 'Signing in again…', code: e.code };
  }
  if (e.code === '42501' || /row-level security/i.test(msg)) {
    return { ok: false, retry: false, error: 'You don’t have permission to change that.', code: e.code };
  }
  if (e.code === 'P0001') return { ok: false, retry: false, error: humanize(msg), code: e.code };
  if (e.code?.startsWith('08') || e.code?.startsWith('57') || e.code === '40001') {
    return { ok: false, retry: true, error: 'The server was busy.', code: e.code };
  }
  return { ok: false, retry: false, error: humanize(msg), code: e.code };
}

/** The database's own refusals, in words. */
function humanize(message: string): string {
  if (/only the household owner may decide/i.test(message)) return 'Only someone with the final say can decide items.';
  if (/only the household owner may set an item's main decider/i.test(message)) {
    return 'Only someone with the final say can choose whose call an item is.';
  }
  if (/main decider must be an active decider/i.test(message)) {
    return 'That person needs to join before they can be an item’s main decider.';
  }
  if (/immutable/i.test(message)) return 'That can’t be changed once it’s saved.';
  return message;
}

/**
 * Delete or update rows, and tell "nothing to change" apart from "not allowed
 * to change it". Row-level security answers both with zero affected rows; the
 * difference is whether the row can still be SEEN afterwards (members can read
 * their household's rows). `refusal` is what the person is told.
 */
async function writeChecked(
  table: string,
  write: () => PromiseLike<{ data: unknown[] | null; error: PgError | null }>,
  stillThere: () => PromiseLike<{ data: unknown | null; error: PgError | null }>,
  refusal: string
): Promise<CloudResult> {
  try {
    const { data, error } = await write();
    const res = classify(error);
    if (!res.ok) return res;
    if (data?.length) return OK;
    const { data: row, error: readErr } = await stillThere();
    const readRes = classify(readErr);
    if (!readRes.ok) return readRes;
    return row ? { ok: false, retry: false, error: refusal } : OK;
  } catch (e) {
    return classify(null, e);
  }
}

async function run(q: PromiseLike<{ error: PgError | null }>): Promise<CloudResult> {
  try {
    const { error } = await q;
    return classify(error);
  } catch (e) {
    return classify(null, e);
  }
}

/* ------------------------------------------------------------------ items */

/**
 * THE column set for an item row. Every item write builds its row here, so a
 * newly synced field is a one-line change.
 *
 * `decider` = the writer holds the final say in this household. A helper's
 * row never carries a decision or a main decider (items_guard would refuse
 * the whole write), and decided_by/decided_at are stamped by the trigger.
 */
export function itemColumns(item: Item, decider: boolean) {
  const decided = decider && item.decision !== 'undecided';
  return {
    title: item.title,
    room: item.room || null,
    collection_id: item.collectionId ?? null,
    market_value_cents: item.marketValue != null ? Math.round(item.marketValue * 100) : null,
    is_sentimental: item.isSentimental,
    donate_to: item.donateTo ?? null,
    donate_to_kind: item.donateToKind ?? null,
    archived: item.archived ?? false,
    ...(decider
      ? {
          decision: item.decision as Decision,
          decided_by_name: decided ? (item.decidedBy ?? null) : null,
          main_decider: item.mainDeciderId ?? null,
          main_decider_name: item.mainDeciderName ?? null,
        }
      : {}),
  };
}

/**
 * Create an item. Idempotent: an item that already exists is left alone (an
 * edit to it travels as `updateItem`), so replaying a queued create after a
 * lost response can't overwrite a newer change.
 */
export async function createItem(
  item: Item,
  householdId: string,
  userId: string,
  decider: boolean
): Promise<CloudResult> {
  const row = {
    id: item.id,
    household_id: householdId,
    created_by: userId,
    created_at: item.createdAt,
    ...itemColumns(item, decider),
    // A helper's capture is always undecided on the way in.
    ...(decider ? {} : { decision: 'undecided' as Decision }),
  };
  const res = await run(supabase.from('items').upsert(row, { onConflict: 'id', ignoreDuplicates: true }));
  if (!res.ok) return res;
  return replaceItemExtras(item, userId, decider, {
    tags: item.tags.length > 0,
    story: Boolean(item.story?.transcript),
    heir: decider && Boolean(item.heirPersonId),
  });
}

/** Which parts of an item an edit touched. */
export interface ItemParts {
  tags?: boolean;
  story?: boolean;
  heir?: boolean;
  /**
   * The decision (or whose call it is) changed. Only someone with the final
   * say may send that; the outbox refuses it for anyone else rather than
   * quietly dropping the decision from the update and reporting success.
   */
  decision?: boolean;
}

/**
 * Update an existing item. An UPDATE, never an upsert: if another device
 * deleted the item a moment ago, this must not bring it back — so "no row
 * matched" is success with nothing to do.
 */
export async function updateItem(
  item: Item,
  householdId: string,
  userId: string,
  decider: boolean,
  parts: ItemParts
): Promise<CloudResult> {
  try {
    const { data, error } = await supabase
      .from('items')
      .update(itemColumns(item, decider))
      .eq('id', item.id)
      .eq('household_id', householdId)
      .select('id');
    const res = classify(error);
    if (!res.ok) return res;
    if (!data?.length) {
      // No row matched. That means one of two very different things: the item
      // was deleted elsewhere (nothing to do), or it exists and RLS won't let
      // this person change it (they must be told). Row-level security reports
      // both as silence, so look.
      const { data: still, error: readErr } = await supabase
        .from('items')
        .select('id')
        .eq('id', item.id)
        .eq('household_id', householdId)
        .maybeSingle();
      const readRes = classify(readErr);
      if (!readRes.ok) return readRes;
      return still
        ? { ok: false, retry: false, error: 'You don’t have permission to change that item.' }
        : OK;
    }
  } catch (e) {
    return classify(null, e);
  }
  return replaceItemExtras(item, userId, decider, parts);
}

/**
 * Tags, the story and (for deciders) the heir assignment ride with the item —
 * but only the parts that changed. A story is replaced only when it was edited:
 * a helper may add a story to any item but only delete their own, so blindly
 * "replacing" on every edit would pile up copies of someone else's.
 */
async function replaceItemExtras(
  item: Item,
  userId: string,
  decider: boolean,
  parts: ItemParts
): Promise<CloudResult> {
  let res: CloudResult = OK;
  if (parts.tags) {
    res = await run(supabase.from('item_tags').delete().eq('item_id', item.id));
    if (!res.ok) return res;
    if (item.tags.length) {
      res = await run(supabase.from('item_tags').insert(item.tags.map((tag) => ({ item_id: item.id, tag }))));
      if (!res.ok) return res;
    }
  }

  if (parts.story && item.story?.transcript) {
    res = await run(supabase.from('stories').delete().eq('item_id', item.id));
    if (!res.ok) return res;
    res = await run(
      supabase.from('stories').insert({
        item_id: item.id,
        transcript: item.story.transcript,
        created_by: userId,
        created_at: item.story.createdAt,
      })
    );
    if (!res.ok) return res;
  }

  if (parts.heir && decider) {
    res = item.heirPersonId
      ? await setHeir(item.id, item.heirPersonId, item.heirVisibility)
      : await run(supabase.from('heir_assignments').delete().eq('item_id', item.id));
    if (!res.ok) return res;
  }
  return OK;
}

export async function deleteItem(itemId: string, householdId: string): Promise<CloudResult> {
  return writeChecked(
    'items',
    () => supabase.from('items').delete().eq('id', itemId).eq('household_id', householdId).select('id'),
    () => supabase.from('items').select('id').eq('id', itemId).maybeSingle(),
    'Only an administrator, an owner, or whoever added it (before it’s decided) can remove that item.'
  );
}

/** Heir assignments are their own RLS-hidden rows (0014), never item columns. */
export async function setHeir(
  itemId: string,
  personId: string,
  visibility: HeirVisibility
): Promise<CloudResult> {
  return run(
    supabase
      .from('heir_assignments')
      .upsert({ item_id: itemId, person_id: personId, visibility }, { onConflict: 'item_id' })
  );
}

/* ------------------------------------------------------------------ chat */

export async function createMessage(message: ItemMessage, userId: string): Promise<CloudResult> {
  // household_id is stamped from the item by the database (017).
  return run(
    supabase.from('item_messages').upsert(
      {
        id: message.id,
        item_id: message.itemId,
        author: userId,
        author_name: message.author,
        body: message.text,
        created_at: message.createdAt,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
  );
}

/* ------------------------------------------------------------------ rooms */

/**
 * Add or edit a room. Rooms are addressed by name (items.room is text), so a
 * rename carries `previousName`: without it "Study" → "Office" would insert
 * Office and strand Study.
 */
export async function upsertRoom(
  room: Room,
  householdId: string,
  userId: string,
  previousName?: string
): Promise<CloudResult> {
  const fields = { name: room.name, floor: room.floor ?? null, location_note: room.locationNote ?? null };
  if (previousName && previousName !== room.name) {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .update(fields)
        .eq('household_id', householdId)
        .eq('name', previousName)
        .select('id');
      const res = classify(error);
      if (!res.ok) return res;
      if (data?.length) return OK;
    } catch (e) {
      return classify(null, e);
    }
  }
  return run(
    supabase.from('rooms').upsert(
      { household_id: householdId, ...fields, created_by: userId, created_by_name: room.createdBy || null },
      { onConflict: 'household_id,name' }
    )
  );
}

export async function deleteRoom(name: string, householdId: string): Promise<CloudResult> {
  return writeChecked(
    'rooms',
    () => supabase.from('rooms').delete().eq('household_id', householdId).eq('name', name).select('id'),
    () => supabase.from('rooms').select('id').eq('household_id', householdId).eq('name', name).maybeSingle(),
    'Only an administrator, an owner, or whoever added it can remove that room.'
  );
}

/* ------------------------------------------------------------------ collections */

export async function upsertCollection(
  collection: Collection,
  householdId: string,
  userId: string
): Promise<CloudResult> {
  try {
    const { data, error } = await supabase
      .from('collections')
      .update({ name: collection.name, note: collection.note ?? null })
      .eq('id', collection.id)
      .select('id');
    const res = classify(error);
    if (!res.ok) return res;
    if (data?.length) return OK;
  } catch (e) {
    return classify(null, e);
  }
  return run(
    supabase.from('collections').upsert(
      {
        id: collection.id,
        household_id: householdId,
        name: collection.name,
        note: collection.note ?? null,
        created_by: userId,
        created_by_name: collection.createdBy || null,
        created_at: collection.createdAt,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
  );
}

export async function deleteCollection(id: string, householdId: string): Promise<CloudResult> {
  return writeChecked(
    'collections',
    () => supabase.from('collections').delete().eq('id', id).eq('household_id', householdId).select('id'),
    () => supabase.from('collections').select('id').eq('id', id).maybeSingle(),
    'You don’t have permission to remove that collection.'
  );
}

/* ------------------------------------------------------------------ people (heirs) */

export async function upsertPerson(person: Person, householdId: string): Promise<CloudResult> {
  return run(
    supabase.from('people').upsert({
      id: person.id,
      household_id: householdId,
      display_name: person.displayName,
      relationship: person.relationship || null,
    })
  );
}

export async function deletePerson(id: string, householdId: string): Promise<CloudResult> {
  return writeChecked(
    'people',
    () => supabase.from('people').delete().eq('id', id).eq('household_id', householdId).select('id'),
    () => supabase.from('people').select('id').eq('id', id).maybeSingle(),
    'Only someone with the final say can remove an heir.'
  );
}

/* ------------------------------------------------------------------ household */

export async function renameHousehold(householdId: string, name: string): Promise<CloudResult> {
  return writeChecked(
    'households',
    () => supabase.from('households').update({ name }).eq('id', householdId).select('id'),
    () => supabase.from('households').select('id').eq('id', householdId).maybeSingle(),
    'Only an owner can rename this home.'
  );
}
