/**
 * outbox — every change bound for the family's shared copy waits here until
 * it lands, and anything the server refuses is shown, not dropped.
 *
 * Before: nine fire-and-forget writes with empty catches. A contributor's
 * decision refused by the database, a photo that 404'd because it raced its
 * own item, an heir assignment written against a project without the table —
 * each looked exactly like a saved change on the device that made it, and
 * nobody else ever saw it. That "the writer can't tell" failure was named in
 * THREADS.md as a whole class of bug.
 *
 * Rules:
 * - An op belongs to the ACCOUNT that made it and drains only while that
 *   account is signed in. One person's offline captures are never sent under
 *   whoever signs in next: `created_by` is immutable, so a misattributed item
 *   could never be corrected.
 * - Serial, first in first out, so an item is created before its photo, its
 *   chat, or its edits.
 * - A retryable failure (no connection, expired token, busy server) backs off
 *   and stops the drain, keeping order. A refusal marks the op `failed` with a
 *   sentence the person can read; it is never retried on its own and never
 *   silently discarded.
 * - Edits to the same thing coalesce: ten swipes on one item send one update.
 *
 * Persisted under its own storage key, so an account switch (which swaps the
 * main store's blob) doesn't strand or expose anyone's queue.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import { currentSession, subscribeSession, useSession } from '@/lib/auth';
import * as cloud from '@/lib/cloud';
import type { CloudResult, ItemParts } from '@/lib/cloud';
import { loadMyMemberships } from '@/lib/membership';
import type { Collection, Item, ItemMessage, Person, Room } from '@/lib/store';
import { setCloudSink } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export type Op =
  | OpBase<'item.create', { item: Item }>
  | OpBase<'item.update', { item: Item; parts: ItemParts }>
  | OpBase<'item.delete', { itemId: string }>
  | OpBase<'photo.upload', { item: Item }>
  | OpBase<'message.create', { message: ItemMessage }>
  | OpBase<'room.upsert', { room: Room; previousName?: string }>
  | OpBase<'room.delete', { name: string }>
  | OpBase<'collection.upsert', { collection: Collection }>
  | OpBase<'collection.delete', { id: string }>
  | OpBase<'person.upsert', { person: Person }>
  | OpBase<'person.delete', { id: string }>
  | OpBase<'household.rename', { name: string }>;

interface OpBase<K extends string, P> {
  id: string;
  kind: K;
  /** The account that made this change. It drains only under that account. */
  userId: string;
  householdId: string;
  /** What the change is about (item id, room name, …): for coalescing and "not yet shared". */
  key: string;
  payload: P;
  createdAt: string;
  attempts: number;
  /** Epoch ms; a backed-off op waits until then. */
  nextAttemptAt: number;
  status: 'pending' | 'failed';
  lastError?: string;
}

export type OpKind = Op['kind'];
export type NewOp = { [K in Op['kind']]: { kind: K; householdId: string; key: string; payload: Extract<Op, { kind: K }>['payload'] } }[Op['kind']];

interface OutboxState {
  ops: Op[];
}

const useOutboxStore = create<OutboxState>()(
  persist(() => ({ ops: [] as Op[] }), {
    name: 'iohome-outbox-v1',
    storage: createJSONStorage(() => AsyncStorage),
    version: 1,
  })
);

const newId = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/* ------------------------------------------------------------------ enqueue */

/**
 * Queue a change for the signed-in account. Returns false (and queues nothing)
 * when nobody is signed in — the caller's household is then device-only, and
 * the change simply stays on the device.
 */
export function enqueue(op: NewOp): boolean {
  const { status, userId } = currentSession();
  if (status !== 'signed-in' || !userId) return false;

  useOutboxStore.setState((s) => ({ ops: coalesce(s.ops, op, userId) }));
  void drainOutbox();
  return true;
}

