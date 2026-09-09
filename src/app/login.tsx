/**
 * Login — the app's ordinary sign-in page.
 *
 * Password is the default path (what people expect); a six-digit email code
 * is offered as an alternative for anyone who'd rather not keep a password,
 * and Google is available on web. Doubles as the lock screen: when a
 * household is on this device and the account logged out, everything else
 * redirects here until someone signs back in (see LockGate in _layout).
 */

import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, CONTENT_MAX, DecorativeIcon, Muted, Row } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import {
  acceptInvite,
  declineInvite,
  listPendingInvites,
  loadHouseholdById,
  loadMyHousehold,
  type PendingInvite,
} from '@/lib/join';
import { reconcileAccount } from '@/lib/account-switch';
import { linkedCloudId, useStore } from '@/lib/store';

import type { CloudHouseholdSummary } from '@/lib/sync';
import { supabase } from '@/lib/supabase';

const looksLikeEmail = (v: string) => v.includes('@') && v.includes('.');

type Mode = 'password' | 'signup' | 'code' | 'code-sent';

export default function LoginScreen() {
  const router = useRouter();
  const { loggedOut } = useLocalSearchParams<{ loggedOut?: string }>();

  // Only claim "backed up to your account" when the home is actually cloud-linked.
  const cloudHouseholdId = useStore(linkedCloudId);
  const lockedOut = useStore((s) => s.lockedOut);
  const lastAccountEmail = useStore((s) => s.lastAccountEmail);
  const unlock = useStore((s) => s.unlock);
  const signOut = useStore((s) => s.signOut);
  const clearLogoutNotice = useStore((s) => s.clearLogoutNotice);

  // Show the "logged out" confirmation from either signal: the URL param (when
  // navigation preserved it) or the store flag (survives the lock redirect,
  // which drops params). The flag is cleared on dismissal or sign-in, not on
  // mount — the lock gate can mount this screen more than once and clearing on
  // mount would race the confirmation away.
  const [showLoggedOut, setShowLoggedOut] = useState(
    () => loggedOut === '1' || Boolean(useStore.getState().pendingLogoutNotice)
  );
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState(lastAccountEmail ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Seed from any OAuth error the redirect brought back, so a failed Google
  // sign-in explains itself instead of dumping the user on a blank form.
  const [error, setError] = useState(() => {
    if (Platform.OS !== 'web') return '';
    const p = new URLSearchParams(
      window.location.search || window.location.hash.replace(/^#/, '')
    );
    const e = p.get('error_description') || p.get('error');
    return e ? decodeURIComponent(e).replace(/\+/g, ' ') : '';
  });
  const [confirmErase, setConfirmErase] = useState(false);
  // True while a signed-in account's household is being pulled onto a device
  // that has no home yet (see finish).
  const [loadingHome, setLoadingHome] = useState(false);
  // The account belongs to several homes and this device has none of them
  // open: the person picks. Never guessed (the old "oldest wins" rule put a
  // member of two homes in the wrong house).
  const [homeChoices, setHomeChoices] = useState<CloudHouseholdSummary[]>([]);
  // A family is already expecting this address. Shown INSTEAD of onboarding:
  // the commonest sign-in on a fresh device is the invited child, and sending
  // them off to name a household of their own is the wrong first question.
  const [invites, setInvites] = useState<PendingInvite[]>([]);

  // This screen does not use the `Screen` kit component, so it carries its own
  // `main` landmark. Gated on focus so it can never coexist with the landmark
  // of a tab screen the root stack still has mounted.
  const isFocused = useIsFocused();
  const mainRole = isFocused ? ('main' as const) : undefined;

  /**
   * Signed in — open the app (unlocking the device if it was locked).
   *
   * On a device with no home yet (or only the demo), "/" is the Welcome page,
   * whose "Sign in" link leads straight back here — a loop that made desktop
   * sign-in look dead. So first bring the account's household down; only an
   * account with no backup at all is sent to onboarding to start one.
   */
  const finish = async () => {
    unlock();
    setLoadingHome(true);

    // WHO is signing in, before deciding what they may see. `onboarded` only
    // says a home exists on this device — never whose. Treating it as proof
    // of identity is what showed a helper the owner's household, in the
    // owner's role, with a Decide tab they have no authority to use.
    const { data: auth } = await supabase.auth.getUser();
    const signedInAs = auth?.user?.email ?? '';
    const account = await reconcileAccount(signedInAs);

    // Their own device, already holding their own home: straight in.
    if (account.outcome === 'same' && useStore.getState().onboarded) {
      setLoadingHome(false);
      router.replace('/');
      return;
    }
    // A different account: reconcileAccount has set the previous person's
    // data aside and put back this account's own, if it had any here before.
    if (account.restored && useStore.getState().onboarded) {
      setLoadingHome(false);
      router.replace('/');
      return;
    }

    const res = await loadMyHousehold();
    if (res.ok) {
      setLoadingHome(false);
      router.replace('/');
      return;
    }
    if (res.choices) {
      setLoadingHome(false);
      setHomeChoices(res.choices);
      return;
    }
    if (res.error) {
      setLoadingHome(false);
      setError(`Signed in, but your home couldn’t be loaded: ${res.error}`);
      return;
    }
    // No household of their own — but a family may be holding a place for
    // this address. Ask about that before offering to start a new home.
    const waiting = await listPendingInvites();
    setLoadingHome(false);
    if (waiting.length) setInvites(waiting);
    else router.replace('/onboarding');
  };

  /** The person chose one of several homes: load that one. */
  const pickHome = async (householdId: string) => {
    setHomeChoices([]);
    setLoadingHome(true);
    const res = await loadHouseholdById(householdId);
    setLoadingHome(false);
    if (res.ok) router.replace('/');
    else setError(`Signed in, but your home couldn’t be loaded: ${res.error ?? 'unknown error'}`);
  };

  /** Yes: accept the invitation and open the family's home on this device. */
  const acceptWaitingInvite = async (inv: PendingInvite) => {
    setInvites([]);
    setLoadingHome(true);
    const res = await acceptInvite(inv.householdId);
    setLoadingHome(false);
    if (res.ok) {
      router.replace('/');
      return;
    }
    setInvites([inv]);
    setError(res.error ?? 'The invitation could not be accepted.');
  };

  /**
   * No: start a home of their own instead. Every invitation on the screen is
   * declined — the answer to "do you want to join a family?" is one answer,
   * not one per household — and each one's administrators are told, so an
   * invitation nobody accepted stops looking like an invitation nobody
   * received. A decline that fails is not allowed to trap them here: the
   * refusal was the point, so onboarding opens regardless.
   */
  const declineAndStartOwn = async () => {
    const waiting = invites;
    setInvites([]);
    setLoadingHome(true);
    await Promise.all(waiting.map((inv) => declineInvite(inv.householdId)));
    setLoadingHome(false);
    router.replace('/onboarding');
  };

  /**
   * OAuth (Google) returns by redirecting the browser back here. Two things
   * must happen that the click handler can't do, because it navigated away:
   *  - if it FAILED, Google appends ?error=…/#error=… — surface it, don't
   *    silently dump the user back on the login form with no explanation;
   *  - if it SUCCEEDED, a session now exists — unlock and go to the app
   *    (otherwise the lock gate just bounces straight back to /login).
   */
  // Strip auth params from the address bar once (side-effect only, no setState).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const url = window.location.search + window.location.hash;
    if (/error|access_token|[?&#]code=/.test(url)) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let handled = false;
    const proceed = () => {
      if (handled) return;
      handled = true;
      finish();
    };
    // Catch a session already present (redirect completed before mount)…
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) proceed();
    });
    // …and one that arrives just after (detectSessionInUrl parses the hash).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && event === 'SIGNED_IN') proceed();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithPassword = async () => {
    const addr = email.trim().toLowerCase();
    if (!looksLikeEmail(addr)) return setError('That address doesn’t look complete.');
    if (!password) return setError('Enter your password, or use a code instead.');
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({
      email: addr,
      password,
    });
    setBusy(false);
    if (err) {
      setError(
        /invalid login/i.test(err.message)
          ? 'That email and password don’t match. If you’ve never set a password, use a six-digit code instead.'
          : err.message
      );
      return;
    }
    finish();
  };

  const createAccount = async () => {
    const addr = email.trim().toLowerCase();
    if (!looksLikeEmail(addr)) return setError('That address doesn’t look complete.');
    if (password.length < 8) return setError('Pick a password of at least 8 characters.');
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.auth.signUp({ email: addr, password });
    setBusy(false);
    if (err) {
      setError(
        /already registered/i.test(err.message)
          ? 'That email already has an account — sign in instead.'
          : err.message
      );
      return;
    }
    if (!data.session) {
      setError('Account created. Check your email to confirm, then sign in.');
      setMode('password');
      return;
    }
    finish();
  };

  const sendCode = async () => {
    const addr = email.trim().toLowerCase();
    if (!looksLikeEmail(addr)) return setError('That address doesn’t look complete.');
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (err) return setError(err.message);
    setMode('code-sent');
  };

  const verifyCode = async () => {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (err) return setError('That code didn’t work — double-check the six digits.');
    finish();
  };

  const googleSignIn = async () => {
    setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Return to /login so the effects above can show an error or proceed.
      options: {
        redirectTo: typeof location !== 'undefined' ? `${location.origin}/login` : undefined,
      },
    });
    if (err) setError('Google sign-in couldn’t start — try a password or a code instead.');
  };

  /* ---------- logged-out confirmation (once, straight after logging out) ---------- */
  if (showLoggedOut) {
    return (
      <SafeAreaView style={styles.screen} role={mainRole}>
        <View style={styles.body}>
          <DecorativeIcon style={[styles.glyph, styles.glyphOk]}>
            <Ionicons name="checkmark" size={32} color={T.keep} />
          </DecorativeIcon>
          <Text role="heading" aria-level={1} style={styles.title}>
            You&rsquo;re logged out
          </Text>
          <Muted style={styles.sub}>
            {cloudHouseholdId
              ? 'Everything is safe on this device and backed up to your account. Nothing was deleted.'
              : 'Everything is safe on this device. Nothing was deleted.'}
          </Muted>
          <View style={styles.cta}>
            <Btn
              label="Go to sign in"
              big
              onPress={() => {
                clearLogoutNotice();
                setShowLoggedOut(false);
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------- a family is waiting for this address ---------- */
  // Shown before onboarding is ever offered. Declining is a first-class
  // answer, not a way out of a modal: it says no on the server, tells the
  // household's administrators, and only then opens the "start a home" flow.
  if (invites.length > 0) {
    const one = invites.length === 1 ? invites[0] : null;
    return (
      <SafeAreaView style={styles.screen} role={mainRole}>
        <View style={styles.body}>
          <Text style={styles.wordmark}>Inventory Our Home</Text>
          <DecorativeIcon style={styles.glyph}>
            <Ionicons name="home" size={30} color={T.brassDeep} />
          </DecorativeIcon>
          <Text role="heading" aria-level={1} style={styles.title}>
            {one ? `Join “${one.householdName}”?` : 'Your family is expecting you'}
          </Text>
          <Muted style={styles.sub}>
            {one
              ? `${one.householdName} invited this email address to help with their home. Joining brings their inventory onto this device — you can add photos and stories straight away.`
              : 'These homes have invited this email address. Join one to bring its inventory onto this device.'}
          </Muted>
          <View style={styles.cta}>
            {invites.map((inv) => (
              <Btn
                key={inv.householdId}
                label={one ? `Yes — join “${inv.householdName}”` : `Join “${inv.householdName}”`}
                kind="brass"
                big
                onPress={() => acceptWaitingInvite(inv)}
              />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              one
                ? `No thanks, start my own home instead of joining ${one.householdName}`
                : 'No thanks, start my own home'
            }
            onPress={declineAndStartOwn}
            style={styles.link}
          >
            <Text style={styles.linkText}>
              No thanks &mdash; start a home of my own
            </Text>
          </Pressable>
          <Muted style={styles.declineNote}>
            {one
              ? `We’ll let whoever looks after “${one.householdName}” know you’ve declined, so they’re not left waiting.`
              : 'We’ll let each household know you’ve declined, so nobody is left waiting.'}
          </Muted>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------- several homes on the account: which one? ---------- */
  if (homeChoices.length > 0) {
    return (
      <SafeAreaView style={styles.screen} role={mainRole}>
        <View style={styles.body}>
          <Text style={styles.wordmark}>Inventory Our Home</Text>
          <Text role="heading" aria-level={1} style={styles.title}>
            Which home?
          </Text>
          <Muted style={styles.sub}>Your account belongs to more than one. Pick the one for this device.</Muted>
          <View style={styles.cta}>
            {homeChoices.map((h) => (
              <Btn key={h.id} label={h.name} kind="primary" big onPress={() => pickHome(h.id)} />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------- pulling the account's home onto this device ---------- */
  if (loadingHome) {
    return (
      <SafeAreaView style={styles.screen} role={mainRole}>
        <View style={styles.body}>
          <Text style={styles.wordmark}>Inventory Our Home</Text>
          <Text role="heading" aria-level={1} style={styles.title}>
            Loading your home…
          </Text>
          <Muted style={styles.sub}>Bringing your inventory onto this device.</Muted>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} role={mainRole}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <Text style={styles.wordmark}>Inventory Our Home</Text>

          {/* Prominent, high-contrast error banner — near the top so it can't
              be missed (the old muted line sat below the fold under the links). */}
          {error ? (
            <View
              style={styles.errorBanner}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              <Ionicons name="alert-circle" size={20} color={T.toss} />
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          ) : null}

          {mode === 'code-sent' ? (
            <>
              <Text role="heading" aria-level={1} style={styles.title}>
                Check your email
              </Text>
              <Muted style={styles.sub}>We sent six digits to {email.trim()}.</Muted>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={T.inkFaint}
                aria-label="Six-digit code"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={verifyCode}
              />
              <View style={styles.cta}>
                <Btn label={busy ? 'Checking…' : 'Sign in'} big onPress={verifyCode} disabled={busy} />
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMode('password')}
                style={styles.link}
              >
                <Text style={styles.linkText}>Use a password instead</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text role="heading" aria-level={1} style={styles.title}>
                {mode === 'signup' ? 'Create your account' : 'Sign in'}
              </Text>
              <Muted style={styles.sub}>
                {mode === 'signup'
                  ? 'One account keeps your home backed up and lets family join.'
                  : 'Welcome back.'}
              </Muted>

              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={T.inkFaint}
                aria-label="Email"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="next"
              />

              {mode !== 'code' && (
                <>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                    placeholderTextColor={T.inkFaint}
                    aria-label="Password"
                    secureTextEntry
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    returnKeyType="done"
                    onSubmitEditing={mode === 'signup' ? createAccount : signInWithPassword}
                  />
                </>
              )}

              <View style={styles.cta}>
                {mode === 'code' ? (
                  <Btn
                    label={busy ? 'Sending…' : 'Email me a six-digit code'}
                    big
                    onPress={sendCode}
                    disabled={busy}
                  />
                ) : (
                  <Btn
                    label={
                      busy
                        ? 'Just a moment…'
                        : mode === 'signup'
                          ? 'Create account'
                          : 'Sign in'
                    }
                    big
                    onPress={mode === 'signup' ? createAccount : signInWithPassword}
                    disabled={busy}
                  />
                )}
              </View>

              {/* alternatives */}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setError('');
                  setMode(mode === 'code' ? 'password' : 'code');
                }}
                style={styles.link}
              >
                <Text style={styles.linkText}>
                  {mode === 'code'
                    ? 'Use a password instead'
                    : 'No password? Email me a code instead'}
                </Text>
              </Pressable>

              {Platform.OS === 'web' && (
                <>
                  <Row style={styles.orRow}>
                    <View style={styles.orLine} />
                    <Muted style={styles.orText}>or</Muted>
                    <View style={styles.orLine} />
                  </Row>
                  <Pressable
                    accessibilityRole="button"
                    onPress={googleSignIn}
                    style={styles.oauthBtn}
                  >
                    <DecorativeIcon>
                      <Ionicons name="logo-google" size={18} color={T.ink} />
                    </DecorativeIcon>
                    <Text style={styles.oauthText}>Continue with Google</Text>
                  </Pressable>
                </>
              )}

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setError('');
                  setMode(mode === 'signup' ? 'password' : 'signup');
                }}
                style={styles.link}
              >
                <Text style={styles.linkText}>
                  {mode === 'signup'
                    ? 'Already have an account? Sign in'
                    : 'New here? Create an account'}
                </Text>
              </Pressable>
            </>
          )}


          {/* Only meaningful when a household is stranded on this device. */}
          {lockedOut && (
            <View style={styles.eraseBlock}>
              {confirmErase ? (
                <>
                  <Btn
                    label="Yes — erase this device and start fresh"
                    kind="brass"
                    onPress={() => {
                      signOut();
                      router.replace('/');
                    }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setConfirmErase(false)}
                    style={styles.link}
                  >
                    <Text style={styles.linkText}>Never mind</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setConfirmErase(true)}
                  style={styles.link}
                >
                  <Text style={styles.linkText}>
                    Not your household? Erase this device and start fresh
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.ground },
  flex: { flex: 1 },
  body: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: Fonts?.serif,
    fontSize: 20,
    fontWeight: '600',
    color: T.brassDeep,
    textAlign: 'center',
    marginBottom: Spacing.four,
  },
  glyph: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: T.brassTint,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  glyphOk: { backgroundColor: T.keepTint },
  title: {
    fontFamily: Fonts?.serif,
    fontSize: 28,
    fontWeight: '600',
    color: T.heading,
    textAlign: 'center',
  },
  sub: { textAlign: 'center', marginTop: Spacing.one, marginBottom: Spacing.four },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: T.brassDeep,
    marginBottom: Spacing.one,
    marginTop: Spacing.two,
  },
  input: {
    minHeight: 52,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    color: T.ink,
  },
  codeInput: { letterSpacing: 8, fontSize: 22, textAlign: 'center' },
  cta: { marginTop: Spacing.four },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  linkText: { fontSize: 13.5, fontWeight: '600', color: T.inkSoft, textDecorationLine: 'underline' },
  orRow: { marginTop: Spacing.three, gap: Spacing.two, alignItems: 'center' },
  orLine: { flex: 1, height: 1, backgroundColor: T.lineSoft },
  orText: { fontSize: 12 },
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    marginTop: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
  },
  oauthText: { fontSize: 15, fontWeight: '600', color: T.ink },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    backgroundColor: T.tossTint,
    borderWidth: 1,
    borderColor: T.toss,
    borderRadius: Radius.control,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.four,
  },
  errorBannerText: { flex: 1, fontSize: 14, lineHeight: 20, color: T.ink, fontWeight: '600' },
  eraseBlock: { marginTop: Spacing.five },
  declineNote: { textAlign: 'center', fontSize: 12.5, marginTop: Spacing.one },
});
