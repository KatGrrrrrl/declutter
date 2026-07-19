/**
 * Settings — the account screen for both roles.
 *
 * Covers the two things the app was missing: a way to leave the seeded demo
 * household and start a real inventory, and a way to sign out. Everything here
 * is honest about the current (local-only, no-cloud) reality: signing out
 * erases the device copy because there is nowhere else for it to live yet.
 */

import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { notify } from '@/components/child/shared';
import { AccountSync } from '@/components/settings/account-sync';
import { UPGRADE_ROUTE } from '@/components/settings/routes';
import { Body, Btn, Card, Heading, Label, Muted, Row, Screen, Title, Well } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { selectEntitlement, useStore } from '@/lib/store';

export default function SettingsScreen() {
  const router = useRouter();

  // Whole-state read: selectEntitlement builds a fresh object each call, so
  // passing it to useStore as a selector would break reference equality.
  const state = useStore();
  const ent = selectEntitlement(state);
  const { households, activeHouseholdId, householdName, userName, isDemo } = state;
  const { switchHousehold, addHousehold, startFresh, signOut } = state;

  const [addingHousehold, setAddingHousehold] = useState(false);
  const [newHouseholdName, setNewHouseholdName] = useState('');
  const [newDeciderNames, setNewDeciderNames] = useState('');
  const [freshName, setFreshName] = useState(householdName);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);

  const version = Constants.expoConfig?.version ?? '—';
  const meterPct = ent.pro
    ? 100
    : Math.min(100, Math.round((ent.itemsUsed / Math.max(1, ent.itemLimit)) * 100));

  const goUpgrade = () => router.push(UPGRADE_ROUTE);

  const saveHousehold = () => {
    const name = newHouseholdName.trim();
    if (!name) return;
    // Comma-separated names; blank means the current user holds the final say.
    const deciders = newDeciderNames
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const res = addHousehold(name, deciders.length ? deciders : undefined);
    if (!res.ok) {
      goUpgrade();
      return;
    }
    setNewHouseholdName('');
    setNewDeciderNames('');
    setAddingHousehold(false);
  };

  const doStartFresh = () => {
    startFresh(freshName.trim() || householdName);
    router.replace('/');
  };

  const doSignOut = () => {
    signOut();
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={20} color={T.inkSoft} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <Title style={styles.title}>Settings</Title>
        <Muted style={styles.sub}>Your household, your plan, and your data.</Muted>

        {/* ---------- demo data ---------- */}
        {isDemo && (
          <Card style={styles.demoCard}>
            <Row style={styles.cardTop}>
              <View style={styles.icon}>
                <Ionicons name="sparkles-outline" size={20} color={T.brassDeep} />
              </View>
              <View style={styles.cardMain}>
                <Heading style={styles.cardTitle}>You&rsquo;re exploring a sample home</Heading>
                <Body style={styles.cardBody}>
                  The items you see belong to a made-up household so you can try
                  things out. When you&rsquo;re ready, clear them and start your own
                  — nothing real is lost.
                </Body>
              </View>
            </Row>

            <Label>Name your household</Label>
            <TextInput
              style={styles.input}
              value={freshName}
              onChangeText={setFreshName}
              placeholder={householdName}
              placeholderTextColor={T.inkFaint}
              accessibilityLabel="Your household name"
            />

            <View style={styles.cta}>
              {confirmFresh ? (
                <>
                  <Btn label="Yes — clear the samples and begin" big onPress={doStartFresh} />
                  <View style={styles.ctaGap} />
                  <Btn label="Not yet" kind="quiet" onPress={() => setConfirmFresh(false)} />
                </>
              ) : (
                <Btn label="Start my real household" big onPress={() => setConfirmFresh(true)} />
              )}
            </View>
            {confirmFresh && (
              <Muted style={styles.confirmNote}>
                This removes the sample items and people. Your real inventory
                starts empty.
              </Muted>
            )}
          </Card>
        )}

        {/* ---------- household ---------- */}
        <Label>Household</Label>
        <Card>
          <Heading style={styles.cardTitle}>{householdName}</Heading>
          <Muted style={styles.cardMeta}>
            {ent.itemsUsed} {ent.itemsUsed === 1 ? 'item' : 'items'} catalogued
          </Muted>
          <Muted style={styles.cardMeta}>
            Renaming a household is coming soon — for now the name is set when you
            create it.
          </Muted>
        </Card>

        <View style={styles.list}>
          {households.map((h) => {
            const active = h.id === activeHouseholdId;
            return (
              <Pressable
                key={h.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => switchHousehold(h.id)}
                style={({ pressed }) => [styles.rowItem, pressed && styles.pressed]}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? T.brass : T.inkFaint}
                />
                <View style={styles.cardMain}>
                  <Text style={styles.rowTitle}>{h.name}</Text>
                  <Muted style={styles.rowMeta}>
                    Final say: {h.deciderNames.join(', ')}
                  </Muted>
                  {active && <Muted style={styles.rowMeta}>Currently open</Muted>}
                </View>
              </Pressable>
            );
          })}

          {ent.canAddHousehold ? (
            addingHousehold ? (
              <View style={styles.addBox}>
                <TextInput
                  style={styles.input}
                  value={newHouseholdName}
                  onChangeText={setNewHouseholdName}
                  placeholder="The Cottage"
                  placeholderTextColor={T.inkFaint}
                  accessibilityLabel="New household name"
                />
                <Label>Who has final say there?</Label>
                <TextInput
                  style={styles.input}
                  value={newDeciderNames}
                  onChangeText={setNewDeciderNames}
                  placeholder={userName}
                  placeholderTextColor={T.inkFaint}
                  accessibilityLabel="Who has final say in the new household"
                />
                <Muted style={styles.deciderHint}>
                  Leave blank if it&rsquo;s you. Separate names with commas for
                  more than one.
                </Muted>
                <View style={styles.cta}>
                  <Btn label="Add household" onPress={saveHousehold} />
                  <View style={styles.ctaGap} />
                  <Btn
                    label="Cancel"
                    kind="quiet"
                    onPress={() => {
                      setAddingHousehold(false);
                      setNewHouseholdName('');
                      setNewDeciderNames('');
                    }}
                  />
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAddingHousehold(true)}
                style={({ pressed }) => [styles.rowItem, pressed && styles.pressed]}
              >
                <Ionicons name="add-circle-outline" size={20} color={T.brass} />
                <Text style={styles.rowTitle}>Add a household</Text>
              </Pressable>
            )
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={goUpgrade}
              style={({ pressed }) => [styles.rowItem, pressed && styles.pressed]}
            >
              <Ionicons name="lock-closed-outline" size={20} color={T.inkFaint} />
              <View style={styles.cardMain}>
                <Text style={styles.rowTitle}>Additional households</Text>
                <Muted style={styles.rowMeta}>A second home, a cottage, a parent&rsquo;s place</Muted>
              </View>
              <View style={styles.proTag}>
                <Text style={styles.proTagText}>Pro</Text>
              </View>
            </Pressable>
          )}
        </View>

        {/* ---------- plan ---------- */}
        <Label>Your plan</Label>
        {ent.pro ? (
          <Card>
            <Row style={styles.cardTop}>
              <View style={styles.icon}>
                <Ionicons name="ribbon-outline" size={20} color={T.brassDeep} />
              </View>
              <View style={styles.cardMain}>
                <Heading style={styles.cardTitle}>Pro</Heading>
                <Body style={styles.cardBody}>Unlimited items and households.</Body>
                <Muted style={styles.cardMeta}>
                  Manage your subscription in the App Store or Google Play.
                </Muted>
              </View>
            </Row>
          </Card>
        ) : (
          <Card>
            <Heading style={styles.cardTitle}>Free</Heading>
            <Muted style={styles.cardMeta}>
              {ent.itemsUsed} of {ent.itemLimit} items
            </Muted>
            <View
              style={styles.meterTrack}
              accessibilityRole="progressbar"
              accessibilityLabel={`${ent.itemsUsed} of ${ent.itemLimit} items used`}
            >
              <View
                style={[
                  styles.meterFill,
                  { width: `${meterPct}%` },
                  ent.atItemLimit && styles.meterFull,
                ]}
              />
            </View>
            <Body style={styles.cardBody}>
              {ent.atItemLimit
                ? "You've filled the free plan. Pro lifts the limit."
                : `Room for ${ent.itemsLeft} more before you'd need Pro.`}
            </Body>
            <View style={styles.cta}>
              <Btn label="Upgrade to Pro" big onPress={goUpgrade} />
            </View>
          </Card>
        )}

        {/* ---------- account & cloud backup ---------- */}
        <AccountSync />

        {/* ---------- local profile ---------- */}
        <Label>On this device</Label>
        <Card>
          <Heading style={styles.cardTitle}>You&rsquo;re {userName} here</Heading>
          <Muted style={styles.cardMeta}>
            Your inventory lives on this device first; the account above only
            holds what you choose to back up.
          </Muted>
        </Card>

        <Well style={styles.dangerWell}>
          <Row style={styles.cardTop}>
            <Ionicons name="warning-outline" size={18} color={T.toss} />
            <Muted style={styles.cardMain}>
              Your inventory is stored only on this device. There is no backup yet,
              so signing out erases every item, photo and story here permanently.
            </Muted>
          </Row>

          <View style={styles.cta}>
            <Pressable
              accessibilityRole="button"
              onPress={() => (confirmErase ? doSignOut() : setConfirmErase(true))}
              style={({ pressed }) => [
                styles.dangerBtn,
                confirmErase && styles.dangerBtnArmed,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.dangerText, confirmErase && styles.dangerTextArmed]}>
                {confirmErase
                  ? 'Tap again to erase everything'
                  : 'Sign out & erase this device'}
              </Text>
            </Pressable>
            {confirmErase && (
              <>
                <View style={styles.ctaGap} />
                <Btn label="Keep my things" kind="quiet" onPress={() => setConfirmErase(false)} />
              </>
            )}
          </View>
        </Well>

        {/* ---------- about ---------- */}
        <Label>About</Label>
        <View style={styles.list}>
          <View style={styles.rowItem}>
            <Ionicons name="information-circle-outline" size={20} color={T.inkFaint} />
            <Text style={styles.rowTitle}>Version</Text>
            <Muted style={styles.rowValue}>{version}</Muted>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              notify('Coming soon', 'The full privacy policy will live here before launch.')
            }
            style={({ pressed }) => [styles.rowItem, pressed && styles.pressed]}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={T.inkFaint} />
            <Text style={styles.rowTitle}>Privacy</Text>
            <Ionicons name="chevron-forward" size={18} color={T.inkFaint} />
          </Pressable>
        </View>
        <Muted style={styles.footer}>
          Your inventory stays on this device. No ads, ever.
        </Muted>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 52,
    alignSelf: 'flex-start',
    paddingRight: Spacing.two,
  },
  backText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
  title: { marginTop: 0, marginBottom: 0 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 4 },

  /* cards */
  cardTop: { alignItems: 'flex-start', gap: 12 },
  cardMain: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 18 },
  cardBody: { marginTop: 6 },
  cardMeta: { fontSize: 13.5, marginTop: 6 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    alignItems: 'center',
    justifyContent: 'center',
  },

  demoCard: {
    marginTop: Spacing.four,
    borderColor: T.brass,
    backgroundColor: T.brassTint,
  },
  confirmNote: { marginTop: Spacing.two, textAlign: 'center' },

  /* rows */
  list: { marginTop: Spacing.two },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 56,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.lineSoft,
  },
  rowTitle: { flex: 1, fontSize: 15.5, fontWeight: '600', color: T.ink },
  rowMeta: { fontSize: 12.5, marginTop: 2 },
  rowValue: { fontSize: 15 },
  proTag: {
    borderRadius: Radius.pill,
    backgroundColor: T.brassTint,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  proTagText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: T.brassDeep,
  },

  addBox: { paddingVertical: Spacing.two },
  deciderHint: { fontSize: 12.5, marginTop: Spacing.two },
  input: {
    backgroundColor: T.surface,
    borderWidth: 1.5,
    borderColor: T.brass,
    borderRadius: Radius.control,
    paddingVertical: 13,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts?.serif,
    fontSize: 18,
    color: T.ink,
  },
  cta: { marginTop: Spacing.three },
  ctaGap: { height: Spacing.two },

  /* plan meter */
  meterTrack: {
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: T.sunken,
    marginTop: Spacing.two,
    overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: T.brass },
  meterFull: { backgroundColor: T.toss },

  /* danger */
  dangerWell: { marginTop: Spacing.three, backgroundColor: T.tossTint },
  dangerBtn: {
    minHeight: 52,
    borderRadius: Radius.control,
    borderWidth: 1.5,
    borderColor: T.toss,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  dangerBtnArmed: { backgroundColor: T.toss, borderColor: T.toss },
  dangerText: { fontSize: 15.5, fontWeight: '700', color: T.toss, textAlign: 'center' },
  dangerTextArmed: { color: '#FFFFFF' },

  footer: { marginTop: Spacing.four, textAlign: 'center', fontSize: 13 },
});