/** Fold a new change into the queue, merging with pending changes to the same thing. */
function coalesce(ops: Op[], incoming: NewOp, userId: string): Op[] {
  const same = (o: Op) =>
    o.userId === userId && o.householdId === incoming.householdId && o.key === incoming.key && o.status === 'pending';
  const fresh = (): Op =>
    ({
      id: newId(),
      userId,
      createdAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      status: 'pending',
      ...incoming,
    }) as Op;

  switch (incoming.kind) {
    case 'item.update': {
      const i = ops.findIndex((o) => same(o) && (o.kind === 'item.create' || o.kind === 'item.update'));
      if (i === -1) return [...ops, fresh()];
      const prev = ops[i];
      const next = [...ops];
      if (prev.kind === 'item.create') {
        // Not in the cloud yet: the create simply carries the latest version.
        next[i] = { ...prev, payload: { item: incoming.payload.item } };
      } else if (prev.kind === 'item.update') {
        next[i] = {
          ...prev,
          payload: {
            item: incoming.payload.item,
            parts: {
              tags: prev.payload.parts.tags || incoming.payload.parts.tags,
              story: prev.payload.parts.story || incoming.payload.parts.story,
              heir: prev.payload.parts.heir || incoming.payload.parts.heir,
              decision: prev.payload.parts.decision || incoming.payload.parts.decision,
            },
          },
        };
      }
      return next;
    }
    case 'item.delete': {
      const hadCreate = ops.some((o) => same(o) && o.kind === 'item.create');
      // Everything still pending about this item is moot now.
      const rest = ops.filter((o) => !(same(o) && o.key === incoming.key));
      // Never reached the cloud: there is nothing to delete there either.
      return hadCreate ? rest : [...rest, fresh()];
    }
    case 'room.upsert': {
      // A rename of a room whose previous write is still queued: one write,
      // from the name the cloud last knew to the newest one.
      const prevKey = incoming.payload.previousName ?? incoming.key;
      const i = ops.findIndex(
        (o) => o.kind === 'room.upsert' && o.userId === userId && o.householdId === incoming.householdId &&
          o.status === 'pending' && o.key === prevKey
      );
      if (i === -1) return [...ops, fresh()];
      const prev = ops[i] as Extract<Op, { kind: 'room.upsert' }>;
      const next = [...ops];
      next[i] = {
        ...prev,
        key: incoming.key,
        payload: { room: incoming.payload.room, previousName: prev.payload.previousName },
      };
      return next;
    }
    case 'collection.upsert':
    case 'person.upsert':
    case 'household.rename': {
      const i = ops.findIndex((o) => same(o) && o.kind === incoming.kind);
      if (i === -1) return [...ops, fresh()];
      const next = [...ops];
      next[i] = { ...next[i], payload: incoming.payload } as Op;
      return next;
    }
    case 'collection.delete':
    case 'person.delete':
    case 'room.delete': {
      const upsertKind = incoming.kind.replace('.delete', '.upsert');
      const rest = ops.filter((o) => !(same(o) && o.kind === upsertKind));
      return [...rest, fresh()];
    }
    case 'photo.upload': {
      const i = ops.findIndex((o) => same(o) && o.kind === 'photo.upload');
      if (i === -1) return [...ops, fresh()];
      const next = [...ops];
      next[i] = { ...next[i], payload: incoming.payload } as Op;
      return next;
    }
    default:
      return [...ops, fresh()];
  }
}

/* ------------------------------------------------------------------ drain */

let draining = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

/** Send what can be sent, in order, for the signed-in account. */
export async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const { status, userId } = currentSession();
      if (status !== 'signed-in' || !userId) return;
      const now = Date.now();
      const op = useOutboxStore.getState().ops.find((o) => o.userId === userId && o.status === 'pending');
      if (!op) return;
      if (op.nextAttemptAt > now) {
        scheduleWake(op.nextAttemptAt - now);
        return;
      }

      const res = await execute(op);
      // The account changed while this was in flight; leave the op as it was.
      if (currentSession().userId !== op.userId) return;

      if (res.ok) {
        useOutboxStore.setState((s) => ({ ops: s.ops.filter((o) => o.id !== op.id) }));
        // Only now is it true that the family can see it: tell those who asked
        // for instant emails. (It used to fire before the item had landed.)
        if (op.kind === 'item.create') {
          const { pingItemAdded } = await import('@/lib/notifications');
          pingItemAdded(op.payload.item, op.householdId);
        }
        continue;
      }
      if (res.retry) {
        const attempts = op.attempts + 1;
        const delay = Math.min(2 ** attempts * 2000, 5 * 60 * 1000);
        update(op.id, { attempts, nextAttemptAt: Date.now() + delay, lastError: res.error });
        scheduleWake(delay);
        return; // keep order: nothing behind it goes first
      }
      update(op.id, { status: 'failed', attempts: op.attempts + 1, lastError: res.error });
    }
  } finally {
    draining = false;
  }
}

