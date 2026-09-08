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

import { useEffect, useState } from 'react';

import { linkedCloudId, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { startRealtime, stopRealtime } from '@/lib/realtime';

export function CloudBridge() {
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
