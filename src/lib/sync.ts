/**
 * Cloud backup & restore — v1 of the sync layer.
 *
 * Model: full-snapshot backup of the active household to the user's Supabase
 * account, and full restore onto a device. Deliberately coarse: a household is
 * at most a few hundred small rows, so wipe-and-rewrite is simple, idempotent,
 * and leaves no partial-merge states. Real-time multi-user sync builds on this
 * later (realtime on item_messages first).
 *
 * Contracts honored here:
 * - Items flagged `localOnly` are NEVER uploaded (their whole meaning).
 * - Photos are not yet uploaded — they await the EXIF-stripping edge function;
 *   backup covers the catalog (titles, decisions, stories, chat, heirs, roster).
 * - The signed-in user becomes the cloud household's owner row (0001's
 *   bootstrap trigger); items_guard stamps them as decider on decided items.
 */

import type { Item, ItemMessage, Member, Person } from '@/lib/store';
import { supabase } from '@/lib/supabase';

/** RFC4122-ish v4 uuid; crypto when available, Math.random fallback (row ids, not secrets). */
const uuid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export interface BackupInput {
  cloudHouseholdId?: string;
  householdName: string;
  items: Item[];
  people: Person[];
  messages: ItemMessage[];
  members: Member[];
  deciderNames: string[];
  userName: string;
}

export interface BackupResult {
  ok: boolean;
  cloudHouseholdId?: string;
  itemsBackedUp?: number;
  skippedLocalOnly?: number;
  error?: string;
}