function update(id: string, patch: Partial<Op>) {
  useOutboxStore.setState((s) => ({ ops: s.ops.map((o) => (o.id === id ? ({ ...o, ...patch } as Op) : o)) }));
}

function scheduleWake(ms: number) {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void drainOutbox();
  }, Math.max(ms, 250));
}

/**
 * The signed-in person's standing in this household, per the server.
 * 'unreachable' is a connection problem and must be retried; 'none' means they
 * really aren't a member any more. Treating the first as the second marked an
 * offline capture as permanently refused.
 */
async function standing(householdId: string, userId: string): Promise<'decider' | 'helper' | 'none' | 'unreachable'> {
  try {
    const { data, error } = await supabase
      .from('household_members')
      .select('role')
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) return 'unreachable';
    if (!data) return 'none';
    return data.role === 'owner' || data.role === 'co_owner' ? 'decider' : 'helper';
  } catch {
    return 'unreachable';
  }
}

async function execute(op: Op): Promise<CloudResult> {
  const hid = op.householdId;
  switch (op.kind) {
    case 'item.create':
    case 'item.update': {
      const who = await standing(hid, op.userId);
      if (who === 'unreachable') return { ok: false, retry: true, error: 'No connection.' };
      if (who === 'none') return { ok: false, retry: false, error: 'You’re no longer a member of this home.' };
      const decider = who === 'decider';
      if (op.kind === 'item.update' && op.payload.parts.decision && !decider) {
        // Refuse it visibly. Sending the rest of the edit without the decision
        // would "succeed" while the person's screen still showed their choice.
        return { ok: false, retry: false, error: 'Only someone with the final say can decide items.' };
      }
      return op.kind === 'item.create'
        ? cloud.createItem(op.payload.item, hid, op.userId, decider)
        : cloud.updateItem(op.payload.item, hid, op.userId, decider, op.payload.parts);
    }
    case 'item.delete':
      return cloud.deleteItem(op.payload.itemId, hid);
    case 'photo.upload': {
      const { uploadItemPhoto } = await import('@/lib/photo-sync');
      const res = await uploadItemPhoto(op.payload.item);
      if (res.ok) return { ok: true };
      // The item row may still be on its way (the create is ahead in the queue
      // on another device, or this one lost a response). A few retries, then
      // it is shown as failed rather than retried forever.
      return { ok: false, retry: op.attempts < 4, error: res.error ?? 'The photo didn’t upload.' };
    }
    case 'message.create':
      return cloud.createMessage(op.payload.message, op.userId);
    case 'room.upsert':
      return cloud.upsertRoom(op.payload.room, hid, op.userId, op.payload.previousName);
    case 'room.delete':
      return cloud.deleteRoom(op.payload.name, hid);
    case 'collection.upsert':
      return cloud.upsertCollection(op.payload.collection, hid, op.userId);
    case 'collection.delete':
      return cloud.deleteCollection(op.payload.id, hid);
    case 'person.upsert':
      return cloud.upsertPerson(op.payload.person, hid);
    case 'person.delete':
      return cloud.deletePerson(op.payload.id, hid);
    case 'household.rename':
      return cloud.renameHousehold(hid, op.payload.name);
  }
}

/* ------------------------------------------------------------------ describing */

