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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { refreshPlan, verifyCheckout } from '@/lib/billing';
import { getNotifyPref, setNotifyPref } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { selectEntitlement, useStore } from '@/lib/store';

import type { NotifyMode } from '@/lib/notifications';

/** The three email choices, in the order they read best. */
const EMAIL_OPTIONS: { mode: NotifyMode; title: string; meta: string }[] = [
  { mode: 'off', title: 'Off', meta: 'Check the app when you like' },
  { mode: 'instant', title: 'Instantly', meta: 'When family adds something new' },
  { mode: 'daily', title: 'Daily summary', meta: 'One email each evening' },
];

export default function SettingsScreen() {
  const router = useRouter();
  // Stripe Checkout returns here as /settings?session_id=… (see lib/billing).
  const { session_id } = useLocalSearchParams<{ session_id?: string }>();

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
  const [checkoutState, setCheckoutState] = useState<'idle' | 'verifying' | 'success' | 'failed'>(
    'idle'
  );

  // Email updates: null = unavailable (signed out / household not backed up).
  const [emailPref, setEmailPref] = useState<NotifyMode | null>(null);
  const [emailPrefLoaded, setEmailPrefLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    getNotifyPref().then((p) => {
      if (alive) {
        setEmailPref(p);
        setEmailPrefLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Optimistic select: flip the radio immediately, revert if the save fails.
  const chooseEmailPref = (mode: NotifyMode) => {
    if (emailPref === null || mode === emailPref) return;
    const prev = emailPref;
    setEmailPref(mode);
    setNotifyPref(mode).then((res) => {
      if (!res.ok) setEmailPref(prev);
    });
  };

  // On mount: mirror the cloud plan locally, and — if we just came back from
  // Stripe — verify that checkout session so the entitlement flips server-side.
  const verifiedSession = useRef<string | null>(null);
  useEffect(() => {
    refreshPlan();
    const sid = typeof session_id === 'string' ? session_id : undefined;
    if (sid && verifiedSession.current !== sid) {
      verifiedSession.current = sid;
      setCheckoutState('verifying');
      verifyCheckout(sid).then((res) => {
        setCheckoutState(res.ok && res.plan === 'pro' ? 'success' : 'failed');
      });
    }
  }, [session_id]);

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

  // Account session for the top-level log-out bar.
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSessionEmail(s?.user.email ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  /**
   * Log out: the account disconnects AND the app locks — an inventory of
   * valuables must not stay browsable on a logged-out phone. Device data and
   * cloud backups both survive; signing back in reopens everything.
   */
  const lockOut = state.lockOut;
  const doLogOut = async () => {
    const email = sessionEmail ?? '';
    await supabase.auth.signOut();
    lockOut(email);
    router.replace('/locked?loggedOut=1');
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

        {/* ---------- account, front and center (logging out is routine) ---------- */}
        {sessionEmail && (
          <Card style={styles.accountBar}>
            <Row style={styles.accountRow}>
              <View style={styles.accountDot} />
              <View style={styles.cardMain}>
                <Text style={styles.accountEmail}>{sessionEmail}</Text>
                <Muted style={styles.accountMeta}>
                  Signed in — backups and invitations are on
                </Muted>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={doLogOut}
                style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
              >
                <Ionicons name="log-out-outline" size={16} color={T.ink} />
                <Text style={styles.logoutText}>Log out</Text>
              </Pressable>
            </Row>
          </Card>
        )}

        {/* ---------- back from Stripe checkout ---------- */}
        {checkoutState === 'verifying' && (
          <Muted style={styles.checkoutNote}>Confirming your payment…</Muted>
        )}
        {checkoutState === 'success' && (
          <Card style={styles.checkoutCard}>
            <Row style={styles.cardTop}>
              <View style={styles.icon}>
                <Ionicons name="ribbon-outline" size={20} color={T.brassDeep} />
              </View>
              <View style={styles.cardMain}>
                <Heading style={styles.cardTitle}>
                  Welcome to Pro — the whole house fits now
                </Heading>
                <Body style={styles.cardBody}>
                  Your payment went through and this household is on Pro: unlimited
                  items, and room for a second home. Thank you for funding Inventory Our Home
                  directly.
                </Body>
              </View>
            </Row>
          </Card>
        )}
        {checkoutState === 'failed' && (
          <Muted style={styles.checkoutNote}>
            We couldn&rsquo;t confirm that payment just yet. If you completed checkout,
            your plan below will catch up shortly — nothing is lost.
          </Muted>
        )}

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

        {/* ---------- email updates ---------- */}
        <Label>Email updates</Label>
        <Card>
          {EMAIL_OPTIONS.map((o) => {
            const active = emailPref === o.mode;
            const disabled = emailPref === null;
            return (
              <Pressable
                key={o.mode}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled }}
                disabled={disabled}
                onPress={() => chooseEmailPref(o.mode)}
                style={({ pressed }) => [
                  styles.rowItem,
                  disabled && styles.rowDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? T.brass : T.inkFaint}
                />
                <View style={styles.cardMain}>
                  <Text style={styles.rowTitle}>{o.title}</Text>
                  <Muted style={styles.rowMeta}>{o.meta}</Muted>
                </View>
              </Pressable>
            );
          })}
          {emailPrefLoaded && emailPref === null && (
            <Muted style={styles.emailNote}>
              Sign in and back up your household to turn on email updates.
            </Muted>
          )}
        </Card>

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

  accountBar: { marginBottom: Spacing.two, backgroundColor: T.sunken, borderColor: T.line },
  accountRow: { gap: Spacing.two },
  accountDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: T.keep },
  accountEmail: { fontSize: 14.5, fontWeight: '700', color: T.ink },
  accountMeta: { fontSize: 12, marginTop: 1 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    paddingHorizontal: 13,
  },
  logoutText: { fontSize: 13.5, fontWeight: '700', color: T.ink },
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
  checkoutCard: {
    marginTop: Spacing.four,
    borderColor: T.brass,
    backgroundColor: T.brassTint,
  },
  checkoutNote: { marginTop: Spacing.three, fontSize: 13.5, lineHeight: 19 },
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
  rowDisabled: { opacity: 0.45 },
  emailNote: { marginTop: Spacing.two, fontSize: 13, lineHeight: 18 },
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
