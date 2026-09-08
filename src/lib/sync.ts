/**
 * Cloud sync — v2: non-destructive UPSERT sync.
 *
 * Local ids are UUIDs shared with the cloud, so devices merge instead of
 * clobbering: the owner pushes everything; contributors push only their own
 * new (undecided) items; pulls merge cloud state over local while keeping
 * local-only additions. Nothing is bulk-deleted, ever.
 *
 * Contracts:
 * - `localOnly` items NEVER leave the device.
 * - Decision fields are only pushed by owners/co-owners (the DB's items_guard
 *   enforces this server-side regardless).
 * - Photos upload separately (see photo-sync); this module syncs the catalog
 *   and carries `remotePhotoPath` back on pulls.
 */

import type { Item, ItemMessage, Member, Person } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export interface SyncInput {
  cloudHouseholdId?: string;
  activeHouseholdId: string;
  householdName: string;
  items: Item[];
  people: Person[];
  messages: ItemMessage[];
  members: Member[];
  deciderNames: string[];
  userName: string;
}

export interface SyncResult {
  ok: boolean;
  cloudHouseholdId?: string;
  role?: 'owner' | 'co_owner' | 'contributor';
  itemsPushed?: number;
  skippedLocalOnly?: number;
  error?: string;
}

/** The caller's role in a cloud household ('none' if not a member). */
export async function cloudRole(
  hid: string
): Promise<'owner' | 'co_owner' | 'contributor' | 'executor' | 'none'> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return 'none';
  const { data } = await supabase
    .from('household_members')
    .select('role,status')
    .eq('household_id', hid)
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle();
  return (data?.role as 'owner' | 'co_owner' | 'contributor' | 'executor') ?? 'none';
}

