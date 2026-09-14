/**
 * Switching accounts on one device, without losing anybody's work.
 *
 * The problem this solves: `onboarded` says a household exists on this
 * device, not whose it is. Sign-in used to treat the two as the same thing,
 * so a second person signing in on a laptop that already held a home was
 * shown that home — and, because `role` is persisted too, shown it in the
 * first person's role, Decide tab and all. For a catalogue of an elder's
 * belongings that is the wrong default.
 *
 * The rule here: a device's data belongs to exactly one account
 * (`state.accountEmail`), and a different account never sees it. But it is
 * never destroyed either — a phone can hold items captured in a basement with
 * no signal that have never reached the cloud, and signing in as a sibling
 * must not be the thing that deletes them. So the whole persisted blob is
 * moved aside under a per-account key and put back verbatim when that person
 * signs in again.
 *
 * Everything here works on the raw AsyncStorage blob rather than on store
 * actions, because the point is to swap the store's entire contents; after a
 * swap the caller rehydrates so React sees the new state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { linkedCloudId, useStore } from '@/lib/store';
import { listMyHouseholds } from '@/lib/sync';

/** Must match the `name` given to persist() in store.ts. */
const STORE_KEY = 'declutter-store-v1';

/** Every set-aside account's device state lives under this prefix. */
export const STASH_PREFIX = `${STORE_KEY}:stash:`;

/** Where one account's set-aside device state lives. */
const stashKey = (email: string) => `${STASH_PREFIX}${email.trim().toLowerCase()}`;

/**
 * A device whose binding we never recorded (persisted before v8, and never
 * locked). Its blob is still worth keeping — we just can't label it with an
 * owner, so it can only be recovered deliberately rather than automatically.
 */
const ORPHAN_KEY = `${STASH_PREFIX}unclaimed`;

const norm = (e?: string | null) => (e ?? '').trim().toLowerCase();

/** Does this device hold a household at all? (The demo doesn't count.) */
function hasRealHome(): boolean {
  const s = useStore.getState();
  return Boolean(s.onboarded) && !s.isDemo;
}

/**
 * Decide what signing in as `email` means for the data already on this
 * device. Returns what the caller should do next.
 *
 * - `same`     — this account's own device; carry on, nothing moved.
 * - `empty`    — nothing here worth protecting; carry on.
 * - `switched` — the previous account's data was set aside and this account's
 *                own stash (if it had one) was put back. The store has been
 *                rehydrated; the caller must re-resolve where to send them.
 *
 * The order of the checks is the design:
 *  1. Same account as the device is labelled for → nothing to do.
 *  2. No real home on the device → put back this account's set-aside state if
 *     there is one (otherwise a person signing back in after a helper would
 *     find their un-uploaded work stranded in a stash), else adopt the device.
 *  3. The device is labelled for a DIFFERENT known account → always swap,
 *     even if the newcomer can also reach the same household. Two people in
 *     one home see different things and hold different unsent captures; a
 *     "they have access, so keep what's here" rule handed a parent the
 *     helper's copy — helper role, helper's pending photos — on the family
 *     tablet.
 *  4. Only an UNLABELLED device (persisted before labels existed) falls back to
 *     asking the server whether this account can reach the home that's open.
 */
export async function reconcileAccount(
  email: string
): Promise<{ outcome: 'same' | 'empty' | 'switched'; restored: boolean }> {
  const incoming = norm(email);
  if (!incoming) return { outcome: 'empty', restored: false };

  const bound = norm(useStore.getState().accountEmail);

  // 1. The ordinary case: the same person signing in again.
  if (bound && bound === incoming) return { outcome: 'same', restored: false };

  // 2. Nothing real on the device.
  if (!hasRealHome()) {
    try {
      const theirs = await AsyncStorage.getItem(stashKey(incoming));
      if (theirs) {
        await AsyncStorage.setItem(STORE_KEY, theirs);
        await AsyncStorage.removeItem(stashKey(incoming));
        await useStore.persist.rehydrate();
        useStore.getState().bindAccount(incoming);
        return { outcome: 'switched', restored: true };
      }
    } catch {
      /* storage refused — adopting the empty device below is still safe */
    }
    useStore.getState().bindAccount(incoming);
    return { outcome: 'empty', restored: false };
  }

  // 3. Labelled for somebody else: always swap.
  if (bound) return swap(bound, incoming);

  // 4. Unlabelled device with a real home. A home never backed up exists
  // nowhere but here, and hiding it could look exactly like losing it, so it
  // is adopted by whoever signs in (what happened before labels existed).
  const openCloudId = linkedCloudId(useStore.getState());
  if (!openCloudId) {
    useStore.getState().bindAccount(incoming);
    return { outcome: 'same', restored: false };
  }
  // Backed up: ask the server whether this account can reach it. RLS answers —
  // listMyHouseholds returns only households the signed-in account may see.
  const mine = await listMyHouseholds();
  if (mine.ok && mine.households.some((h) => h.id === openCloudId)) {
    useStore.getState().bindAccount(incoming);
    return { outcome: 'same', restored: false };
  }
  // Couldn't ask (offline): leave it be rather than hide a home over a dropped
  // request. The label is still unset, so the next sign-in asks again.
  if (!mine.ok) return { outcome: 'same', restored: false };

  return swap(null, incoming);
}

/**
 * Move the device's current state aside (under the outgoing account's key, or
 * the unclaimed key when nobody is known) and put back the incoming account's
 * own, or start it clean.
 */
async function swap(
  outgoing: string | null,
  incoming: string
): Promise<{ outcome: 'switched'; restored: boolean }> {
  try {
    const blob = await AsyncStorage.getItem(STORE_KEY);
    if (blob) await AsyncStorage.setItem(outgoing ? stashKey(outgoing) : ORPHAN_KEY, blob);

    const theirs = await AsyncStorage.getItem(stashKey(incoming));
    if (theirs) {
      // This account has been on this device before: put its own state back.
      await AsyncStorage.setItem(STORE_KEY, theirs);
      await AsyncStorage.removeItem(stashKey(incoming));
      await useStore.persist.rehydrate();
      useStore.getState().bindAccount(incoming);
      return { outcome: 'switched', restored: true };
    }

    // Nothing of theirs here. The reset must be EXPLICIT: rehydrate() does
    // nothing when storage is empty — it leaves the current state alone — so
    // clearing the key on its own would hand the new account an in-memory
    // copy of the household we just went to the trouble of hiding.
    useStore.getState().signOut();
    useStore.getState().bindAccount(incoming);
    return { outcome: 'switched', restored: false };
  } catch {
    // Storage refused (private mode, quota). Failing closed is the safe read:
    // clear what's in memory and send them through normal placement, rather
    // than fall through into someone else's household.
    useStore.getState().signOut();
    useStore.getState().bindAccount(incoming);
    return { outcome: 'switched', restored: false };
  }
}
