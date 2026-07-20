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
      if (!existing) hid = undefined;
    }
    if (!hid) {
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
        decided_at:
          isOwner && i.decision !== 'undecided'
            ? (i.decidedAt ?? new Date().toISOString())
            : null,
        market_value_cents: i.marketValue != null ? Math.round(i.marketValue * 100) : null,
        is_sentimental: i.isSentimental,
        donate_to: i.donateTo ?? null,
        donate_to_kind: i.donateToKind ?? null,
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
