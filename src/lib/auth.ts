/**
 * auth — the ONE owner of "who is signed in on this device".
 *
 * Before this module, six components each subscribed to Supabase's auth
 * events and twenty call sites asked `getSession()` for themselves. They
 * disagreed at the edges: the login screen and CloudBridge both reacted to the
 * same sign-in, both ran the account-switch logic, and whichever finished
 * second could undo the first. There were three copies of "log out".
 *
 * The rules now:
 *  - This file is the only place that calls `onAuthStateChange` or
 *    `getSession()`. Everything else reads `useSession()` (React) or
 *    `currentSession()` / `awaitAuthReady()` (plain code).
 *  - There is exactly one live session. Other accounts that have used this
 *    device are remembered as a NAME ON A LIST (`knownAccounts`) — never a
 *    token, never a way in. Switching always means signing in again; the user
 *    chose that so a child on the family tablet can never act with the
 *    parent's final say.
 *  - When the signed-in account changes, the previous account's device state
 *    is set aside BEFORE status becomes 'signed-in' (`reconcileAccount`). No
 *    screen can render a moment of somebody else's home, because until that
 *    has run the status is still 'resolving'.
 *  - `signOut()` is the only sign-out. It also locks the device, because an
 *    inventory of valuables must not stay browsable on a logged-out phone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import { reconcileAccount, STASH_PREFIX } from '@/lib/account-switch';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

/**
 * - `unknown`    — the stored session hasn't been read yet (first moments of a load).
 * - `resolving`  — an account is signed in, and this device's state is being
 *                  matched to it. Treat as not-yet-ready: render nothing that
 *                  depends on who they are.
 * - `signed-in`  — ready.
 * - `signed-out` — no session.
 */
export type AuthStatus = 'unknown' | 'resolving' | 'signed-in' | 'signed-out';

export interface SessionState {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
  /**
   * The account change set the previous person's state aside and there was
   * nothing of this account's to put back — so they have no home open, and
   * need placing (their own cloud home, a waiting invitation, or onboarding).
   * Whoever routes (CloudBridge) consumes it with `clearNeedsPlacement()`.
   */
  needsPlacement: boolean;
  /** Set by `switchAccount()` so the sign-in screen opens on the account list. */
  switching: boolean;
}

const useSessionStore = create<SessionState>(() => ({
  status: 'unknown',
  userId: null,
  email: null,
  needsPlacement: false,
  switching: false,
}));

export interface KnownAccount {
  userId: string;
  email: string;
  lastUsedAt: string;
}

/**
 * Remembered under its OWN storage key, not inside the main store: an account
 * switch replaces the main store's whole persisted blob, and the list of who
 * has used this device must survive exactly that.
 */
const useAccountsStore = create<{ accounts: KnownAccount[] }>()(
  persist(() => ({ accounts: [] as KnownAccount[] }), {
    name: 'iohome-known-accounts-v1',
    storage: createJSONStorage(() => AsyncStorage),
    version: 1,
  })
);

/* ------------------------------------------------------------------ reading */

/** React: the current session. Re-renders only when a field changes. */
export const useSession = () =>
  useSessionStore(
    useShallow((s) => ({
      status: s.status,
      userId: s.userId,
      email: s.email,
      needsPlacement: s.needsPlacement,
      switching: s.switching,
    }))
  );

/** React: accounts that have signed in on this device, most recent first. */
export const useKnownAccounts = () => useAccountsStore((s) => s.accounts);

/** Plain code: a snapshot, no subscription. */
export const currentSession = (): SessionState => useSessionStore.getState();

/** Plain code: be told whenever the session changes. Returns an unsubscribe. */
export const subscribeSession = (listener: (s: SessionState, prev: SessionState) => void) =>
  useSessionStore.subscribe(listener);

/** Plain code: the signed-in user's id, or null if not (yet) signed in. */
export const getUserId = (): string | null => {
  const s = useSessionStore.getState();
  return s.status === 'signed-in' ? s.userId : null;
};

/**
 * Plain code that runs early (a capture saved during the first second of a
 * load) must not mistake "not read yet" for "signed out". Resolves once the
 * status is settled, or after `timeoutMs` with whatever is known.
 */
export function awaitAuthReady(timeoutMs = 8000): Promise<SessionState> {
  const settled = (s: SessionState) => s.status === 'signed-in' || s.status === 'signed-out';
  const now = useSessionStore.getState();
  if (settled(now)) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(useSessionStore.getState());
    }, timeoutMs);
    const unsub = useSessionStore.subscribe((s) => {
      if (!settled(s)) return;
      clearTimeout(timer);
      unsub();
      resolve(s);
    });
  });
}

/* ------------------------------------------------------------------ driving */

let started = false;
/** Guards against an older resolution landing after a newer one. */
let generation = 0;

