/**
 * household — opening, choosing, creating and joining a home.
 *
 * The cloud is the source of truth. Opening a household PULLS its current
 * state and REPLACES this device's copy with it — then puts back the two
 * things the cloud can't know about yet:
 *   - anything still waiting in this account's outbox (an offline capture, an
 *     edit that hasn't landed), so replacing never loses work; and
 *   - device-only facts: `localOnly` items that must never leave the device,
 *     the local photo file, a story's audio, a helper's private "I'd like
 *     this" request.
 *
 * What this replaces: `restoreSnapshot` + `mergeCloudData` + `reconcileHousehold`
 * reconciled two sources of truth by last-writer-wins with no tombstones, so a
 * delete on one device came back from another. Here a row gone from the cloud
 * is gone, unless this device has a queued change that says otherwise.
 *
 * People are identified by user id. The names shown ("added by Sam") are
 * looked up from the household's membership rows at pull time — a display
 * cache, never an identity.
 */

import { awaitAuthReady } from '@/lib/auth';
import type { CloudResult } from '@/lib/cloud';
import { classify } from '@/lib/cloud';
import {
  loadHouseholdMembers,
  loadMyMemberships,
  memberName,
  myMembershipsSnapshot,
  type MyMembership,
} from '@/lib/membership';
import { enqueue, pendingOpsFor } from '@/lib/outbox';
import type { Collection, Decision, HeirVisibility, Item, ItemMessage, Person, Room } from '@/lib/store';
import { roomsFromItems, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export interface HouseholdData {
  items: Item[];
  people: Person[];
  collections: Collection[];
  rooms: Room[];
  messages: ItemMessage[];
}

type Fail = { ok: false; error: string; retry: boolean };

/* ------------------------------------------------------------------ pulling */

/** Read a household's shared copy, shaped for the device. Changes nothing locally. */
export async function pullHousehold(
  householdId: string
): Promise<{ ok: true; name: string; data: HouseholdData } | Fail> {
  const session = await awaitAuthReady();
  if (session.status !== 'signed-in' || !session.userId) {
    return { ok: false, error: 'Not signed in.', retry: false };
  }
  const fail = (e: { message: string; code?: string } | null, thrown?: unknown): Fail => {
    const r = classify(e, thrown) as Extract<CloudResult, { ok: false }>;
    return { ok: false, error: r.error, retry: r.retry };
  };

  try {
    const hh = await supabase.from('households').select('id, name').eq('id', householdId).maybeSingle();
    if (hh.error) return fail(hh.error);
    if (!hh.data) return { ok: false, error: 'That home isn’t available to this account.', retry: false };

    const items = await supabase.from('items').select('*').eq('household_id', householdId);
    if (items.error) return fail(items.error);
    const itemIds = (items.data ?? []).map((i) => i.id as string);

    // Children of items have no household column; scope them to this home's
    // items so a member of two homes never downloads the other home's rows.
    const byItems = <T,>(q: PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>) =>
      itemIds.length ? q : Promise.resolve({ data: [] as T[], error: null });

    const [tags, stories, photos, heirs, people, collections, rooms, messages, members] = await Promise.all([
      byItems(supabase.from('item_tags').select('item_id, tag').in('item_id', itemIds)),
      byItems(supabase.from('stories').select('item_id, transcript, created_at').in('item_id', itemIds)),
      byItems(
        supabase.from('item_photos').select('item_id, storage_path, is_primary').in('item_id', itemIds)
      ),
      // RLS decides: an owner receives every assignment, a helper only the revealed ones.
      supabase.from('heir_assignments').select('item_id, person_id, visibility').eq('household_id', householdId),
      supabase.from('people').select('*').eq('household_id', householdId),
      supabase.from('collections').select('*').eq('household_id', householdId),
      supabase.from('rooms').select('*').eq('household_id', householdId),
      supabase.from('item_messages').select('*').eq('household_id', householdId),
      loadHouseholdMembers(householdId).then(() =>
        supabase.from('household_members').select('user_id, display_name, invited_email').eq('household_id', householdId)
      ),
    ]);
    for (const r of [tags, stories, photos, heirs, people, collections, rooms, messages, members]) {
      if (r.error) return fail(r.error);
    }

    const nameByUser = new Map<string, string>();
    for (const m of (members.data ?? []) as { user_id: string | null; display_name: string | null; invited_email: string | null }[]) {
      if (m.user_id) nameByUser.set(m.user_id, memberName({ displayName: m.display_name, email: m.invited_email }));
    }
    const nameOf = (userId: string | null | undefined) => (userId && nameByUser.get(userId)) || 'Family';

    const tagsByItem = new Map<string, string[]>();
    for (const t of (tags.data ?? []) as { item_id: string; tag: string }[]) {
      tagsByItem.set(t.item_id, [...(tagsByItem.get(t.item_id) ?? []), t.tag]);
    }
    const storyByItem = new Map<string, { transcript: string; createdAt: string }>();
    for (const s of (stories.data ?? []) as { item_id: string; transcript: string | null; created_at: string }[]) {
      storyByItem.set(s.item_id, { transcript: s.transcript ?? '', createdAt: s.created_at });
    }
    const photoByItem = new Map<string, string>();
    for (const p of [...((photos.data ?? []) as { item_id: string; storage_path: string; is_primary: boolean }[])].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary)
    )) {
      if (!photoByItem.has(p.item_id)) photoByItem.set(p.item_id, p.storage_path);
    }
    const heirByItem = new Map<string, { personId: string; visibility: HeirVisibility }>();
    for (const h of (heirs.data ?? []) as { item_id: string; person_id: string; visibility: HeirVisibility }[]) {
      heirByItem.set(h.item_id, { personId: h.person_id, visibility: h.visibility });
    }

    const data: HouseholdData = {
      items: (items.data ?? []).map((i) => ({
        id: i.id,
        title: i.title ?? 'Untitled item',
        room: i.room ?? 'Elsewhere',
        decision: i.decision as Decision,
        decidedAt: i.decided_at ?? undefined,
        decidedBy: i.decided_by_name ?? undefined,
        decidedById: i.decided_by ?? undefined,
        createdById: i.created_by ?? undefined,
        addedBy: nameOf(i.created_by),
        mainDeciderId: i.main_decider ?? undefined,
        mainDeciderName: i.main_decider_name ?? undefined,
        tags: tagsByItem.get(i.id) ?? [],
        marketValue: i.market_value_cents != null ? i.market_value_cents / 100 : undefined,
        isSentimental: Boolean(i.is_sentimental),
        story: storyByItem.get(i.id),
        heirPersonId: heirByItem.get(i.id)?.personId,
        heirVisibility: heirByItem.get(i.id)?.visibility ?? 'owner_only',
        donateTo: i.donate_to ?? undefined,
        donateToKind: i.donate_to_kind ?? undefined,
        remotePhotoPath: photoByItem.get(i.id),
        archived: Boolean(i.archived),
        collectionId: i.collection_id ?? undefined,
        createdAt: i.created_at,
      })),
      people: (people.data ?? []).map((p) => ({
        id: p.id,
        displayName: p.display_name,
        relationship: p.relationship ?? '',
      })),
      collections: (collections.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        note: c.note ?? undefined,
        createdBy: c.created_by_name ?? nameOf(c.created_by),
        createdAt: c.created_at,
      })),
      rooms: (rooms.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        floor: r.floor ?? undefined,
        locationNote: r.location_note ?? undefined,
        createdBy: r.created_by_name ?? nameOf(r.created_by),
        createdAt: r.created_at,
      })),
      messages: (messages.data ?? []).map((m) => ({
        id: m.id,
        itemId: m.item_id,
        author: m.author_name,
        text: m.body,
        createdAt: m.created_at,
      })),
    };
    return { ok: true, name: hh.data.name, data };
  } catch (e) {
    return fail(null, e);
  }
}

