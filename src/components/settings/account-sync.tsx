/**
 * Account & sync — sign-in, cloud backup of the household catalog, and
 * restore onto a fresh device. Backup covers items, decisions, stories, chat,
 * roster, donation destinations, and photos (EXIF-stripped server-side by the
 * upload-photo function, swept on every backup). Voice audio is the one thing
 * that still stays on the device.
 */

import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { notify } from '@/components/child/shared';
import { Btn, Card, Heading, Label, Muted, Row } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { acceptInvite, listPendingInvites, PendingInvite, pickMyHousehold } from '@/lib/join';
import { uploadPendingPhotos } from '@/lib/photo-sync';
import { useActiveHousehold, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { backupHousehold, restoreHousehold } from '@/lib/sync';

import type { CloudHouseholdSummary } from '@/lib/sync';

export function AccountSync() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  // The account belongs to several cloud homes and none is the one open here:
  // the person picks which to restore. Never guessed.
  const [restoreChoices, setRestoreChoices] = useState<CloudHouseholdSummary[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);

  const state = useStore();
  const household = useActiveHousehold();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Signed in → check whether any household is waiting for this person.
  // (Async fetch only; the signed-out case renders no invites anyway.)
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    listPendingInvites().then((list) => {
      if (!cancelled) setInvites(list);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const joinHousehold = async (inv: PendingInvite) => {
    setBusy(true);
    const res = await acceptInvite(inv.householdId);
    setBusy(false);
    if (!res.ok) {
      notify('Couldn’t join yet', res.error ?? 'Try again in a moment.');
      return;
    }
    setInvites((v) => v.filter((x) => x.householdId !== inv.householdId));
    notify('Welcome in', `You’ve joined “${res.householdName}”.`);
    router.replace('/');
  };

  /** OAuth sign-in (web). Buttons work once the provider is configured in
   *  Supabase; until then they explain themselves instead of failing. */
  const oauth = (provider: 'google' | 'apple') => async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: typeof location !== 'undefined' ? location.origin : undefined },
    });
    if (error) {
      notify(
        provider === 'google' ? 'Google sign-in isn’t ready yet' : 'Apple sign-in isn’t ready yet',
        'Email codes work today — or check back after this provider is switched on.'
      );
    }
  };

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
      wasBackedUp: Boolean(household?.cloudLinkedAt),
      activeHouseholdId: state.activeHouseholdId,
      householdName: state.householdName,
      items: state.items,
      people: state.people,
      collections: state.collections,
      rooms: state.rooms,
      messages: state.messages,
      members: state.members,
      deciderNames: household?.deciderNames ?? [state.ownerName],
      adminNames: household?.adminNames ?? [household?.createdBy ?? state.userName],
      userName: state.userName,
    });
    setBusy(false);
    if (!res.ok) {
      notify('Backup didn’t finish', res.error ?? 'Something went wrong — try again.');
      return;
    }
    if (res.cloudHouseholdId) state.markCloudLinked(res.cloudHouseholdId, new Date().toISOString());
    // Catalog is up; now sweep any photos that haven't uploaded yet.
    const photos = await uploadPendingPhotos();
    const skipped = res.skippedLocalOnly
      ? ` ${res.skippedLocalOnly} device-only item${res.skippedLocalOnly === 1 ? '' : 's'} stayed private, as promised.`
      : '';
    const photoNote = photos.uploaded
      ? ` ${photos.uploaded} photo${photos.uploaded === 1 ? '' : 's'} uploaded.`
      : '';
    notify('Backed up', `${res.itemsPushed} items are safe in your account.${photoNote}${skipped}`);
  };

  const runRestore = async (householdId?: string) => {
    setBusy(true);
    let id = householdId;
    if (!id) {
      const picked = await pickMyHousehold();
      if (picked.choices) {
        // Several homes, none of them the one open here — ask, don't guess.
        setBusy(false);
        setRestoreChoices(picked.choices);
        return;
      }
      if (!picked.id) {
        setBusy(false);
        setConfirmRestore(false);
        notify('Nothing restored', picked.error ?? 'No backup found.');
        return;
      }
      id = picked.id;
    }
    const res = await restoreHousehold(id);
    setBusy(false);
    setConfirmRestore(false);
    setRestoreChoices([]);
    if (!res.ok || !res.snapshot) {
      notify('Nothing restored', res.error ?? 'No backup found.');
      return;
    }
    state.restoreSnapshot(res.snapshot);
    notify('Restored', `“${res.snapshot.householdName}” is back — ${res.snapshot.items.length} items.`);
  };

  /** Same contract as the Settings-top Log out: disconnect AND lock. */
  const signOutAccount = async () => {
    const email = session?.user.email ?? '';
    await supabase.auth.signOut();
    useStore.getState().lockOut(email);
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
              {Platform.OS === 'web' && (
                <>
                  <Row style={styles.orRow}>
                    <View style={styles.orLine} />
                    <Muted style={styles.orText}>or</Muted>
                    <View style={styles.orLine} />
                  </Row>
                  <Pressable
                    accessibilityRole="button"
                    onPress={oauth('google')}
                    style={styles.oauthBtn}
                  >
                    <Ionicons name="logo-google" size={18} color={T.ink} />
                    <Text style={styles.oauthText}>Continue with Google</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={oauth('apple')}
                    style={styles.oauthBtn}
                  >
                    <Ionicons name="logo-apple" size={18} color={T.ink} />
                    <Text style={styles.oauthText}>Continue with Apple</Text>
                  </Pressable>
                </>
              )}
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
            {invites.map((inv) => (
              <View key={inv.householdId} style={styles.inviteWell}>
                <Heading style={styles.inviteHeading}>
                  You&rsquo;re invited to &ldquo;{inv.householdName}&rdquo;
                </Heading>
                <Muted style={styles.inviteSub}>
                  Joining loads the family&rsquo;s shared inventory onto this
                  device. Your own current data here stays untouched in your
                  account backups.
                </Muted>
                <View style={styles.cta}>
                  <Btn
                    label={busy ? 'Joining…' : 'Join the household'}
                    kind="brass"
                    onPress={() => joinHousehold(inv)}
                    disabled={busy}
                  />
                </View>
              </View>
            ))}
            <Muted style={styles.lede}>
                  {household?.lastBackupAt
                    ? `Last backup ${new Date(household.lastBackupAt).toLocaleString()}.`
                    : 'No backup yet from this device.'}{' '}
                  Photos, the catalog, decisions, stories, chat, and the family
                  roster are all included. Voice recordings stay on this device
                  for now.
                </Muted>
                <View style={styles.cta}>
                  <Btn label={busy ? 'Backing up…' : 'Back up now'} onPress={runBackup} disabled={busy} />
                </View>
                {confirmRestore && restoreChoices.length > 0 ? (
                  <View style={styles.cta}>
                    <Muted style={styles.lede}>Your account has more than one home. Which one?</Muted>
                    {restoreChoices.map((c) => (
                      <Btn
                        key={c.id}
                        label={busy ? 'Restoring…' : c.name}
                        kind="brass"
                        onPress={() => runRestore(c.id)}
                        disabled={busy}
                      />
                    ))}
                    <Text
                      style={styles.linkText}
                      onPress={() => {
                        setRestoreChoices([]);
                        setConfirmRestore(false);
                      }}
                    >
                      Keep what’s here
                    </Text>
                  </View>
                ) : confirmRestore ? (
                  <View style={styles.cta}>
                    <Btn
                      label={busy ? 'Restoring…' : 'Yes — replace this device’s data'}
                      kind="brass"
                      onPress={() => runRestore()}
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
            <View style={styles.cta}>
              <Btn label="Log out" kind="quiet" onPress={signOutAccount} />
            </View>
            <Muted style={styles.signOutNote}>
              Logging out keeps everything on this device and your backups in
              your account. To erase this device instead, use &ldquo;Sign out &amp;
              erase&rdquo; below.
            </Muted>
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
  inviteWell: {
    backgroundColor: T.brassTint,
    borderRadius: Radius.control,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  inviteHeading: { fontSize: 17 },
  inviteSub: { marginTop: Spacing.one, fontSize: 13 },
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
  signOutNote: { marginTop: Spacing.two, fontSize: 12.5, textAlign: 'center' },
});
