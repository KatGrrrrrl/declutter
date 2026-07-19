/**
 * Declutter Pro — the upgrade screen.
 *
 * Reached from the quota meter, the limit-reached card, or a blocked
 * add-household action. Honest-by-design: no countdowns, no scarcity, no
 * shaming; the free tier is described as a real plan that keeps working.
 *
 * PAYMENTS ARE NOT WIRED YET. There is no RevenueCat (or other) SDK in the
 * app, so:
 *   - PRICES BELOW ARE PLACEHOLDERS. Real prices come from the store product
 *     catalog via RevenueCat offerings once payments land; do not treat
 *     $4.99 / $49.99 as final.
 *   - "Start free trial" just calls setPlan('pro') locally.
 *   - The <DevNote/> row at the bottom tells testers this. DELETE <DevNote/>
 *     (and this caveat) when real purchases ship.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { notify } from '@/components/child/shared';
import { Body, Btn, Card, Heading, Label, Muted, Screen, Title, Well } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { FREE_HOUSEHOLD_LIMIT, FREE_ITEM_LIMIT, useEntitlement, useStore } from '@/lib/store';

type PlanKey = 'monthly' | 'yearly';

/** PLACEHOLDER PRICING — replace with live store products when payments ship. */
const PLANS: {
  key: PlanKey;
  name: string;
  price: string;
  cadence: string;
  note: string;
  best?: boolean;
}[] = [
  {
    key: 'monthly',
    name: 'Monthly',
    price: '$4.99',
    cadence: 'per month',
    note: 'Stop any month you like.',
  },
  {
    key: 'yearly',
    name: 'Yearly',
    price: '$49.99',
    cadence: 'per year',
    note: 'Works out to $4.17 a month — two months free.',
    best: true,
  },
];

const REASSURANCES = [
  'No ads, ever.',
  'We never sell your data — subscriptions are how Declutter is funded.',
  'Your inventory, photos and stories stay yours.',
  'Cancel anytime; your first household and its items keep working.',
];

