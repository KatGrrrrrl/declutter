/**
 * SessionBridge — the start-up sequence for a signed-in account, in order.
 * Invisible; mounted once at the root.
 *
 *   session → memberships → (placement | open household) → realtime → outbox → photos
 *
 * It replaces CloudBridge and RestorePrompt, which between them ran seven
 * effects on overlapping triggers, raced the login screen over the same
 * sign-in, merged cloud data into device data with last-writer-wins, and
 * coordinated with each other through a 2.5 second sleep.
 *
 * What each step means now:
 * - Placement: auth.ts already matched the device to the account. If that
 *   left the account with no home open, /login places them (their own home,
 *   a waiting invitation, or starting one).
 * - Open household: the open home is refreshed FROM the cloud (pull and
 *   replace, with this account's unsent changes laid back on top), once per
 *   account per household per app launch, and again whenever the connection
 *   comes back. There is no merge that could resurrect a deletion.
 * - A home that only ever lived on this device uploads under the account
 *   that owns the device — the cloud is the source of truth now.
 * - Realtime only while a shared home is open.
 * - Photos that haven't reached the cloud are queued through the outbox like
 *   every other change, so a failure is visible instead of silent.
 * - Signed out while holding a shared home: lock.
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { notify } from '@/components/child/shared';
import { clearNeedsPlacement, useSession } from '@/lib/auth';
import { openHousehold, uploadLocalHousehold } from '@/lib/household';
import { useMembershipReady, useMyMembership } from '@/lib/membership';
import { enqueue, nudgeOutbox } from '@/lib/outbox';
import { startRealtime, stopRealtime } from '@/lib/realtime';
import { linkedCloudId, useStore } from '@/lib/store';

export function SessionBridge() {
  const router = useRouter();
  const { status, userId, needsPlacement } = useSession();
  const cloudHouseholdId = useStore(linkedCloudId);
  const activeHouseholdId = useStore((s) => s.activeHouseholdId);
  const isDemo = useStore((s) => s.isDemo);
  const onboarded = useStore((s) => s.onboarded);
  const membershipReady = useMembershipReady();
  const mine = useMyMembership();

  // 1. Placement.
  useEffect(() => {
    if (status !== 'signed-in' || !needsPlacement) return;
    clearNeedsPlacement();
    router.replace('/login');
  }, [status, needsPlacement, router]);

  // 2. Refresh the open shared household from the cloud, once per
  //    account + household per launch (and on reconnect, below).
  const refreshed = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'signed-in' || !userId || !cloudHouseholdId || isDemo) return;
    const key = `${userId}:${cloudHouseholdId}`;
    if (refreshed.current === key) return;
    refreshed.current = key;
    void openHousehold(cloudHouseholdId).then((res) => {
      if (res.ok || res.retry) return;
      // Not a connection problem: this account can't reach the home any more
      // (removed from it, or it was deleted). Say so once; keep what's here.
      notify('This home isn’t shared with you any more', res.error);
    });
  }, [status, userId, cloudHouseholdId, isDemo]);

  // 2b. A home that only ever lived on this device reaches the cloud.
  useEffect(() => {
    if (status !== 'signed-in' || isDemo || !onboarded || cloudHouseholdId) return;
    const s = useStore.getState();
    const local = s.households.find((h) => h.id === activeHouseholdId && !h.cloudLinkedAt);
    if (!local) return;
    void uploadLocalHousehold(local.id).then((res) => {
      if (!res.ok && !res.retry) notify('This home couldn’t be shared yet', res.error);
    });
  }, [status, isDemo, onboarded, cloudHouseholdId, activeHouseholdId]);

  // 3. Realtime while a shared home is open and we're a member of it.
  useEffect(() => {
    if (status === 'signed-in' && cloudHouseholdId && !isDemo && mine) {
      startRealtime(cloudHouseholdId);
      return stopRealtime;
    }
    stopRealtime();
  }, [status, cloudHouseholdId, isDemo, mine]);

  // 4. Photos still only on this device go through the outbox.
  useEffect(() => {
    if (status !== 'signed-in' || !cloudHouseholdId || isDemo || !membershipReady) return;
    const s = useStore.getState();
    for (const item of s.items) {
      if (item.localOnly || !item.photoUri) continue;
      // A path into a different household is as good as none (a deleted and
      // re-created home leaves unreachable bytes behind).
      if (item.remotePhotoPath?.startsWith(`${cloudHouseholdId}/`)) continue;
      enqueue({ kind: 'photo.upload', householdId: cloudHouseholdId, key: item.id, payload: { item } });
    }
  }, [status, cloudHouseholdId, isDemo, membershipReady]);

  // 5. Connection back → refresh the open home and send what's waiting.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onOnline = () => {
      refreshed.current = null;
      nudgeOutbox();
      const hid = linkedCloudId(useStore.getState());
      if (hid) void openHousehold(hid);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // 6. Signed out while holding a shared home: lock.
  useEffect(() => {
    if (status !== 'signed-out') return;
    const s = useStore.getState();
    const accountBound = s.households.some((h) => h.cloudLinkedAt) || Boolean(s.lastAccountEmail);
    if (s.onboarded && !s.isDemo && !s.lockedOut && accountBound) s.requireSignIn();
  }, [status]);

  return null;
}
