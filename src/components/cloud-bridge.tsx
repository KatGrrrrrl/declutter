/**
 * CloudBridge — invisible component mounted at the root.
 *
 * Three jobs:
 * 0. Reconcile on connect: confirm the household we have open is one this
 *    account belongs to in the cloud, adopt the link, and send up any items
 *    the cloud has never seen — the backlog from before the household was
 *    linked, or from being offline. Without this, items only reached the
 *    cloud if they happened to be added while already linked, so anyone added
 *    to the household later could not see the earlier ones.
 * 1. While a session and a synced household exist, keep the realtime
 *    subscription alive so family devices stay live with each other.
 * 2. Session enforcement: if this device holds a REAL household that has ever
 *    been tied to an account (cloud-linked, or a known last account email) and
 *    there is no valid session — expired, revoked, or cleared — lock the app
 *    to the login screen. Without this, visiting the site signed-out dropped
 *    straight into the household. The demo and never-signed-in local
 *    households are exempt: there is no account to demand.
 *
 * Renders nothing.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { reconcileAccount } from '@/lib/account-switch';
import { linkedCloudId, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { startRealtime, stopRealtime } from '@/lib/realtime';

export function CloudBridge() {
  const router = useRouter();
  const cloudHouseholdId = useStore(linkedCloudId);
  const activeHouseholdId = useStore((s) => s.activeHouseholdId);
  const isDemo = useStore((s) => s.isDemo);
  // Tri-state: null = not yet determined. The sign-in gate must never fire
  // before the first getSession() resolves, or every load would flash-lock.
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setHasSession(Boolean(s))
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  /**
   * Whose session is this? (job 0a — before anything renders household data.)
   *
   * Checking identity only at the moment of signing in was not enough: a
   * device already carrying a session just reloads, and a stale sign-in as
   * somebody else kept showing the previous person's household in the
   * previous person's role. The check belongs wherever a session turns up,
   * which is here.
   *
   * reconcileAccount asks the server whether this account may actually reach
   * the home that is open, and sets it aside (recoverably) if not. When it
   * does, we hand over to /login, whose own sign-in path already knows how
   * to place someone: their own home, the invitation waiting for them, or
   * starting a home of their own.
   */
  useEffect(() => {
    if (!hasSession || isDemo) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      if (!email || cancelled) return;
      const res = await reconcileAccount(email);
      if (!cancelled && res.outcome === 'switched' && !res.restored) {
        router.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession, isDemo]);

  // Reconcile on connect (job 0). Keyed on the household actually open, so
  // this also runs after switching households or starting a fresh one.
  useEffect(() => {
    if (!hasSession || !activeHouseholdId || isDemo) return;
    void (async () => {
      try {
        const { reconcileHousehold, pullHousehold } = await import('@/lib/sync');
        const s = useStore.getState();
        const res = await reconcileHousehold(activeHouseholdId, s.items, s.collections, s.userName);
        // Only adopt the link if that household is still the one open — the
        // user may have switched while this was in flight.
        if (res.linked && useStore.getState().activeHouseholdId === activeHouseholdId) {
          useStore.getState().markCloudLinked(activeHouseholdId);
          // Refresh sync: pull what the cloud has and merge it in, so a
          // reload catches everything added elsewhere while this device was
          // closed. Realtime only covers changes made while we're listening;
          // without this, an item added from the phone overnight never
          // appeared on the laptop until a manual Restore. Push (reconcile)
          // runs first so the merge sees the union. Additive only — see
          // store.mergeCloudData.
          const pull = await pullHousehold(activeHouseholdId);
          if (
            pull.ok &&
            pull.snapshot &&
            useStore.getState().activeHouseholdId === activeHouseholdId
          ) {
            useStore.getState().mergeCloudData(pull.snapshot);
          }

          // Photos last. The catalog reaching the cloud is not the same as the
          // photos reaching it: a capture-time upload can lose the race with
          // its own item row, fail offline, or — after a household is deleted
          // and re-created — leave a path pointing into the old home. Any of
          // those left the photo on the capturing device forever, because the
          // only sweep was behind the manual "Back up" button in Settings.
          // The person who took the photo still saw it locally and had no way
          // to know the rest of the family couldn't.
          if (useStore.getState().activeHouseholdId === activeHouseholdId) {
            const { uploadPendingPhotos } = await import('@/lib/photo-sync');
            await uploadPendingPhotos();
          }
        }
      } catch {
        /* offline — the next load, or a manual backup, catches up */
      }
    })();
  }, [hasSession, activeHouseholdId, isDemo]);

  // Realtime lifecycle.
  useEffect(() => {
    if (hasSession && cloudHouseholdId && !isDemo) {
      startRealtime(cloudHouseholdId);
      return stopRealtime;
    }
    stopRealtime();
  }, [hasSession, cloudHouseholdId, isDemo]);

  // Session enforcement (job 2).
  useEffect(() => {
    if (hasSession !== false) return; // unknown or signed in — nothing to do
    const s = useStore.getState();
    const accountBound = s.households.some((h) => h.cloudLinkedAt) || Boolean(s.lastAccountEmail);
    if (s.onboarded && !s.isDemo && !s.lockedOut && accountBound) {
      s.requireSignIn(); // LockGate turns this into a redirect to /login
    }
  }, [hasSession]);

  return null;
}