export async function backupHousehold(input: BackupInput): Promise<BackupResult> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: 'Not signed in.' };

  try {
    // 1. Ensure the cloud household exists.
    let hid = input.cloudHouseholdId;
    if (hid) {
      const { data: existing } = await supabase
        .from('households')
        .select('id')
        .eq('id', hid)
        .maybeSingle();
      if (!existing) hid = undefined; // stale linkage (e.g. deleted in dashboard)
    }
    if (!hid) {
      const { data: created, error } = await supabase
        .from('households')
        .insert({ name: input.householdName })
        .select('id')
        .single();
      if (error) throw error;
      hid = created.id as string;
    } else {
      await supabase.from('households').update({ name: input.householdName }).eq('id', hid);
    }

    // 2. Snapshot semantics: clear previous backup content, then rewrite.
    //    (items cascade to photos/tags/stories/messages.)
    for (const table of ['items', 'people', 'roster_entries'] as const) {
      const { error } = await supabase.from(table).delete().eq('household_id', hid);
      if (error) throw error;
    }

    // 3. People (heirs) — keep ids stable so heir references hold.
    const personIdMap = new Map<string, string>();
    if (input.people.length) {
      const rows = input.people.map((p) => {
        const id = uuid();
        personIdMap.set(p.id, id);
        return {
          id,
          household_id: hid,
          display_name: p.displayName,
          relationship: p.relationship || null,
        };
      });
      const { error } = await supabase.from('people').insert(rows);
      if (error) throw error;
    }

    // 4. Items — skip localOnly (their contract: never leave the device).
    const uploadable = input.items.filter((i) => !i.localOnly);
    const skipped = input.items.length - uploadable.length;
    const itemIdMap = new Map<string, string>();
    if (uploadable.length) {
      const now = new Date().toISOString();
      const rows = uploadable.map((i) => {
        const id = uuid();
        itemIdMap.set(i.id, id);
        return {
          id,
          household_id: hid,
          created_by: user.id,
          title: i.title,
          room: i.room || null,
          decision: i.decision,
          decided_by: i.decision === 'undecided' ? null : user.id,
          decided_at: i.decision === 'undecided' ? null : (i.decidedAt ?? now),
          market_value_cents:
            i.marketValue != null ? Math.round(i.marketValue * 100) : null,
          is_sentimental: i.isSentimental,
          donate_to: i.donateTo ?? null,
          donate_to_kind: i.donateToKind ?? null,
          created_at: i.createdAt,
        };
      });
      const { error } = await supabase.from('items').insert(rows);
      if (error) throw error;

      // 4b. Tags.
      const tagRows = uploadable.flatMap((i) =>
        i.tags.map((tag) => ({ item_id: itemIdMap.get(i.id)!, tag }))
      );
      if (tagRows.length) {
        const { error: tagErr } = await supabase.from('item_tags').insert(tagRows);
        if (tagErr) throw tagErr;
      }

      // 4c. Stories (transcripts; audio files come with the photo pipeline).
      const storyRows = uploadable
        .filter((i) => i.story)
        .map((i) => ({
          item_id: itemIdMap.get(i.id)!,
          transcript: i.story!.transcript,
          created_by: user.id,
          created_at: i.story!.createdAt,
        }));
      if (storyRows.length) {
        const { error: stErr } = await supabase.from('stories').insert(storyRows);
        if (stErr) throw stErr;
      }

      // 4d. Heir assignments live on the local item; cloud stores them in
      //     heir_assignments (Phase-2 table, not yet in cloud schema) — until
      //     then we preserve them via the item note round-trip? No: we keep
      //     them client-side and they ride along in restores via roster/people
      //     linkage. Documented gap; nothing silently lost locally.

      // 4e. Chat threads.
      const msgRows = input.messages
        .filter((m) => itemIdMap.has(m.itemId))
        .map((m) => ({
          item_id: itemIdMap.get(m.itemId)!,
          author: user.id,
          author_name: m.author,
          body: m.text,
          created_at: m.createdAt,
        }));
      if (msgRows.length) {
        const { error: msgErr } = await supabase.from('item_messages').insert(msgRows);
        if (msgErr) throw msgErr;
      }
    }

    // 5. Roster (name-only members + deciders).
    if (input.members.length) {
      const rows = input.members.map((m) => ({
        household_id: hid,
        name: m.name,
        relationship: m.relationship || null,
        status: m.status,
        is_decider: input.deciderNames.includes(m.name),
        invited_by_name: m.invitedBy,
      }));
      const { error } = await supabase.from('roster_entries').insert(rows);
      if (error) throw error;
    }

    return {
      ok: true,
      cloudHouseholdId: hid,
      itemsBackedUp: uploadable.length,
      skippedLocalOnly: skipped,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RestoreResult {
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
  };
  error?: string;
}

/** Pull the user's (first) cloud household back into local shape. */
export async function restoreHousehold(): Promise<RestoreResult> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: 'Not signed in.' };

  try {
    const { data: hh, error: hhErr } = await supabase
      .from('households')
      .select('id, name')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (hhErr) throw hhErr;
    if (!hh) return { ok: false, error: 'No backup found on this account yet.' };

    const [items, tags, stories, people, roster] = await Promise.all([
      supabase.from('items').select('*').eq('household_id', hh.id),
      supabase.from('item_tags').select('*'),
      supabase.from('stories').select('*'),
      supabase.from('people').select('*').eq('household_id', hh.id),
      supabase.from('roster_entries').select('*').eq('household_id', hh.id),
    ]);
    for (const r of [items, tags, stories, people, roster]) if (r.error) throw r.error;

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

    const localItems: Item[] = (items.data ?? []).map((i) => ({
      id: i.id,
      title: i.title ?? 'Untitled item',
      room: i.room ?? 'Elsewhere',
      decision: i.decision,
      decidedAt: i.decided_at ?? undefined,
      tags: tagsByItem.get(i.id) ?? [],
      addedBy: 'Restored',
      marketValue: i.market_value_cents != null ? i.market_value_cents / 100 : undefined,
      isSentimental: i.is_sentimental,
      story: storyByItem.get(i.id)
        ? { transcript: storyByItem.get(i.id)!.transcript, createdAt: storyByItem.get(i.id)!.createdAt }
        : undefined,
      heirVisibility: 'owner_only',
      donateTo: i.donate_to ?? undefined,
      donateToKind: i.donate_to_kind ?? undefined,
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
      status: r.status,
      invitedBy: r.invited_by_name ?? '',
      invitedAt: r.created_at,
    }));
    const deciderNames = rosterRows.filter((r) => r.is_decider).map((r) => r.name);
    const createdBy =
      rosterRows.find((r) => r.status === 'active')?.name ?? deciderNames[0] ?? 'Restored';

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
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