/**
 * Start listening. Call once, on the client, from the root layout. Safe to
 * call again (no-op). Not called at module load: static web rendering imports
 * this file in Node at build time, where there is no session to read.
 */
export function startAuth(): void {
  if (started) return;
  started = true;
  // onAuthStateChange delivers INITIAL_SESSION on subscribe, so it covers the
  // stored session too; getSession() is the belt to that brace on older
  // clients. Both funnel into the same idempotent handler.
  supabase.auth.onAuthStateChange((_event, session) => schedule(session));
  void supabase.auth.getSession().then(({ data }) => schedule(data.session));
}

/**
 * Supabase holds an internal lock while it runs auth callbacks; awaiting
 * another Supabase call from inside one can deadlock. Hop off the callback
 * before doing any work.
 */
function schedule(session: Session | null) {
  setTimeout(() => void apply(session), 0);
}

async function apply(session: Session | null) {
  const prev = useSessionStore.getState();

  if (!session) {
    ++generation; // any resolution still in flight is for an account that just left
    if (prev.status !== 'signed-out') {
      useSessionStore.setState({ status: 'signed-out', userId: null, email: null, needsPlacement: false });
    }
    return;
  }

  const userId = session.user.id;
  const email = (session.user.email ?? '').toLowerCase() || null;

  // The same person announced again — a token refresh, or INITIAL_SESSION and
  // getSession() both reporting one stored session on load. Nothing to
  // resolve, and crucially this must NOT bump `generation`: doing so would
  // orphan the resolution already running for this very account and leave
  // the app stuck on 'resolving'.
  if (prev.userId === userId && (prev.status === 'signed-in' || prev.status === 'resolving')) {
    if (prev.email !== email) useSessionStore.setState({ email });
    return;
  }

  const mine = ++generation;
  useSessionStore.setState({ status: 'resolving', userId, email });

  let needsPlacement = false;
  if (email) {
    try {
      const res = await reconcileAccount(email);
      needsPlacement = res.outcome === 'switched' && !res.restored;
    } catch {
      // Could not swap state — reconcileAccount already fails closed inside;
      // anything escaping here is unexpected, so route them to be placed
      // rather than trust whatever is on the device.
      needsPlacement = true;
    }
  }
  if (mine !== generation) return; // a newer sign-in/out overtook this one

  remember(userId, email);
  useSessionStore.setState({ status: 'signed-in', needsPlacement });
}

function remember(userId: string, email: string | null) {
  if (!email) return;
  const now = new Date().toISOString();
  useAccountsStore.setState((s) => ({
    accounts: [
      { userId, email, lastUsedAt: now },
      ...s.accounts.filter((a) => a.userId !== userId),
    ],
  }));
}

export function clearNeedsPlacement(): void {
  useSessionStore.setState({ needsPlacement: false });
}

export function clearSwitching(): void {
  useSessionStore.setState({ switching: false });
}

/* ------------------------------------------------------------------ acting */

/**
 * The only sign-out. Disconnects the account and locks the device (the root
 * LockGate turns the lock into a redirect to /login — callers must not
 * navigate as well, or the two navigations race).
 */
export async function signOut(): Promise<void> {
  const email = useSessionStore.getState().email ?? '';
  try {
    await supabase.auth.signOut();
  } finally {
    // Even if the network call fails, this device stops showing the account's
    // data: the local session is already cleared by supabase-js.
    useStore.getState().lockOut(email);
  }
}

/**
 * Hand the device to a different account. Signs the current one out (one
 * live session, always) and opens sign-in on the list of accounts that have
 * used this device, instead of the "you're logged out" confirmation.
 */
export async function switchAccount(): Promise<void> {
  useSessionStore.setState({ switching: true });
  await signOut();
  useStore.getState().clearLogoutNotice();
}

/** Remove an account from this device's list. Does not touch their data. */
export function forgetAccount(userId: string): void {
  useAccountsStore.setState((s) => ({ accounts: s.accounts.filter((a) => a.userId !== userId) }));
}

/**
 * "Erase this device and start fresh". Everything local goes: the open home,
 * every other account's set-aside home, the list of accounts, the lock, and
 * the session. Cloud data is untouched — a family member signing in again
 * gets their home back from the cloud.
 *
 * The old erase reset the store to the demo and stopped there, leaving the
 * account signed in and the lock set, so it bounced straight back to the
 * sign-in page it was pressed on.
 */
export async function eraseDevice(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    /* the local session is cleared regardless */
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stashes = keys.filter((k) => k.startsWith(STASH_PREFIX));
    if (stashes.length) await AsyncStorage.multiRemove(stashes);
  } catch {
    /* storage refused; the live store is still reset below */
  }
  useAccountsStore.setState({ accounts: [] });
  useStore.getState().signOut();
  useStore.setState({
    lockedOut: false,
    pendingLogoutNotice: false,
    lastAccountEmail: undefined,
    accountEmail: undefined,
  });
}