/** A change, in words a family member recognises. */
export function describeOp(op: Op): string {
  switch (op.kind) {
    case 'item.create':
      return 'Adding “' + op.payload.item.title + '”';
    case 'item.update':
      return 'Changes to “' + op.payload.item.title + '”';
    case 'item.delete':
      return 'Removing an item';
    case 'photo.upload':
      return 'The photo of “' + op.payload.item.title + '”';
    case 'message.create':
      return 'A chat message';
    case 'room.upsert':
      return 'The room “' + op.payload.room.name + '”';
    case 'room.delete':
      return 'Removing the room “' + op.payload.name + '”';
    case 'collection.upsert':
      return 'The collection “' + op.payload.collection.name + '”';
    case 'collection.delete':
      return 'Removing a collection';
    case 'person.upsert':
      return 'The heir “' + op.payload.person.displayName + '”';
    case 'person.delete':
      return 'Removing an heir';
    case 'household.rename':
      return 'Renaming the home to “' + op.payload.name + '”';
  }
}

/* ------------------------------------------------------------------ acting on failures */

/** Try a failed change again (the person tapped "Try again"). */
export function retryOp(id: string): void {
  update(id, { status: 'pending', nextAttemptAt: 0, lastError: undefined });
  void drainOutbox();
}

/** Give up on a failed change (the person tapped "Discard"). Local state is theirs to fix. */
export function discardOp(id: string): void {
  useOutboxStore.setState((s) => ({ ops: s.ops.filter((o) => o.id !== id) }));
}

/** Retry everything waiting on a backoff now (e.g. the connection came back). */
export function nudgeOutbox(): void {
  const { userId } = currentSession();
  useOutboxStore.setState((s) => ({
    ops: s.ops.map((o) => (o.userId === userId && o.status === 'pending' ? { ...o, nextAttemptAt: 0 } : o)),
  }));
  void drainOutbox();
}

/* ------------------------------------------------------------------ reading */

/**
 * Plain code: this account's changes to one household that haven't landed yet
 * (pending or failed), oldest first. Opening a household lays these over the
 * fresh pull so replacing the device copy never loses unsent work.
 */
export function pendingOpsFor(householdId: string): Op[] {
  const { userId } = currentSession();
  if (!userId) return [];
  return useOutboxStore.getState().ops.filter((o) => o.userId === userId && o.householdId === householdId);
}

export interface OutboxStatus {
  pending: number;
  failed: number;
}

/** The signed-in account's queue at a glance. */
export function useOutboxStatus(): OutboxStatus {
  const { userId } = useSession();
  return useOutboxStore(
    useShallow((s) => {
      let pending = 0;
      let failed = 0;
      for (const o of s.ops) {
        if (o.userId !== userId) continue;
        if (o.status === 'failed') failed++;
        else pending++;
      }
      return { pending, failed };
    })
  );
}

const NO_OPS: Op[] = [];

/** The signed-in account's failed changes, for the "couldn't share" list. */
export function useFailedOps(): Op[] {
  const { userId } = useSession();
  const ops = useOutboxStore((s) => s.ops);
  // Filtered outside the selector: a selector that builds a new array loops.
  return userId ? ops.filter((o) => o.userId === userId && o.status === 'failed') : NO_OPS;
}

/** Plain code: every queued op on this device, all accounts (diagnostics and tests). */
export function opsSnapshot(): Op[] {
  return useOutboxStore.getState().ops;
}

/** Is anything about this item still waiting to reach the family? */
export function useItemPending(itemId: string): boolean {
  const { userId } = useSession();
  return useOutboxStore((s) => s.ops.some((o) => o.userId === userId && o.key === itemId));
}

/**
 * Other accounts' waiting changes on this device, by user id — for the
 * account switcher's "Sam has 3 items waiting to upload".
 */
export function waitingByAccount(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of useOutboxStore.getState().ops) out[o.userId] = (out[o.userId] ?? 0) + 1;
  return out;
}

/* ------------------------------------------------------------------ lifecycle */

let started = false;

/** Drain whenever the signed-in account is ready. Called once from the root layout. */
export function startOutbox(): void {
  if (started) return;
  started = true;
  // Store actions hand their cloud-bound changes here.
  setCloudSink(enqueue);
  subscribeSession((next, prev) => {
    if (next.status === 'signed-in' && (prev.status !== 'signed-in' || prev.userId !== next.userId)) {
      // Refresh standing first: a decision queued while someone was a decider
      // must be judged against what they are now.
      void loadMyMemberships().finally(() => void drainOutbox());
    }
  });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => nudgeOutbox());
  }
  void drainOutbox();
}
