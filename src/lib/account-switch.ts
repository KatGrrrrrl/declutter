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

import { useStore } from '@/lib/store';

/** Must match the `name` given to persist() in store.ts. */
const STORE_KEY = 'declutter-store-v1';

/** Where one account's set-aside device state lives. */
const stashKey = (email: string) => `${STORE_KEY}:stash:${email.trim().toLowerCase()}`;

/**
 * A device whose binding we never recorded (persisted before v8, and never
 * locked). Its blob is still worth keeping — we just can't label it with an
 * owner, so it can only be recovered deliberately rather than automatically.
 */
const ORPHAN_KEY = `${STORE_KEY}:stash:unclaimed`;

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
 */
export async function reconcileAccount(
  email: string
): Promise<{ outcome: 'same' | 'empty' | 'switched'; restored: boolean }> {
  const incoming = norm(email);
  if (!incoming) return { outcome: 'empty', restored: false };

  const bound = norm(useStore.getState().accountEmail);

  // The ordinary case: the same person signing in again.
  if (bound && bound === incoming) return { outcome: 'same', restored: false };

  // A device with nothing on it can simply be adopted by whoever signs in.
  if (!hasRealHome()) {
    useStore.getState().bindAccount(incoming);
    return { outcome: 'empty', restored: false };
  }

  // An UNLABELLED device (persisted before v8, never locked) is the one case
  // where we cannot tell whose home this is. Setting it aside is only safe if
  // the cloud can give it back: a home that has never been backed up exists
  // nowhere else, and making it vanish on someone's first sign-in after an
  // update would be a far worse bug than the one this file fixes. So an
  // unbacked, unlabelled device is adopted by whoever signs in — which is
  // also what happened before this file existed — and is labelled from then
  // on, so the NEXT account switch takes the safe path above.
  if (!bound && !useStore.getState().households.some((h) => h.cloudLinkedAt)) {
    useStore.getState().bindAccount(incoming);
    return { outcome: 'same', restored: false };
  }

  // A different account (or a labelled-but-backed-up device) is signing in
  // over someone else's home. Move it aside before anything can render it.
  try {
    const blob = await AsyncStorage.getItem(STORE_KEY);
    if (blob) await AsyncStorage.setItem(bound ? stashKey(bound) : ORPHAN_KEY, blob);

    const mine = await AsyncStorage.getItem(stashKey(incoming));
    if (mine) {
      // This account has been on this device before: put its own state back.
      await AsyncStorage.setItem(STORE_KEY, mine);
      await useStore.persist.rehydrate();
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
    // better to send them through normal resolution than to fall through into
    // someone else's household.
    return { outcome: 'switched', restored: false };
  }
}