/**
 * Lay this device's unfinished business over a fresh pull: queued changes
 * first (they are newer than the cloud by definition), then device-only facts.
 */
export function overlayLocal(householdId: string, cloudData: HouseholdData, local: HouseholdData | undefined): HouseholdData {
  const ops = pendingOpsFor(householdId);

  const items = new Map(cloudData.items.map((i) => [i.id, i]));
  const people = new Map(cloudData.people.map((p) => [p.id, p]));
  const collections = new Map(cloudData.collections.map((c) => [c.id, c]));
  const rooms = new Map(cloudData.rooms.map((r) => [r.name.toLowerCase(), r]));
  const messages = new Map(cloudData.messages.map((m) => [m.id, m]));

  for (const op of ops) {
    switch (op.kind) {
      case 'item.create':
      case 'item.update':
        items.set(op.payload.item.id, { ...items.get(op.payload.item.id), ...op.payload.item });
        break;
      case 'item.delete':
        items.delete(op.payload.itemId);
        break;
      case 'message.create':
        messages.set(op.payload.message.id, op.payload.message);
        break;
      case 'room.upsert':
        if (op.payload.previousName) rooms.delete(op.payload.previousName.toLowerCase());
        rooms.set(op.payload.room.name.toLowerCase(), op.payload.room);
        break;
      case 'room.delete':
        rooms.delete(op.payload.name.toLowerCase());
        break;
      case 'collection.upsert':
        collections.set(op.payload.collection.id, op.payload.collection);
        break;
      case 'collection.delete':
        collections.delete(op.payload.id);
        break;
      case 'person.upsert':
        people.set(op.payload.person.id, op.payload.person);
        break;
      case 'person.delete':
        people.delete(op.payload.id);
        break;
      default:
        break;
    }
  }

  if (local) {
    const localById = new Map(local.items.map((i) => [i.id, i]));
    for (const [id, item] of items) {
      const here = localById.get(id);
      if (!here) continue;
      items.set(id, {
        ...item,
        // The file on THIS device, until (and after) the upload lands.
        photoUri: here.photoUri,
        remotePhotoPath: item.remotePhotoPath ?? here.remotePhotoPath,
        // The cloud stores a story's words; the recording stays on the device.
        story: item.story
          ? { ...item.story, audioUri: here.story?.audioUri, durationSec: here.story?.durationSec }
          : here.story,
        requestedBy: here.requestedBy,
      });
    }
    // Items that must never leave the device.
    for (const here of local.items) if (here.localOnly) items.set(here.id, here);
    // Chat on those items stays with them.
    const localOnlyIds = new Set(local.items.filter((i) => i.localOnly).map((i) => i.id));
    for (const m of local.messages) if (localOnlyIds.has(m.itemId)) messages.set(m.id, m);
  }

  const itemList = [...items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const roomList = [...rooms.values()];
  return {
    items: itemList,
    people: [...people.values()],
    collections: [...collections.values()],
    rooms: roomList.length ? roomList : roomsFromItems(itemList, 'Family', new Date().toISOString()),
    messages: [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

/**
 * Open a household on this device from its shared copy. Refreshes an already
 * open home in place; brings a new one in alongside the homes already here.
 */
export async function openHousehold(householdId: string): Promise<{ ok: true; name: string } | Fail> {
  const pulled = await pullHousehold(householdId);
  if (!pulled.ok) return pulled;
  const store = useStore.getState();
  const data = overlayLocal(householdId, pulled.data, store.householdDataFor(householdId));
  store.setHouseholdData(householdId, pulled.name, data, { open: true });
  return { ok: true, name: pulled.name };
}

/**
 * Refresh the open household in place without switching to it — the "Sync
 * now" action and every reconnect.
 */
export async function refreshOpenHousehold(): Promise<{ ok: true } | Fail | { ok: false; error: string; retry: false; notLinked: true }> {
  const store = useStore.getState();
  const hid = store.households.find((h) => h.id === store.activeHouseholdId && h.cloudLinkedAt)?.id;
  if (!hid || store.isDemo) return { ok: false, error: 'This home isn’t shared yet.', retry: false, notLinked: true };
  const res = await openHousehold(hid);
  return res.ok ? { ok: true } : res;
}

/* ------------------------------------------------------------------ choosing */

/**
 * Which household this account should open: the one already open here if the
 * account still belongs to it, else its only one, else ask. Never the oldest —
 * that guess once put a member of two homes in the wrong house.
 */
export async function pickHousehold(): Promise<{
  id?: string;
  choices?: MyMembership[];
  none?: boolean;
  error?: string;
}> {
  const loaded = await loadMyMemberships();
  if (!loaded.ok) return { error: loaded.error };
  const list = Object.values(myMembershipsSnapshot());
  if (!list.length) return { none: true };
  const open = useStore.getState().activeHouseholdId;
  if (list.some((m) => m.householdId === open)) return { id: open };
  if (list.length === 1) return { id: list[0].householdId };
  return { choices: list };
}

/* ------------------------------------------------------------------ creating */

/**
 * Create a home in the cloud first, then on the device. The database makes
 * the creator its owner and administrator (handle_new_household), so there is
 * no moment where the home exists with nobody able to run it.
 */
export async function createHousehold(
  name: string,
  opts: { displayName?: string } = {}
): Promise<{ ok: true; householdId: string } | Fail> {
  const session = await awaitAuthReady();
  if (session.status !== 'signed-in' || !session.userId) {
    return { ok: false, error: 'Sign in to create a home.', retry: false };
  }
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Give the home a name.', retry: false };

  const id = newUuid();
  const { error } = await supabase.from('households').insert({ id, name: trimmed });
  if (error) {
    const r = classify(error) as Extract<CloudResult, { ok: false }>;
    return { ok: false, error: r.error, retry: r.retry };
  }
  if (opts.displayName?.trim()) {
    await supabase
      .from('household_members')
      .update({ display_name: opts.displayName.trim() })
      .eq('household_id', id)
      .eq('user_id', session.userId);
  }
  await loadMyMemberships();

  const now = new Date().toISOString();
  const rooms = useStore.getState().startingRoomsFor(opts.displayName?.trim() || 'Family', now);
  useStore.getState().setHouseholdData(
    id,
    trimmed,
    { items: [], people: [], collections: [], rooms, messages: [] },
    { open: true, linkedAt: now }
  );
  // The starting rooms are part of the family's map from the first moment.
  for (const room of rooms) enqueue({ kind: 'room.upsert', householdId: id, key: room.name, payload: { room } });
  return { ok: true, householdId: id };
}

/**
 * A home that only ever lived on this device reaches the cloud: the household
 * row first (same id), then every piece of it through the outbox, attributed
 * to the account signed in now.
 */
export async function uploadLocalHousehold(householdId: string): Promise<{ ok: true } | Fail> {
  const store = useStore.getState();
  const household = store.households.find((h) => h.id === householdId);
  if (!household) return { ok: false, error: 'That home isn’t on this device.', retry: false };
  if (household.cloudLinkedAt) return { ok: true };

  const { error } = await supabase.from('households').insert({ id: householdId, name: household.name });
  if (error && error.code !== '23505') {
    const r = classify(error) as Extract<CloudResult, { ok: false }>;
    return { ok: false, error: r.error, retry: r.retry };
  }
  await loadMyMemberships();

  const data = store.householdDataFor(householdId);
  store.markCloudLinked(householdId);
  if (!data) return { ok: true };
  for (const room of data.rooms) enqueue({ kind: 'room.upsert', householdId, key: room.name, payload: { room } });
  for (const person of data.people) {
    enqueue({ kind: 'person.upsert', householdId, key: person.id, payload: { person } });
  }
  const shared = data.items.filter((i) => !i.localOnly);
  const usedCollections = new Set(shared.map((i) => i.collectionId).filter(Boolean));
  for (const collection of data.collections.filter((c) => usedCollections.has(c.id))) {
    enqueue({ kind: 'collection.upsert', householdId, key: collection.id, payload: { collection } });
  }
  for (const item of shared) {
    enqueue({ kind: 'item.create', householdId, key: item.id, payload: { item } });
    if (item.photoUri) enqueue({ kind: 'photo.upload', householdId, key: item.id, payload: { item } });
  }
  const sharedIds = new Set(shared.map((i) => i.id));
  for (const message of data.messages.filter((m) => sharedIds.has(m.itemId))) {
    enqueue({ kind: 'message.create', householdId, key: message.itemId, payload: { message } });
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ invitations */

export interface PendingInvite {
  householdId: string;
  householdName: string;
  invitedAt: string;
}

/** Households holding an invitation for the signed-in account's verified email. */
export async function listPendingInvites(): Promise<PendingInvite[]> {
  const { data, error } = await supabase.rpc('my_pending_invites');
  if (error || !data) return [];
  return (data as { household_id: string; household_name: string; invited_at: string }[]).map((r) => ({
    householdId: r.household_id,
    householdName: r.household_name,
    invitedAt: r.invited_at,
  }));
}

/** Accept an invitation and open the household on this device. */
export async function acceptInvite(householdId: string): Promise<{ ok: true; name: string } | Fail> {
  const { error } = await supabase.rpc('accept_invite', { p_household_id: householdId });
  if (error) {
    const r = classify(error) as Extract<CloudResult, { ok: false }>;
    return { ok: false, error: r.error, retry: r.retry };
  }
  await loadMyMemberships();
  return openHousehold(householdId);
}

/**
 * Turn an invitation down: revokes it, and the household's administrators are
 * told (best-effort — the decline is already recorded either way).
 */
export async function declineInvite(householdId: string): Promise<{ ok: true; notified: boolean } | Fail> {
  const { error } = await supabase.rpc('decline_invite', { p_household_id: householdId });
  if (error) {
    const r = classify(error) as Extract<CloudResult, { ok: false }>;
    return { ok: false, error: r.error, retry: r.retry };
  }
  let notified = false;
  try {
    const { data } = await supabase.functions.invoke('notify-invite-declined', { body: { householdId } });
    notified = Boolean(data?.ok && data.sent > 0);
  } catch {
    /* email is an enhancement, never a dependency */
  }
  return { ok: true, notified };
}

/* ------------------------------------------------------------------ helpers */

function newUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
