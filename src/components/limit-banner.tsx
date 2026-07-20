/**
 * Free-tier quota UI. Two pieces, both self-sufficient (they read the store
 * themselves, so a screen can drop them in without threading props):
 *
 *   <ItemQuotaMeter/>      slim usage bar + "X of 50 items" caption
 *   <LimitReachedCard/>    warm explainer shown in place of a capture form
 *
 * Both render nothing on Pro. Tone rule: the free tier is a real, working
 * product — never shame the user for filling it up.
 */

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Btn, Card, Heading, Muted } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { useEntitlement } from '@/lib/store';

/**
 * Slim progress bar with an "Upgrade" affordance. Neutral while there's room,
 * brass once they're close, and toss-red once the cap is hit.
 */
export function ItemQuotaMeter({ style }: { style?: object }) {
  const router = useRouter();
  const ent = useEntitlement();

  if (ent.pro) return null;

  const pct = Math.min(1, ent.itemsUsed / Math.max(1, ent.itemLimit));
  const barColor = ent.atItemLimit ? T.toss : ent.nearItemLimit ? T.brass : T.inkFaint;
  const caption = ent.atItemLimit
    ? `${ent.itemsUsed} of ${ent.itemLimit} items · free plan is full`
    : `${ent.itemsUsed} of ${ent.itemLimit} items on the free plan`;

  return (
    <View style={[styles.meter, style]}>
      <View style={styles.track}>
        <View
          style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]}
        />
      </View>
      <View style={styles.meterRow}>
        <Muted style={styles.caption}>{caption}</Muted>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See upgrade options"
          onPress={() => router.push('/upgrade')}
          hitSlop={12}
          style={({ pressed }) => [styles.upgradeHit, pressed && styles.pressed]}
        >
          <Text style={styles.upgradeText}>Upgrade</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Shown instead of the capture form once the 50th item lands. Explains the
 * cap, confirms nothing already catalogued is lost, and offers the upgrade.
 */
export function LimitReachedCard({ style }: { style?: object }) {
  const router = useRouter();
  const ent = useEntitlement();

  if (ent.pro) return null;

  return (
    <Card style={[styles.card, style]}>
      <Heading style={styles.cardHeading}>
        You&apos;ve catalogued {ent.itemLimit} items — that&apos;s a whole lot of house
      </Heading>
      <Muted style={styles.cardBody}>
        The free plan holds {ent.itemLimit} items in one household. Everything you&apos;ve
        already added stays exactly where it is — decisions, stories and all. To keep
        photographing the rest of the house, move to Inventory Our Home Pro for unlimited items.
      </Muted>
      <View style={styles.cardCta}>
        <Btn label="See Pro" big onPress={() => router.push('/upgrade')} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  meter: { marginBottom: Spacing.three },
  track: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: T.sunken,
    overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: Radius.pill },
  meterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: 6,
  },
  caption: { fontSize: 12.5, flex: 1 },
  upgradeHit: { paddingVertical: 8, paddingHorizontal: 4, minHeight: 36, justifyContent: 'center' },
  upgradeText: { fontSize: 13, fontWeight: '700', color: T.brassDeep },
  pressed: { opacity: 0.6 },

  card: { marginTop: Spacing.three },
  cardHeading: { fontSize: 20, lineHeight: 27 },
  cardBody: { fontSize: 15, lineHeight: 22, marginTop: Spacing.two },
  cardCta: { marginTop: Spacing.four },
});
