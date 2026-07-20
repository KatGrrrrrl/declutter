/**
 * Locked — shown after logging out on a device that holds a household.
 * The inventory stays safely on the device but is not browsable until the
 * same account signs back in (email six-digit code). A quiet escape hatch
 * lets a genuinely new owner of the device erase and start fresh.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Btn, CONTENT_MAX, Muted } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

const looksLikeEmail = (v: string) => v.includes('@') && v.includes('.');

export default function LockedScreen() {
  const router = useRouter();
  const householdName = useStore((s) => s.householdName);
  const lastAccountEmail = useStore((s) => s.lastAccountEmail);
  const unlock = useStore((s) => s.unlock);
  const signOut = useStore((s) => s.signOut);

  const [email, setEmail] = useState(lastAccountEmail ?? '');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmErase, setConfirmErase] = useState(false);

  const sendCode = async () => {
    const addr = email.trim().toLowerCase();
    if (!looksLikeEmail(addr)) {
      setError('That address doesn’t look complete.');
      return;
    }
    // The device belongs to the account that locked it.
    if (lastAccountEmail && addr !== lastAccountEmail) {
      setError(`This device’s household belongs to ${lastAccountEmail}. Sign in with that email, or erase below to start fresh.`);
      return;
    }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setStage('code');
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
    if (err) {
      setError('That code didn’t work — double-check the six digits.');
      return;
    }
    unlock();
    router.replace('/');
  };

  const eraseAndStartFresh = () => {
    signOut(); // wipes device state back to the welcome screen
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <View style={styles.glyph}>
          <Ionicons name="lock-closed-outline" size={30} color={T.brassDeep} />
        </View>
        <Text style={styles.title}>
          {householdName ? `“${householdName}” is locked` : 'Locked'}
        </Text>
        <Muted style={styles.sub}>
          Everything is safe on this device. Sign back in to open it.
        </Muted>

        {stage === 'email' ? (
          <>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={T.inkFaint}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={sendCode}
            />
            <View style={styles.cta}>
              <Btn
                label={busy ? 'Sending…' : 'Email me a code'}
                big
                onPress={sendCode}
                disabled={busy}
              />
            </View>
          </>
        ) : (
          <>
            <Muted style={styles.codeHint}>
              We emailed six digits to {email.trim()}.
            </Muted>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={T.inkFaint}
              keyboardType="number-pad"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={verifyCode}
            />
            <View style={styles.cta}>
              <Btn
                label={busy ? 'Checking…' : 'Unlock'}
                big
                onPress={verifyCode}
                disabled={busy}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setStage('email')}
              style={styles.link}
            >
              <Text style={styles.linkText}>Different email</Text>
            </Pressable>
          </>
        )}

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        <View style={styles.eraseBlock}>
          {confirmErase ? (
            <>
              <Btn
                label="Yes — erase this device and start fresh"
                kind="brass"
                onPress={eraseAndStartFresh}
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.ground },
  body: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
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
  title: {
    fontFamily: Fonts?.serif,
    fontSize: 26,
    fontWeight: '600',
    color: T.heading,
    textAlign: 'center',
  },
  sub: { textAlign: 'center', marginTop: Spacing.one, marginBottom: Spacing.four },
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
  codeHint: { textAlign: 'center', marginBottom: Spacing.two, fontSize: 13 },
  cta: { marginTop: Spacing.three },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  linkText: { fontSize: 13, fontWeight: '600', color: T.inkSoft, textDecorationLine: 'underline' },
  error: { marginTop: Spacing.two, color: T.toss, textAlign: 'center' },
  eraseBlock: { marginTop: Spacing.six },
});
