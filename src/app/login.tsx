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
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, CONTENT_MAX, Muted, Row } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const looksLikeEmail = (v: string) => v.includes('@') && v.includes('.');

type Mode = 'password' | 'signup' | 'code' | 'code-sent';

export default function LoginScreen() {
  const router = useRouter();
  const { loggedOut } = useLocalSearchParams<{ loggedOut?: string }>();

  const householdName = useStore((s) => s.householdName);
  const lockedOut = useStore((s) => s.lockedOut);
  const lastAccountEmail = useStore((s) => s.lastAccountEmail);
  const unlock = useStore((s) => s.unlock);
  const signOut = useStore((s) => s.signOut);

  const [showLoggedOut, setShowLoggedOut] = useState(loggedOut === '1');
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState(lastAccountEmail ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmErase, setConfirmErase] = useState(false);

  /** Signed in — open the app (unlocking the device if it was locked). */
  const finish = () => {
    unlock();
    router.replace('/');
  };

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
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof location !== 'undefined' ? location.origin : undefined },
    });
    if (err) setError('Google sign-in isn’t available right now — try a password or a code.');
  };

  /* ---------- logged-out confirmation (once, straight after logging out) ---------- */
  if (showLoggedOut) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.body}>
          <View style={[styles.glyph, styles.glyphOk]}>
            <Ionicons name="checkmark" size={32} color={T.keep} />
          </View>
          <Text style={styles.title}>You&rsquo;re logged out</Text>
          <Muted style={styles.sub}>
            {householdName
              ? `“${householdName}” is safe on this device and backed up to your account. Nothing was deleted.`
              : 'Everything is safe on this device. Nothing was deleted.'}
          </Muted>
          <View style={styles.cta}>
            <Btn label="Go to sign in" big onPress={() => setShowLoggedOut(false)} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <Text style={styles.wordmark}>Inventory Our Home</Text>

          {mode === 'code-sent' ? (
            <>
              <Text style={styles.title}>Check your email</Text>
              <Muted style={styles.sub}>We sent six digits to {email.trim()}.</Muted>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={T.inkFaint}
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
              <Text style={styles.title}>
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
                    <Ionicons name="logo-google" size={18} color={T.ink} />
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

          {error ? <Muted style={styles.error}>{error}</Muted> : null}

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
  error: { marginTop: Spacing.three, color: T.toss, textAlign: 'center' },
  eraseBlock: { marginTop: Spacing.five },
});
