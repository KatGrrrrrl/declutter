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
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const looksLikeEmail = (v: string) => v.includes('@') && v.includes('.');

type Mode = 'password' | 'signup' | 'code' | 'code-sent';

export default function LoginScreen() {
  const router = useRouter();
  const { loggedOut } = useLocalSearchParams<{ loggedOut?: string }>();

  // Only claim "backed up to your account" when the home is actually cloud-linked.
  const cloudHouseholdId = useStore((s) => s.cloudHouseholdId);
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

  // This screen does not use the `Screen` kit component, so it carries its own
  // `main` landmark. Gated on focus so it can never coexist with the landmark
  // of a tab screen the root stack still has mounted.
  const isFocused = useIsFocused();
  const mainRole = isFocused ? ('main' as const) : undefined;

  /** Signed in — open the app (unlocking the device if it was locked). */
  const finish = () => {
    unlock();
    router.replace('/');
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
});
