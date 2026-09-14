/**
 * Account & sync — sign in, see that the family copy is current, and fix
 * anything that couldn't be shared.
 *
 * There is no "Back up now" or "Restore" any more. Every change goes to the
 * family's shared copy as it is made (src/lib/outbox.ts), and opening a home
 * loads that copy fresh (src/lib/household.ts). What this panel shows instead
 * is the truth about that: how many changes are still on their way, and —
 * the thing that used to be invisible — which ones the server refused, with
 * a way to try again or let go.
 *
 * Voice recordings still stay on the device; a story's words are shared.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { notify } from '@/components/child/shared';
import { Btn, Card, Heading, Label, Muted, Row } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { signOut, useSession } from '@/lib/auth';
import {
  acceptInvite,
  declineInvite,
  listPendingInvites,
  refreshOpenHousehold,
  uploadLocalHousehold,
  type PendingInvite,
} from '@/lib/household';
import {
  describeOp,
  discardOp,
  nudgeOutbox,
  retryOp,
  useFailedOps,
  useOutboxStatus,
} from '@/lib/outbox';
import { useActiveHousehold, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export function AccountSync() {
  const router = useRouter();
  // One session for the whole app (src/lib/auth.ts). 'resolving' counts as
  // not signed in yet: this panel shows account data, so it waits.
  const { status, email: sessionEmail } = useSession();
  const signedIn = status === 'signed-in';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<PendingInvite[]>([]);

  const household = useActiveHousehold();
  const isDemo = useStore((s) => s.isDemo);
  const outbox = useOutboxStatus();
  const failed = useFailedOps();
  const shared = Boolean(household?.cloudLinkedAt) && !isDemo;

  // Signed in → check whether any household is waiting for this person.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void listPendingInvites().then((list) => {
      if (!cancelled) setInvites(list);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const joinHousehold = async (inv: PendingInvite) => {
    setBusy(true);
    const res = await acceptInvite(inv.householdId);
    setBusy(false);
    if (!res.ok) {
      notify('Couldn’t join yet', res.error);
      return;
    }
    setInvites((v) => v.filter((x) => x.householdId !== inv.householdId));
    notify('Welcome in', `You’ve joined “${res.name}”.`);
    router.replace('/');
  };

  /**
   * Turn it down. Says no on the server and tells that household's
   * administrators, so an invitation nobody accepted stops looking like an
   * invitation nobody received.
   */
  const declineHousehold = async (inv: PendingInvite) => {
    setBusy(true);
    const res = await declineInvite(inv.householdId);
    setBusy(false);
    if (!res.ok) {
      notify('Couldn’t decline yet', res.error);
      return;
    }
    setInvites((v) => v.filter((x) => x.householdId !== inv.householdId));
    notify(
      'Invitation declined',
      res.notified
        ? `Whoever looks after “${inv.householdName}” has been told, so they’re not left waiting.`
        : `“${inv.householdName}” will see that you’ve declined.`
    );
  };

  /** OAuth sign-in (web). Buttons explain themselves if a provider isn't switched on. */
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

  /** Send what's waiting and load the family's latest copy of this home. */
  const syncNow = async () => {
    setBusy(true);
    nudgeOutbox();
    const res = await refreshOpenHousehold();
    setBusy(false);
    if (res.ok) {
      notify('Up to date', 'This device has the family’s latest copy of the home.');
    } else if (res.retry) {
      notify('Couldn’t reach the family copy', 'You’re offline or the connection dropped. Changes wait here and send when you’re back.');
    } else {
      notify('Couldn’t sync', res.error);
    }
  };

  /** A home that has only ever lived on this device joins the account. */
  const shareThisHome = async () => {
    if (!household) return;
    setBusy(true);
    const res = await uploadLocalHousehold(household.id);
    setBusy(false);
    if (res.ok) notify('Shared', `“${household.name}” is now in your account. Family you invite will see it.`);
    else notify('Couldn’t share this home yet', res.error);
  };

  return (
    <>
      <Label>Account & sync</Label>
      <Card>
        {!signedIn ? (
          stage === 'email' ? (
            <>
              <Muted style={styles.lede}>
                Sign in with your email to keep this household in your account —
                so a lost phone never means a lost inventory, and family can
                join. No password: we send a six-digit code instead.
              </Muted>
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
                    accessibilityLabel="Continue with Google"
                    onPress={oauth('google')}
                    style={styles.oauthBtn}
                  >
                    <Ionicons name="logo-google" size={18} color={T.ink} />
                    <Text style={styles.oauthText}>Continue with Google</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Apple"
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
                aria-label="Six-digit code"
                keyboardType="number-pad"
                maxLength={6}
                returnKeyType="done"
                onSubmitEditing={verifyCode}
              />
              <View style={styles.cta}>
                <Btn label={busy ? 'Checking…' : 'Sign in'} onPress={verifyCode} disabled={busy} />
              </View>
              <Text accessibilityRole="button" style={styles.linkText} onPress={() => setStage('email')}>
                Different email
              </Text>
            </>
          )
        ) : (
          <>
            <Row style={styles.signedRow}>
              <View style={styles.dot} />
              <Muted style={styles.flex}>Signed in as {sessionEmail}</Muted>
            </Row>

            {invites.map((inv) => (
              <View key={inv.householdId} style={styles.inviteWell}>
                <Heading style={styles.inviteHeading}>
                  You&rsquo;ve been invited to help with &ldquo;{inv.householdName}&rdquo;
                </Heading>
                <Muted style={styles.inviteSub}>
                  Joining brings the family&rsquo;s shared inventory onto this
                  device, alongside the homes already here.
                </Muted>
                <View style={styles.cta}>
                  <Btn
                    label={busy ? 'Joining…' : 'Join the household'}
                    kind="brass"
                    onPress={() => joinHousehold(inv)}
                    disabled={busy}
                  />
                </View>
                <Text
                  accessibilityRole="button"
                  style={styles.linkText}
                  onPress={() => declineHousehold(inv)}
                >
                  No thanks &mdash; decline this invitation
                </Text>
              </View>
            ))}

            {isDemo ? null : shared ? (
              <>
                <Muted style={styles.lede}>
                  {outbox.pending
                    ? `${outbox.pending} change${outbox.pending === 1 ? '' : 's'} on the way to the family.`
                    : 'Everything you’ve changed here has reached the family.'}{' '}
                  Changes send as you make them; voice recordings stay on this device.
                </Muted>
                <View style={styles.cta}>
                  <Btn label={busy ? 'Syncing…' : 'Sync now'} onPress={syncNow} disabled={busy} />
                </View>
              </>
            ) : household ? (
              <>
                <Muted style={styles.lede}>
                  &ldquo;{household.name}&rdquo; is only on this device. Share it with your
                  account to keep it safe and let family join.
                </Muted>
                <View style={styles.cta}>
                  <Btn label={busy ? 'Sharing…' : 'Share this home'} onPress={shareThisHome} disabled={busy} />
                </View>
              </>
            ) : null}

            {failed.length > 0 && (
              <View style={styles.failedWell}>
                <Heading style={styles.failedHeading}>
                  {failed.length === 1 ? 'One change couldn’t be shared' : `${failed.length} changes couldn’t be shared`}
                </Heading>
                <Muted style={styles.failedSub}>
                  It&rsquo;s still on this device. The family&rsquo;s copy said no, or couldn&rsquo;t take it:
                </Muted>
                {failed.map((op) => (
                  <View key={op.id} style={styles.failedRow}>
                    <Text style={styles.failedWhat}>{describeOp(op)}</Text>
                    {op.lastError ? <Muted style={styles.failedWhy}>{op.lastError}</Muted> : null}
                    <Row style={styles.failedActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Try again: ${describeOp(op)}`}
                        onPress={() => retryOp(op.id)}
                        style={styles.failedBtn}
                      >
                        <Text style={styles.failedBtnText}>Try again</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Stop trying: ${describeOp(op)}`}
                        onPress={() => discardOp(op.id)}
                        style={styles.failedBtn}
                      >
                        <Text style={styles.failedBtnText}>Stop trying</Text>
                      </Pressable>
                    </Row>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.cta}>
              <Btn label="Log out" kind="quiet" onPress={() => void signOut()} />
            </View>
            <Muted style={styles.signOutNote}>
              Logging out keeps everything on this device and the family copy in
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
  failedWell: {
    marginTop: Spacing.three,
    backgroundColor: T.tossTint,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: T.toss,
    padding: Spacing.three,
  },
  failedHeading: { fontSize: 16 },
  failedSub: { marginTop: Spacing.one, fontSize: 13 },
  failedRow: { marginTop: Spacing.three },
  failedWhat: { fontSize: 14, fontWeight: '600', color: T.ink },
  failedWhy: { fontSize: 13, marginTop: 2 },
  failedActions: { gap: Spacing.three, marginTop: Spacing.one },
  failedBtn: { minHeight: 44, justifyContent: 'center' },
  failedBtnText: { fontSize: 13.5, fontWeight: '600', color: T.inkSoft, textDecorationLine: 'underline' },
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
