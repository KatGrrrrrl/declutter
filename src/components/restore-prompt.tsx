/**
 * "Your backup is waiting" strip — shown when the signed-in account has a
 * cloud household that is NOT on this device. Pairing a device to a backup
 * used to hide behind Settings → Account & sync → Restore, and nobody found
 * it ("I backed up from my phone — it did not sync"). This surfaces the one
 * missing step right where the person is, as a single tap.
 *
 * Careful about when it appears: never in the demo, never while locked out,
 * never for the household that is already open or already on the device, and
 * only after giving CloudBridge's reconcile a moment to adopt a link — a
 * household that IS this account's simply links itself and needs no prompt.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { notify } from '@/components/child/shared';
import { Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

/** How long to let reconcile run before offering the banner. */
const SETTLE_MS = 2500;

export function RestorePrompt() {
  const onboarded = useStore((s) => s.onboarded);
  const isDemo = useStore((s) => s.isDemo);
  const lockedOut = useStore((s) => s.lockedOut);
  const activeHouseholdId = useStore((s) => s.activeHouseholdId);
  const activeLinked = useStore((s) =>
    Boolean(s.households.find((h) => h.id === s.activeHouseholdId)?.cloudLinkedAt)
  );
  const restoreSnapshot = useStore((s) => s.restoreSnapshot);

  const [hasSession, setHasSession] = useState(false);
  const [offer, setOffer] = useState<{
    id: string;
    name: string;
    more: number;
    /** The device household this offer was computed against. */
    whileOpen: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setHasSession(Boolean(s)));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!hasSession || !onboarded || isDemo || lockedOut || activeLinked) return;
    let cancelled = false;
    // Give CloudBridge's reconcile a head start: if the open household belongs
    // to this account, it links itself and this prompt never shows.
    const timer = setTimeout(async () => {
      try {
        const { listMyHouseholds } = await import('@/lib/sync');
        const mine = await listMyHouseholds();
        if (cancelled || !mine.ok) return;
        const s = useStore.getState();
        if (s.activeHouseholdId !== activeHouseholdId) return; // switched meanwhile
        const localIds = new Set(s.households.map((h) => h.id));
        // Offer only homes this DEVICE doesn't hold at all — one already here
        // (active or not) is a switch, not a restore.
        const waiting = mine.households.filter((h) => !localIds.has(h.id));
        if (waiting.length) {
          setOffer({
            id: waiting[0].id,
            name: waiting[0].name,
            more: waiting.length - 1,
            whileOpen: activeHouseholdId,
          });
        }
      } catch {
        /* offline — nothing to offer */
      }
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasSession, onboarded, isDemo, lockedOut, activeLinked, activeHouseholdId]);

  // Staleness is handled here rather than by resetting state in the effect:
  // an offer computed for another household, or made moot by sign-out, the
  // demo, a lock, or the household linking itself, simply stops rendering.
  if (
    !offer ||
    dismissed.includes(offer.id) ||
    offer.whileOpen !== activeHouseholdId ||
    !hasSession ||
    !onboarded ||
    isDemo ||
    lockedOut ||
    activeLinked
  ) {
    return null;
  }

  const load = async () => {
    setBusy(true);
    try {
      const { pullHousehold } = await import('@/lib/sync');
      const res = await pullHousehold(offer.id);
      if (!res.ok || !res.snapshot) {
        notify('Couldn’t load it', res.error ?? 'Try again in a moment.');
        return;
      }
      restoreSnapshot(res.snapshot);
      setOffer(null);
      notify(
        'Welcome back',
        `“${res.snapshot.householdName}” is on this device now — ${res.snapshot.items.length} item${res.snapshot.items.length === 1 ? '' : 's'}. It stays in step by itself from here.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.strip}>
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={3}>
        Your backup <Text style={styles.who}>“{offer.name}”</Text> is waiting in your
        account{offer.more > 0 ? ` (and ${offer.more} more, in Settings)` : ''}.
      </Text>
      {busy ? (
        <ActivityIndicator size="small" color={T.brassDeep} />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={load}
            style={({ pressed }) => [styles.loadBtn, pressed && styles.pressed]}
          >
            <Text style={styles.loadText}>Load it</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Not now"
            onPress={() => setDismissed((d) => [...d, offer.id])}
            style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}
          >
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: Spacing.four,
    backgroundColor: T.brassTint,
    borderBottomWidth: 1,
    borderBottomColor: T.brass,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: T.brass },
  text: { flex: 1, fontSize: 13.5, lineHeight: 18, color: T.inkSoft },
  who: { fontWeight: '700', color: T.brassDeep },
  pressed: { opacity: 0.7 },
  loadBtn: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: T.ink,
    paddingHorizontal: Spacing.three,
  },
  loadText: { color: T.surface, fontSize: 13.5, fontWeight: '700' },
  dismissBtn: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 6 },
  dismissText: { fontSize: 13, fontWeight: '600', color: T.inkSoft },
});