export default function UpgradeScreen() {
  const router = useRouter();
  const ent = useEntitlement();
  const setPlan = useStore((s) => s.setPlan);

  const [selected, setSelected] = useState<PlanKey>('yearly');
  const [justUpgraded, setJustUpgraded] = useState(false);

  const back = () => router.back();

  /* ---------- already Pro ---------- */
  if (ent.pro) {
    return (
      <Screen>
        <BackRow onPress={back} />
        <Label>Declutter Pro</Label>
        <Title>{justUpgraded ? "You're all set" : "You're on Pro"}</Title>
        <Card style={styles.proCard}>
          <View style={styles.proGlyph}>
            <Ionicons name="checkmark" size={26} color={T.brassDeep} />
          </View>
          <Heading style={styles.proHeading}>Unlimited items, unlimited homes</Heading>
          <Body style={styles.proBody}>
            Photograph as much of the house as you like, and keep a separate inventory
            for every home in the family. Thank you for funding Declutter directly —
            it&apos;s why there are no ads and nothing to sell.
          </Body>
        </Card>

        <Label>What&apos;s included</Label>
        <BenefitList />

        <View style={styles.devNoteWrap}>
          <DevNote />
          {/* Demo-only escape hatch so testers can see the free tier again. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPlan('free');
              setJustUpgraded(false);
            }}
            hitSlop={10}
            style={({ pressed }) => [styles.quietRow, pressed && styles.pressed]}
          >
            <Text style={styles.quietText}>Switch back to Free (demo)</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  /* ---------- paywall ---------- */
  return (
    <Screen>
      <BackRow onPress={back} />
      <Label>Declutter Pro</Label>
      <Title>Room for the whole house</Title>
      <Body style={styles.lede}>
        You&apos;ve used {ent.itemsUsed} of your {FREE_ITEM_LIMIT} free items. Pro lifts
        the cap, so a full home — the attic, the garage, the good china — fits in one
        catalog. And you can keep a second household: Mum&apos;s house and the cottage,
        each with its own rooms, decisions and stories.
      </Body>

      <Label>Choose a plan</Label>
      {PLANS.map((p) => {
        const on = selected === p.key;
        return (
          <Pressable
            key={p.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${p.name}, ${p.price} ${p.cadence}`}
            onPress={() => setSelected(p.key)}
            style={({ pressed }) => [
              styles.planCard,
              on && styles.planCardOn,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.planTop}>
              <Heading style={styles.planName}>{p.name}</Heading>
              {p.best && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Best value</Text>
                </View>
              )}
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{p.price}</Text>
              <Muted style={styles.cadence}>{p.cadence}</Muted>
            </View>
            <Muted style={styles.planNote}>{p.note}</Muted>
          </Pressable>
        );
      })}

      <View style={styles.cta}>
        <Btn
          label="Start free trial"
          big
          onPress={() => {
            // No payment SDK yet — grant the entitlement locally.
            setPlan('pro');
            setJustUpgraded(true);
          }}
        />
      </View>
      <Muted style={styles.ctaNote}>
        {selected === 'yearly'
          ? 'Yearly · billed once a year after your trial.'
          : 'Monthly · billed each month after your trial.'}
      </Muted>

      <Label>What you get</Label>
      <BenefitList />

      <Label>What stays true</Label>
      <Well style={styles.reassure}>
        {REASSURANCES.map((r) => (
          <View key={r} style={styles.bulletRow}>
            <Ionicons name="shield-checkmark-outline" size={15} color={T.brassDeep} />
            <Body style={styles.bulletText}>{r}</Body>
          </View>
        ))}
      </Well>

      <Muted style={styles.freeNote}>
        Not ready? The free plan keeps working — {FREE_ITEM_LIMIT} items in{' '}
        {FREE_HOUSEHOLD_LIMIT === 1 ? 'one household' : `${FREE_HOUSEHOLD_LIMIT} households`}
        , with every feature above it.
      </Muted>

      <Pressable
        accessibilityRole="button"
        onPress={() => notify('Restore purchases', 'Restore will work once payments are live')}
        hitSlop={10}
        style={({ pressed }) => [styles.quietRow, pressed && styles.pressed]}
      >
        <Text style={styles.quietText}>Restore purchases</Text>
      </Pressable>

      <View style={styles.devNoteWrap}>
        <DevNote />
      </View>
    </Screen>
  );
}

/* ---------- pieces ---------- */

function BackRow({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Ionicons name="chevron-back" size={18} color={T.inkSoft} />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  );
}

const BENEFITS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'infinite-outline',
    title: 'Unlimited items',
    body: 'Every drawer, every shelf — no counting as you go.',
  },
  {
    icon: 'home-outline',
    title: 'More than one household',
    body: 'Mum’s house and the cottage, kept separately.',
  },
  {
    icon: 'people-outline',
    title: 'Everything you already rely on',
    body: 'Swipe decisions, voice stories, heirs and rooms — all unchanged.',
  },
];

function BenefitList() {
  return (
    <View style={styles.benefits}>
      {BENEFITS.map((b) => (
        <View key={b.title} style={styles.benefitRow}>
          <View style={styles.benefitGlyph}>
            <Ionicons name={b.icon} size={18} color={T.brassDeep} />
          </View>
          <View style={styles.benefitMain}>
            <Heading style={styles.benefitTitle}>{b.title}</Heading>
            <Muted style={styles.benefitBody}>{b.body}</Muted>
          </View>
        </View>
      ))}
    </View>
  );
}

/** DEV-ONLY honesty row for testers — delete when real payments ship. */
function DevNote() {
  return <Muted style={styles.devNote}>Demo: no payment is processed yet.</Muted>;
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingRight: Spacing.three,
  },
  backText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },

  lede: { color: T.inkSoft, marginTop: Spacing.two, fontSize: 15.5, lineHeight: 23 },

  planCard: {
    backgroundColor: T.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: T.line,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    minHeight: 52,
  },
  planCardOn: { borderColor: T.brass, backgroundColor: T.brassTint },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  planName: { fontSize: 19, flex: 1 },
  badge: {
    backgroundColor: T.brass,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 6 },
  price: { fontFamily: Fonts?.serif, fontSize: 28, fontWeight: '600', color: T.heading },
  cadence: { fontSize: 14 },
  planNote: { fontSize: 13.5, marginTop: 4 },

  cta: { marginTop: Spacing.three },
  ctaNote: { textAlign: 'center', marginTop: Spacing.two, fontSize: 12.5 },

  benefits: { gap: Spacing.three },
  benefitRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  benefitGlyph: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: T.brassTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitMain: { flex: 1 },
  benefitTitle: { fontSize: 16.5 },
  benefitBody: { fontSize: 14, lineHeight: 20, marginTop: 2 },

  reassure: { gap: Spacing.two },
  bulletRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  bulletText: { flex: 1, fontSize: 14.5, lineHeight: 21, color: T.inkSoft },

  freeNote: { marginTop: Spacing.four, textAlign: 'center', fontSize: 13.5, lineHeight: 20 },

  quietRow: { alignSelf: 'center', minHeight: 52, justifyContent: 'center', paddingHorizontal: Spacing.three },
  quietText: { fontSize: 15, fontWeight: '600', color: T.brassDeep },
  pressed: { opacity: 0.7 },

  proCard: { marginTop: Spacing.two, alignItems: 'center' },
  proGlyph: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: T.brassTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proHeading: { marginTop: Spacing.three, textAlign: 'center' },
  proBody: { color: T.inkSoft, textAlign: 'center', marginTop: Spacing.two },

  devNoteWrap: { marginTop: Spacing.four, alignItems: 'center', gap: Spacing.two },
  devNote: { fontSize: 12.5, textAlign: 'center', color: T.inkFaint },
});
