/**
 * CloudBridge — invisible component mounted at the root. While a session and
 * a synced household exist, it keeps the realtime subscription alive so
 * family devices stay live with each other. Renders nothing.
 */

import { useEffect, useState } from 'react';

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { startRealtime, stopRealtime } from '@/lib/realtime';

export function CloudBridge() {
  const cloudHouseholdId = useStore((s) => s.cloudHouseholdId);
  const isDemo = useStore((s) => s.isDemo);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setHasSession(Boolean(s))
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (hasSession && cloudHouseholdId && !isDemo) {
      startRealtime(cloudHouseholdId);
      return stopRealtime;
    }
    stopRealtime();
  }, [hasSession, cloudHouseholdId, isDemo]);

  return null;
}
