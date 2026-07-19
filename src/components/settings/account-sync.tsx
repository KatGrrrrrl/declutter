/**
 * Account & sync (beta) — email-code sign-in (no passwords, elder-friendly),
 * cloud backup of the household catalog, and restore onto a fresh device.
 * Honest scope for v1: photos/audio aren't uploaded yet (they wait on the
 * EXIF-stripping pipeline); everything else — items, decisions, stories,
 * chat, roster, donation destinations — is covered.
 */

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { notify } from '@/components/child/shared';
import { Btn, Card, Label, Muted, Row } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { useActiveHousehold, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { backupHousehold, restoreHousehold } from '@/lib/sync';

export function AccountSync() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const state = useStore();
  const household = useActiveHousehold();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendCode = async () => {
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@')) {
      notify('Check the email', 'That address doesn’t look complete.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      notify('Couldn’t send the code', error.message);
      return;
    }
    setStage('code');
  };

  const verifyCode = async () => {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) {
      notify('That code didn’t work', 'Double-check the six digits, or send a fresh one.');
      return;
    }
    setStage('email');
    setCode('');
  };

  const runBackup = async () => {
    setBusy(true);
    const res = await backupHousehold({
      cloudHouseholdId: state.cloudHouseholdId,
      householdName: state.householdName,
      items: state.items,
      people: state.people,
      messages: state.messages,
      members: state.members,
      deciderNames: household?.deciderNames ?? [state.ownerName],
      userName: state.userName,
    });
    setBusy(false);
    if (!res.ok) {
      notify('Backup didn’t finish', res.error ?? 'Something went wrong — try again.');
      return;
    }
    state.setCloudMeta({
      cloudHouseholdId: res.cloudHouseholdId,
      lastBackupAt: new Date().toISOString(),
    });
    const skipped = res.skippedLocalOnly
      ? ` ${res.skippedLocalOnly} device-only item${res.skippedLocalOnly === 1 ? '' : 's'} stayed private, as promised.`
      : '';
    notify('Backed up', `${res.itemsBackedUp} items are safe in your account.${skipped}`);
  };

  const runRestore = async () => {
    setBusy(true);
    const res = await restoreHousehold();
    setBusy(false);
    setConfirmRestore(false);
    if (!res.ok || !res.snapshot) {
      notify('Nothing restored', res.error ?? 'No backup found.');
      return;
    }
    state.restoreSnapshot(res.snapshot);
    notify('Restored', `“${res.snapshot.householdName}” is back — ${res.snapshot.items.length} items.`);
  };

  const signOutAccount = async () => {
    await supabase.auth.signOut();
    notify('Signed out', 'Your things stay on this device; backups stay in your account.');
  };

  return (
    <>
      <Label>Account & sync (beta)</Label>
      <Card>
        {!session ? (
          stage === 'email' ? (
            <>
              <Muted style={styles.lede}>
                Sign in with your email to back this household up — so a lost
                phone never means a lost inventory. No password: we send a
                six-digit code instead.
              </Muted>
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
                <Btn label={busy ? 'Sending…' : 'Email me a code'} onPress={sendCode} disabled={busy} />
              </View>
            </>
          ) : (
            <>
              <Muted style={styles.lede}>
                We emailed a six-digit code to {email.trim()}. Enter it here.
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
                <Btn label={busy ? 'Checking…' : 'Sign in'} onPress={verifyCode} disabled={busy} />
              </View>
              <Text style={styles.linkText} onPress={() => setStage('email')}>
                Different email
              </Text>
            </>
          )
        ) : (
          <>
            <Row style={styles.signedRow}>
              <View style={styles.dot} />
              <Muted style={styles.flex}>Signed in as {session.user.email}</Muted>
            </Row>
            <Muted style={styles.lede}>
              {state.lastBackupAt
                ? `Last backup ${new Date(state.lastBackupAt).toLocaleString()}.`
                : 'No backup yet from this device.'}{' '}
              Photos and voice audio aren’t included yet — the catalog, decisions,
              stories, chat, and family roster are.
            </Muted>
            <View style={styles.cta}>
              <Btn label={busy ? 'Backing up…' : 'Back up now'} onPress={runBackup} disabled={busy} />
            </View>
            {confirmRestore ? (
              <View style={styles.cta}>
                <Btn
                  label={busy ? 'Restoring…' : 'Yes — replace this device’s data'}
                  kind="brass"
                  onPress={runRestore}
                  disabled={busy}
                />
                <Text style={styles.linkText} onPress={() => setConfirmRestore(false)}>
                  Keep what’s here
                </Text>
              </View>
            ) : (
              <View style={styles.cta}>
                <Btn
                  label="Restore from my backup"
                  kind="quiet"
                  onPress={() => setConfirmRestore(true)}
                />
              </View>
            )}
            <Text style={styles.linkText} onPress={signOutAccount}>
              Sign out of the account (keeps everything on this device)
            </Text>
          </>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  lede: { fontSize: 13.5, lineHeight: 19, marginBottom: Spacing.three },
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
  cta: { marginTop: Spacing.three },
  linkText: {
    marginTop: Spacing.three,
    fontSize: 13.5,
    fontWeight: '600',
    color: T.inkSoft,
    textAlign: 'center',
    minHeight: 24,
  },
  signedRow: { marginBottom: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.keep },
});
