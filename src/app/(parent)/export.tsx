/**
 * Export & peace of mind — the memorandum card (Phase-2 stub), insurance and
 * donation stubs, the link into Legacy access, and a quiet demo control to
 * preview the helper view.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SETTINGS_ROUTE } from '@/components/settings/routes';
import { Btn, Card, Heading, Muted, Row, Screen, Title } from '@/components/ui';
import { Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';

export default function ExportScreen() {
  const router = useRouter();
  const items = useStore((s) => s.items);
  const setRole = useStore((s) => s.setRole);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const kept = items.filter((i) => i.decision === 'keep');
  const keptWithHeirs = kept.filter((i) => i.heirPersonId);
  const heirCount = new Set(keptWithHeirs.map((i) => i.heirPersonId)).size;
  const donatedCount = items.filter((i) => i.decision === 'donate').length;

  const comingSoon = () => {
    setToast(
      'Coming in Phase 2 — the list you are building is already saved here.'
    );
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const viewAsHelper = () => {
    setRole('contributor');
    router.replace('/');
  };

  return (
    <Screen>
      <Text style={styles.eyebrow}>Peace of mind</Text>
      <Title style={styles.title}>Export</Title>
      <Muted style={styles.sub}>
        Everything you&rsquo;ve decided, ready to hand to the people who need
        it.
      </Muted>

      {/* Personal Property Memorandum — the feature card */}
      <Card style={styles.featureCard}>
        <Row style={styles.cardTop}>
          <View style={styles.icon}>
            <Ionicons name="document-text-outline" size={22} color={T.brassDeep} />
          </View>
          <View style={styles.cardMain}>
            <Heading style={styles.cardTitle}>
              Personal Property Memorandum
            </Heading>
            <Muted style={styles.cardMeta}>
              {kept.length} {kept.length === 1 ? 'keepsake' : 'keepsakes'} ·{' '}
              {heirCount} {heirCount === 1 ? 'heir' : 'heirs'} chosen
            </Muted>
          </View>
        </Row>
        <Row style={styles.btns}>
          <View style={styles.flex}>
            <Btn label="Preview" kind="quiet" onPress={comingSoon} />
          </View>
          <View style={styles.flex}>
            <Btn label="Export PDF" kind="primary" onPress={comingSoon} />
          </View>
        </Row>
        {toast ? <Text style={styles.toast}>{toast}</Text> : null}
        <Row style={styles.disclaimer}>
          <Ionicons name="shield-outline" size={14} color={T.inkFaint} style={styles.discIcon} />
          <Text style={styles.discText}>
            Not legal advice. In many states this can be referenced by your
            will — take it to your attorney to make it binding.
          </Text>
        </Row>
      </Card>

      {/* Stubs */}
      <Card style={styles.miniCard}>
        <Row style={styles.cardTop}>
          <View style={[styles.icon, styles.iconSm]}>
            <Ionicons name="home-outline" size={19} color={T.brassDeep} />
          </View>
          <View style={styles.cardMain}>
            <Heading style={styles.miniTitle}>Insurance inventory</Heading>
            <Muted style={styles.cardMeta}>Same photos, as a valuation report</Muted>
          </View>
        </Row>
      </Card>
      <Card style={styles.miniCard}>
        <Row style={styles.cardTop}>
          <View style={[styles.icon, styles.iconSm]}>
            <Ionicons name="receipt-outline" size={19} color={T.brassDeep} />
          </View>
          <View style={styles.cardMain}>
            <Heading style={styles.miniTitle}>Donation tax receipts</Heading>
            <Muted style={styles.cardMeta}>
              {donatedCount} donated · itemized for filing
            </Muted>
          </View>
        </Row>
      </Card>

      {/* Legacy access */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Legacy access"
        onPress={() => router.push('/(parent)/legacy')}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        <Card style={styles.miniCard}>
          <Row style={styles.cardTop}>
            <View style={[styles.icon, styles.iconSm]}>
              <Ionicons name="lock-closed-outline" size={19} color={T.brassDeep} />
            </View>
            <View style={styles.cardMain}>
              <Heading style={styles.miniTitle}>Legacy access</Heading>
              <Muted style={styles.cardMeta}>
                Rebecca, your executor · read-only, when the time comes
              </Muted>
            </View>
            <Ionicons name="chevron-forward" size={20} color={T.inkFaint} />
          </Row>
        </Card>
      </Pressable>

      {/* Demo control — preview the helper experience */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(SETTINGS_ROUTE)}
        style={({ pressed }) => [styles.demoRow, pressed && styles.pressed]}
      >
        <Ionicons name="settings-outline" size={17} color={T.inkSoft} />
        <Text style={styles.settingsText}>Settings</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={viewAsHelper}
        style={({ pressed }) => [styles.demoRow, pressed && styles.pressed]}
      >
        <Ionicons name="swap-horizontal-outline" size={17} color={T.inkFaint} />
        <Text style={styles.demoText}>View as helper</Text>
      </Pressable>
      <Muted style={styles.demoNote}>
        Preview only — switches this device to the family-helper view.
      </Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    marginTop: Spacing.three,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: T.brassDeep,
  },
  title: { marginTop: 4, marginBottom: 0 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 4, marginBottom: Spacing.three },

  featureCard: {
    borderColor: T.brass,
    backgroundColor: T.brassTint,
    marginBottom: Spacing.three,
  },
  miniCard: { marginBottom: Spacing.three },
  cardTop: { alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSm: { width: 38, height: 38 },
  cardMain: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 18 },
  miniTitle: { fontSize: 16 },
  cardMeta: { fontSize: 13.5, marginTop: 3 },

  btns: { marginTop: Spacing.three, gap: Spacing.two },
  flex: { flex: 1 },
  toast: {
    marginTop: Spacing.two,
    fontSize: 14,
    fontWeight: '600',
    color: T.brassDeep,
    textAlign: 'center',
  },
  disclaimer: { marginTop: Spacing.three, alignItems: 'flex-start', gap: 7 },
  discIcon: { marginTop: 2 },
  discText: { flex: 1, fontSize: 12, lineHeight: 17, color: T.inkFaint },

  demoRow: {
    marginTop: Spacing.four,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  demoText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
  settingsText: { fontSize: 16, fontWeight: '700', color: T.ink },
  demoNote: { textAlign: 'center', fontSize: 12.5, marginTop: 2 },
  pressed: { opacity: 0.7 },
});