export async function pushHousehold(input: SyncInput): Promise<SyncResult> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: 'Not signed in.' };

  try {
    // 1. Ensure the cloud household exists (local id doubles as cloud id).
    let hid = input.cloudHouseholdId;
    if (hid) {
      const { data: existing } = await supabase
        .from('households')
        .select('id')
        .eq('id', hid)
        .maybeSingle();
      if (!existing) {
        // We were linked to a cloud household that no longer exists — it was
        // merged or deleted on the server. Falling through to the create path
        // below would mint a fresh duplicate under activeHouseholdId and
        // re-push our stale local items: exactly how the second "Millrun"
        // household appeared. Refuse instead and steer the user to Restore,
        // which repoints this device at the surviving household before it
        // backs up again.
        return {
          ok: false,
          error:
            'This household is no longer in the cloud — it was moved or removed elsewhere. ' +
            'Open Account & sync and tap “Restore from my backup” to reconnect this device, then back up again.',
        };
      }
    }
    if (!hid) {
      // First backup of a household that has never reached the cloud: create
      // it. Reaching here means we were never linked (cloudHouseholdId unset),
      // not that a known link went missing — that case returned above.
      hid = input.activeHouseholdId;
      const { data: existing } = await supabase
        .from('households')
        .select('id')
        .eq('id', hid)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase.from('households').insert({ id: hid, name: input.householdName });
        if (error) throw error;
      }
    }

    const role = await cloudRole(hid);
    if (role === 'none') {
      return { ok: false, error: 'You are not a member of this household in the cloud.' };
    }
    const isOwner = role === 'owner' || role === 'co_owner';

    if (isOwner) {
      await supabase.from('households').update({ name: input.householdName }).eq('id', hid);
    }

    // 2. People (heirs) — owner maintains; upsert by id.
    if (isOwner && input.people.length) {
      const { error } = await supabase.from('people').upsert(
        input.people.map((p) => ({
          id: p.id,
          household_id: hid,
          display_name: p.displayName,
          relationship: p.relationship || null,
        }))
      );
      if (error) throw error;
    }

    // 3. Items. Owners push all; contributors only INSERT their own new,
    //    undecided items (server triggers would reject more anyway).
    const uploadable = input.items.filter((i) => !i.localOnly);
    const skipped = input.items.length - uploadable.length;
    const mine = isOwner
      ? uploadable
      : uploadable.filter((i) => i.addedBy === input.userName && i.decision === 'undecided');

    if (mine.length) {
      const rows = mine.map((i) => ({
        id: i.id,
        household_id: hid,
        created_by: user.id,
        title: i.title,
        room: i.room || null,
        decision: isOwner ? i.decision : 'undecided',
        decided_by: isOwner && i.decision !== 'undecided' ? user.id : null,
        decided_by_name: isOwner && i.decision !== 'undecided' ? (i.decidedBy ?? null) : null,
        decided_at:
          isOwner && i.decision !== 'undecided'
            ? (i.decidedAt ?? new Date().toISOString())
            : null,
        market_value_cents: i.marketValue != null ? Math.round(i.marketValue * 100) : null,
        is_sentimental: i.isSentimental,
        donate_to: i.donateTo ?? null,
        donate_to_kind: i.donateToKind ?? null,
        archived: i.archived ?? false,
        created_at: i.createdAt,
      }));
      const { error } = await supabase
        .from('items')
        .upsert(rows, { ignoreDuplicates: !isOwner });
      if (error) throw error;

      // Tags: replace per pushed item (tiny sets).
      const ids = mine.map((i) => i.id);
      await supabase.from('item_tags').delete().in('item_id', ids);
      const tagRows = mine.flatMap((i) => i.tags.map((tag) => ({ item_id: i.id, tag })));
      if (tagRows.length) {
        const { error: tagErr } = await supabase.from('item_tags').insert(tagRows);
        if (tagErr) throw tagErr;
      }

      // Stories: replace per pushed item.
      const withStory = mine.filter((i) => i.story);
      if (withStory.length) {
        await supabase.from('stories').delete().in('item_id', withStory.map((i) => i.id));
        const { error: stErr } = await supabase.from('stories').insert(
          withStory.map((i) => ({
            item_id: i.id,
            transcript: i.story!.transcript,
            created_by: user.id,
            created_at: i.story!.createdAt,
          }))
        );
        if (stErr) throw stErr;
      }
    }

    // 4. Chat: insert-only, ids are stable → ignore duplicates.
    const pushableItemIds = new Set(uploadable.map((i) => i.id));
    const msgRows = input.messages
      .filter((m) => pushableItemIds.has(m.itemId))
      .map((m) => ({
        id: m.id,
        item_id: m.itemId,
        author: user.id,
        author_name: m.author,
        body: m.text,
        created_at: m.createdAt,
      }));
    if (msgRows.length) {
      const { error } = await supabase
        .from('item_messages')
        .upsert(msgRows, { ignoreDuplicates: true });
      if (error) throw error;
    }

    // 5. Roster mirror (owner only; name-keyed upsert).
    if (isOwner && input.members.length) {
      const { error } = await supabase.from('roster_entries').upsert(
        input.members.map((m) => ({
          household_id: hid,
          name: m.name,
          relationship: m.relationship || null,
          status: m.status,
          is_decider: input.deciderNames.includes(m.name),
          invited_by_name: m.invitedBy,
          invited_email: m.email ?? null,
        })),
        { onConflict: 'household_id,name' }
      );
      if (error) throw error;
    }

    return {
      ok: true,
      cloudHouseholdId: hid,
      role: isOwner ? (role as 'owner' | 'co_owner') : 'contributor',
      itemsPushed: mine.length,
      skippedLocalOnly: skipped,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface PullResult {
  ok: boolean;
  snapshot?: {
    householdName: string;
    deciderNames: string[];
    createdBy: string;
    cloudHouseholdId: string;
    items: Item[];
    people: Person[];
    messages: ItemMessage[];
    members: Member[];
    /** Ids of items this account captured — the store restores their addedBy. */
    selfItemIds: string[];
  };
  error?: string;
}

/** Pull a household (by id, or the user's first) into local shape. */
export async function pullHousehold(householdId?: string): Promise<PullResult> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: 'Not signed in.' };

  try {
    const hhQuery = supabase.from('households').select('id, name');
    const { data: hh, error: hhErr } = householdId
      ? await hhQuery.eq('id', householdId).maybeSingle()
      : await hhQuery.order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (hhErr) throw hhErr;
    if (!hh) return { ok: false, error: 'No household found on this account yet.' };

    const [items, tags, stories, people, roster, photos] = await Promise.all([
      supabase.from('items').select('*').eq('household_id', hh.id),
      supabase.from('item_tags').select('*'),
      supabase.from('stories').select('*'),
      supabase.from('people').select('*').eq('household_id', hh.id),
      supabase.from('roster_entries').select('*').eq('household_id', hh.id),
      supabase.from('item_photos').select('item_id, storage_path, is_primary, created_at'),
    ]);
    for (const r of [items, tags, stories, people, roster, photos]) if (r.error) throw r.error;

    const itemIds = (items.data ?? []).map((i) => i.id);
    const { data: msgs, error: msgErr } = itemIds.length
      ? await supabase.from('item_messages').select('*').in('item_id', itemIds)
      : { data: [], error: null };
    if (msgErr) throw msgErr;

    const tagsByItem = new Map<string, string[]>();
    (tags.data ?? []).forEach((t) => {
      tagsByItem.set(t.item_id, [...(tagsByItem.get(t.item_id) ?? []), t.tag]);
    });
    const storyByItem = new Map<string, { transcript: string; createdAt: string }>();
    (stories.data ?? []).forEach((s) => {
      storyByItem.set(s.item_id, { transcript: s.transcript ?? '', createdAt: s.created_at });
    });
    const photoByItem = new Map<string, string>();
    (photos.data ?? [])
      .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
      .forEach((p) => {
        if (!photoByItem.has(p.item_id)) photoByItem.set(p.item_id, p.storage_path);
      });

    const localItems: Item[] = (items.data ?? []).map((i) => ({
      id: i.id,
      title: i.title ?? 'Untitled item',
      room: i.room ?? 'Elsewhere',
      decision: i.decision,
      decidedAt: i.decided_at ?? undefined,
      decidedBy: i.decided_by_name ?? undefined,
      tags: tagsByItem.get(i.id) ?? [],
      addedBy: 'Family',
      marketValue: i.market_value_cents != null ? i.market_value_cents / 100 : undefined,
      isSentimental: i.is_sentimental,
      story: storyByItem.get(i.id)
        ? {
            transcript: storyByItem.get(i.id)!.transcript,
            createdAt: storyByItem.get(i.id)!.createdAt,
          }
        : undefined,
      heirVisibility: 'owner_only',
      donateTo: i.donate_to ?? undefined,
      donateToKind: i.donate_to_kind ?? undefined,
      remotePhotoPath: photoByItem.get(i.id),
      archived: i.archived ?? false,
      createdAt: i.created_at,
    }));

    const localPeople: Person[] = (people.data ?? []).map((p) => ({
      id: p.id,
      displayName: p.display_name,
      relationship: p.relationship ?? '',
    }));

    const localMessages: ItemMessage[] = (msgs ?? []).map((m) => ({
      id: m.id,
      itemId: m.item_id,
      author: m.author_name,
      text: m.body,
      createdAt: m.created_at,
    }));

    const rosterRows = roster.data ?? [];
    const localMembers: Member[] = rosterRows.map((r) => ({
      id: r.id,
      name: r.name,
      relationship: r.relationship ?? undefined,
      email: r.invited_email ?? undefined,
      status: r.status,
      invitedBy: r.invited_by_name ?? '',
      invitedAt: r.created_at,
    }));
    const deciderNames = rosterRows.filter((r) => r.is_decider).map((r) => r.name);
    const createdBy =
      rosterRows.find((r) => r.status === 'active')?.name ?? deciderNames[0] ?? 'Family';

    return {
      ok: true,
      snapshot: {
        householdName: hh.name,
        deciderNames: deciderNames.length ? deciderNames : [createdBy],
        createdBy,
        cloudHouseholdId: hh.id,
        items: localItems,
        people: localPeople,
        messages: localMessages,
        members: localMembers,
        selfItemIds: (items.data ?? [])
          .filter((i) => i.created_by === auth.user.id)
          .map((i) => i.id),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* Back-compat aliases for existing call sites. */
export const backupHousehold = (input: SyncInput) => pushHousehold(input);
export const restoreHousehold = (householdId?: string) => pullHousehold(householdId);
export type BackupInput = SyncInput;
export type BackupResult = SyncResult;
export type RestoreResult = PullResult;

/**
 * Push ONE freshly-captured item to the cloud straight away, so other devices
 * see it without waiting for a manual backup (realtime delivers the INSERT).
 *
 * Fire-and-forget by design: every failure is silent and non-fatal, because
 * the item is already saved locally and the next full `pushHousehold` will
 * carry it regardless. Honours the same contracts as the bulk push —
 * `localOnly` never leaves the device, and only owners set decision fields.
 */
export async function pushItem(
  item: Item,
  cloudHouseholdId: string
): Promise<{ ok: boolean; error?: string }> {
  if (item.localOnly) return { ok: false, error: 'This item never leaves the device.' };

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: 'Not signed in.' };

  const role = await cloudRole(cloudHouseholdId);
  if (role === 'none' || role === 'executor') {
    return { ok: false, error: 'Not a contributing member of this household.' };
  }
  const isOwner = role === 'owner' || role === 'co_owner';
  // Contributors may not decide; the DB's items_guard enforces this too.
  const decided = isOwner && item.decision !== 'undecided';

  const { error } = await supabase.from('items').upsert(
    {
      id: item.id,
      household_id: cloudHouseholdId,
      created_by: user.id,
      title: item.title,
      room: item.room || null,
      decision: isOwner ? item.decision : 'undecided',
      decided_by: decided ? user.id : null,
      decided_by_name: decided ? (item.decidedBy ?? null) : null,
      decided_at: decided ? (item.decidedAt ?? new Date().toISOString()) : null,
      market_value_cents: item.marketValue != null ? Math.round(item.marketValue * 100) : null,
      is_sentimental: item.isSentimental,
      donate_to: item.donateTo ?? null,
      donate_to_kind: item.donateToKind ?? null,
      archived: item.archived ?? false,
      created_at: item.createdAt,
    },
    { ignoreDuplicates: !isOwner }
  );
  if (error) return { ok: false, error: error.message };

  // Tags ride along so a later pull doesn't find the item bare.
  if (item.tags.length) {
    await supabase.from('item_tags').insert(item.tags.map((tag) => ({ item_id: item.id, tag })));
  }
  return { ok: true };
}

/**
 * Mirror one item's cloud-owned fields after a local EDIT, so other devices
 * see the change without a manual backup.
 *
 * Sends only what the cloud row owns — local-only state (story, heirs, main
 * decider, photo uri) is left alone. `decision` goes only when the caller is
 * an owner: items_guard raises if a contributor touches the decision triple,
 * which would fail the whole update, and it stamps decided_by/decided_at
 * itself, so those are never sent.
 */
export async function pushItemUpdate(
  item: Item,
  cloudHouseholdId: string
): Promise<{ ok: boolean; error?: string }> {
  if (item.localOnly) return { ok: false, error: 'This item never leaves the device.' };

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: 'Not signed in.' };

  const role = await cloudRole(cloudHouseholdId);
  if (role === 'none' || role === 'executor') {
    return { ok: false, error: 'Not a contributing member of this household.' };
  }
  const isOwner = role === 'owner' || role === 'co_owner';

  const patch: Record<string, unknown> = {
    title: item.title,
    room: item.room || null,
    market_value_cents: item.marketValue != null ? Math.round(item.marketValue * 100) : null,
    is_sentimental: item.isSentimental,
    donate_to: item.donateTo ?? null,
    donate_to_kind: item.donateToKind ?? null,
    archived: item.archived ?? false,
  };
  if (isOwner) {
    patch.decision = item.decision;
    // Cosmetic companion to the decision; the trigger nulls it when undecided.
    patch.decided_by_name = item.decision !== 'undecided' ? (item.decidedBy ?? null) : null;
  }

  const { error } = await supabase
    .from('items')
    .update(patch)
    .eq('id', item.id)
    .eq('household_id', cloudHouseholdId);
  if (error) return { ok: false, error: error.message };

  // Tags are a tiny replace-set, same contract as the bulk push.
  await supabase.from('item_tags').delete().eq('item_id', item.id);
  if (item.tags.length) {
    await supabase.from('item_tags').insert(item.tags.map((tag) => ({ item_id: item.id, tag })));
  }
  return { ok: true };
}

/**
 * Bring a household's cloud copy up to date the moment this device can reach
 * it — on sign-in, on app load, and as soon as a household becomes linked.
 *
 * Answers two questions at once: is `householdId` a cloud household this user
 * belongs to (local ids double as cloud ids, so the id *is* the question), and
 * if so, send up every local item the cloud has never seen. That backlog is
 * what lets somebody added later read the whole history rather than only what
 * arrived after they joined.
 *
 * INSERT-ONLY on purpose: it never rewrites a row that already exists, so a
 * device holding stale local state cannot overwrite a newer edit made
 * somewhere else. Ongoing edits travel through pushItemUpdate instead.
 */
export async function reconcileHousehold(
  householdId: string,
  items: Item[],
  userName: string
): Promise<{ linked: boolean; pushed: number; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { linked: false, pushed: 0, error: 'Not signed in.' };

  const role = await cloudRole(householdId);
  if (role === 'none' || role === 'executor') return { linked: false, pushed: 0 };
  const isOwner = role === 'owner' || role === 'co_owner';

  const { data: existing, error: readErr } = await supabase
    .from('items')
    .select('id')
    .eq('household_id', householdId);
  if (readErr) return { linked: true, pushed: 0, error: readErr.message };
  const known = new Set((existing ?? []).map((r) => r.id));

  const missing = items.filter((i) => !i.localOnly && !known.has(i.id));
  // Contributors may only introduce their own still-undecided captures; the
  // INSERT policy and items_guard enforce the same rule server-side.
  const mine = isOwner
    ? missing
    : missing.filter((i) => i.addedBy === userName && i.decision === 'undecided');
  if (!mine.length) return { linked: true, pushed: 0 };

  const decidedAt = (i: Item) =>
    isOwner && i.decision !== 'undecided' ? (i.decidedAt ?? new Date().toISOString()) : null;

  const { error } = await supabase.from('items').upsert(
    mine.map((i) => ({
      id: i.id,
      household_id: householdId,
      created_by: user.id,
      title: i.title,
      room: i.room || null,
      decision: isOwner ? i.decision : 'undecided',
      decided_by: isOwner && i.decision !== 'undecided' ? user.id : null,
      decided_by_name: isOwner && i.decision !== 'undecided' ? (i.decidedBy ?? null) : null,
      decided_at: decidedAt(i),
      market_value_cents: i.marketValue != null ? Math.round(i.marketValue * 100) : null,
      is_sentimental: i.isSentimental,
      donate_to: i.donateTo ?? null,
      donate_to_kind: i.donateToKind ?? null,
      archived: i.archived ?? false,
      created_at: i.createdAt,
    })),
    { ignoreDuplicates: true }
  );
  if (error) return { linked: true, pushed: 0, error: error.message };

  const tagRows = mine.flatMap((i) => i.tags.map((tag) => ({ item_id: i.id, tag })));
  if (tagRows.length) await supabase.from('item_tags').insert(tagRows);

  return { linked: true, pushed: mine.length };
}
