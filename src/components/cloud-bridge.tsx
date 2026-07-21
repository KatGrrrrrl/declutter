/**
 * CloudBridge — invisible component mounted at the root.
 *
 * Two jobs:
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

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { startRealtime, stopRealtime } from '@/lib/realtime';

export function CloudBridge() {
  const cloudHouseholdId = useStore((s) => s.cloudHouseholdId);
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
    const accountBound = Boolean(s.cloudHouseholdId || s.lastAccountEmail);
    if (s.onboarded && !s.isDemo && !s.lockedOut && accountBound) {
      s.requireSignIn(); // LockGate turns this into a redirect to /login
    }
  }, [hasSession]);

  return null;
}
