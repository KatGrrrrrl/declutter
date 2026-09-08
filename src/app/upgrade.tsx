/**
 * Inventory Our Home Pro — the upgrade screen.
 *
 * Reached from the quota meter, the limit-reached card, or a blocked
 * add-household action. Honest-by-design: no countdowns, no scarcity, no
 * shaming; the free tier is described as a real plan that keeps working.
 *
 * PAYMENTS — split by platform:
 *   - WEB: real Stripe Checkout via src/lib/billing.ts (create-checkout edge
 *     function → Stripe-hosted page → back to /settings?session_id=… where the
 *     payment is verified). Until STRIPE_SECRET_KEY is set in Supabase secrets
 *     the function answers 'payments_not_configured' and we say so honestly.
 *   - NATIVE: still a local preview — App Store / Google Play purchases arrive
 *     with the store release. <DevNote/> labels this for testers; delete it
 *     when store billing ships.
 *   - PRICES ($4.99 monthly / $39 yearly) must stay in sync with the
 *     create-checkout function's catalog (declutter_pro_monthly /
 *     declutter_pro_yearly_v2). Stripe prices are immutable, so a change means
 *     a new lookup_key — which is why the yearly one carries _v2.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { notify } from '@/components/child/shared';
import { Body, Btn, Card, Heading, Label, Muted, Screen, Title, Well } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { refreshPlan, startCheckout } from '@/lib/billing';
import { useEntitlement, useStore } from '@/lib/store';

const IS_WEB = Platform.OS === 'web';

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
    price: '$39',
    cadence: 'per year',
    note: 'Works out to $3.25 a month.',
    best: true,
  },
];

const REASSURANCES = [
  'No ads, ever.',
  'We never sell your data — subscriptions are how Inventory Our Home is funded.',
  'Your inventory, photos and stories stay yours.',
  'Cancel anytime; your inventory, backup and family sharing keep working free.',
];

export default function UpgradeScreen() {
  const router = useRouter();
  const ent = useEntitlement();
  const setPlan = useStore((s) => s.setPlan);

  const [selected, setSelected] = useState<PlanKey>('yearly');
  const [justUpgraded, setJustUpgraded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkoutNote, setCheckoutNote] = useState<string | null>(null);

  const back = () => router.back();

  /** Web: hand off to the Stripe-hosted checkout page. */
  const doWebCheckout = async () => {
    setBusy(true);
    setCheckoutNote(null);
    const res = await startCheckout(selected);
    if (res.ok) {
      // Leave `busy` on — the browser is navigating away.
      window.location.assign(res.url);
      return;
    }
    setBusy(false);
    setCheckoutNote(
      res.reason === 'payments_not_configured'
        ? 'Payments are almost ready — check back soon.'
        : res.reason === 'needs_account'
          ? 'Sign in first under Settings → Account & sync, so Pro follows your account.'
          : res.reason === 'needs_backup'
            ? 'Back up your household first (Settings → Account & sync) so Pro attaches to it.'
            : (res.error ?? 'Something went wrong starting checkout — please try again.')
    );
  };

  /** Native: local preview only until App Store / Play billing ships. */
  const doNativePreview = () => {
    setPlan('pro');
    setJustUpgraded(true);
  };

  /* ---------- already Pro ---------- */
  if (ent.pro) {
    return (
      <Screen>
        <BackRow onPress={back} />
        <Label>Inventory Our Home Pro</Label>
        <Title>{justUpgraded ? "You're all set" : "You're on Pro"}</Title>
        <Card style={styles.proCard}>
          <View style={styles.proGlyph}>
            <Ionicons name="checkmark" size={26} color={T.brassDeep} />
          </View>
          <Heading style={styles.proHeading}>AI estimates and photo splitting are on</Heading>
          <Body style={styles.proBody}>
            Ask for a value on any item, and turn one photo of a crowded shelf into
            separate items. Thank you for funding Inventory Our Home directly —
            it&apos;s why there are no ads and nothing to sell.
          </Body>
        </Card>

        <Label>What&apos;s included</Label>
        <BenefitList />

        {!IS_WEB && (
          <View style={styles.devNoteWrap}>
            <DevNote />
            {/* Preview-only escape hatch so testers can see the free tier again. */}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPlan('free');
                setJustUpgraded(false);
              }}
              hitSlop={10}
              style={({ pressed }) => [styles.quietRow, pressed && styles.pressed]}
            >
              <Text style={styles.quietText}>Switch back to Free (preview)</Text>
            </Pressable>
          </View>
        )}
      </Screen>
    );
  }

  /* ---------- paywall ---------- */
  return (
    <Screen>
      <BackRow onPress={back} />
      <Label>Inventory Our Home Pro</Label>
      <Title>A little help from AI</Title>
      <Body style={styles.lede}>
        Your inventory, cloud backup and family sharing are free. Pro adds the
        AI: a rough value for any item, so the family knows what matters, and
        photo splitting, which turns one snap of a crowded shelf into separate
        items you can decide on one at a time.
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
          label={
            IS_WEB
              ? busy
                ? 'Opening secure checkout…'
                : 'Continue to secure checkout'
              : 'Start free trial'
          }
          big
          disabled={busy}
          onPress={IS_WEB ? doWebCheckout : doNativePreview}
        />
      </View>
      {checkoutNote && <Muted style={styles.checkoutNote}>{checkoutNote}</Muted>}
      <Muted style={styles.ctaNote}>
        {IS_WEB
          ? selected === 'yearly'
            ? 'Yearly · $39 billed once a year. Secure payment by Stripe.'
            : 'Monthly · $4.99 billed each month. Secure payment by Stripe.'
          : selected === 'yearly'
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
        Not ready? The free plan keeps working — unlimited items and homes,
        backed up and shared with your family, just without the AI tools.
      </Muted>

      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          if (IS_WEB) {
            // Web "restore" = re-read the entitlement from the cloud.
            await refreshPlan();
            notify('Plan checked', 'If this household has an active subscription, Pro is now on.');
          } else {
            notify('Restore purchases', 'Restore will work once App Store purchases are live.');
          }
        }}
        hitSlop={10}
        style={({ pressed }) => [styles.quietRow, pressed && styles.pressed]}
      >
        <Text style={styles.quietText}>Restore purchases</Text>
      </Pressable>

      {!IS_WEB && (
        <View style={styles.devNoteWrap}>
          <DevNote />
        </View>
      )}
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
    icon: 'pricetag-outline',
    title: 'AI value estimates',
    body: 'A rough replacement value for any item, from its photo and name — handy for insurance and for fair shares.',
  },
  {
    icon: 'images-outline',
    title: 'Photo splitting',
    body: 'One photo of a whole shelf becomes separate items, each ready for its own decision.',
  },
  {
    icon: 'heart-outline',
    title: 'Funds the app, not ads',
    body: 'Cloud backup and family sharing stay free for everyone; Pro is how the lights stay on.',
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

/** NATIVE-ONLY honesty row for testers — delete when store billing ships. */
function DevNote() {
  return (
    <Muted style={styles.devNote}>
      Preview: App Store purchases arrive with the store release — no payment is
      processed here yet.
    </Muted>
  );
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
  checkoutNote: {
    textAlign: 'center',
    marginTop: Spacing.two,
    fontSize: 13.5,
    lineHeight: 19,
    color: T.brassDeep,
  },

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
