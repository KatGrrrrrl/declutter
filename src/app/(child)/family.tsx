/**
 * Child family — the household roster, plain about authority: the designated
 * decider(s) hold the final say on every item; everyone else helps. Shows who
 * set the home up and who has the final say (per household — different homes
 * can have different deciders).
 *
 * Membership flow: anyone may invite a family member by name; the invitation
 * waits as "Invited" until a decider approves (or declines) it here. With no
 * backend yet these are local records — nothing is emailed; real invite
 * delivery arrives with accounts + sync.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, notify } from '@/components/child/shared';
import { SETTINGS_ROUTE } from '@/components/settings/routes';
import { Btn, Card, Label, Muted, Row, Screen, Title, Well } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { sendInviteEmail } from '@/lib/invites';
import { Member, useActiveHousehold, useCanDecide, useMembers, useStore } from '@/lib/store';

export default function FamilyScreen() {
  const router = useRouter();
  const householdName = useStore((s) => s.householdName);
  const ownerName = useStore((s) => s.ownerName);
  const userName = useStore((s) => s.userName);
  const items = useStore((s) => s.items);
  const setRole = useStore((s) => s.setRole);
  const inviteMember = useStore((s) => s.inviteMember);
  const approveMember = useStore((s) => s.approveMember);
  const declineMember = useStore((s) => s.declineMember);
  const household = useActiveHousehold();
  const members = useMembers();
  const canDecide = useCanDecide();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteRel, setInviteRel] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  const deciders = household?.deciderNames ?? [ownerName];
  const createdBy = household?.createdBy ?? ownerName;

  const active = members.filter((m) => m.status === 'active');
  const invited = members.filter((m) => m.status === 'invited');
  const pending = items.filter((i) => i.requestedBy);

  const sendInvite = () => {
    const name = inviteName.trim();
    const email = inviteEmail.trim().toLowerCase();
    if (!name) return;
    if (!email.includes('@') || !email.includes('.')) {
      notify(
        'An email is needed',
        'The invitation has to reach them somewhere — add their email address.'
      );
      return;
    }
    inviteMember(name, inviteRel.trim() || undefined, email);
    setInviteName('');
    setInviteRel('');
    setInviteEmail('');
    setInviteOpen(false);
  };

  /** Approve → membership flips locally, then the invitation email goes out. */
  const approveAndSend = async (m: Member) => {
    approveMember(m.id);
    if (!m.email) {
      notify(
        'Approved — no email on file',
        `${m.name} is approved, but this invitation has no email address. Add them again with one to send it.`
      );
      return;
    }
    const res = await sendInviteEmail(m, householdName, userName);
    if (res.ok) {
      notify(
        'Invitation sent',
        res.alreadyRegistered
          ? `${m.name} already has a Declutter account — we let them know they're in.`
          : `${m.name} will get an email at ${m.email} with a link to join.`
      );
    } else {
      notify('Approved, but the email didn’t send', res.error ?? 'Try again from this screen.');
    }
  };

  const viewAsOwner = () => {
    setRole('owner');
    router.replace('/');
  };

  return (
    <Screen>
      <Label>{householdName}</Label>
      <Title>Family</Title>

      <Card style={styles.authority}>
        <Row style={styles.authorityRow}>
          <Ionicons name="shield-checkmark-outline" size={20} color={T.brass} />
          <Muted style={styles.flex}>
            <Text style={styles.strong}>
              {deciders.join(' and ')} {deciders.length === 1 ? 'holds' : 'hold'} the
              final say here.
            </Text>{' '}
            Every keep, donate, and heir choice is theirs. Everyone else helps by
            adding photos and notes.
          </Muted>
        </Row>
        <Row style={styles.govRow}>
          <Ionicons name="key-outline" size={15} color={T.brass} />
          <Muted style={styles.govText}>Final say: {deciders.join(', ')}</Muted>
        </Row>
        <Row style={styles.govRow}>
          <Ionicons name="home-outline" size={15} color={T.brass} />
          <Muted style={styles.govText}>Set up by {createdBy}</Muted>
        </Row>
      </Card>

      {/* members */}
      <View style={styles.list}>
        {active.map((m) => (
          <MemberRow
            key={m.id}
            name={m.name === userName ? `${m.name} (you)` : m.name}
            avatarName={m.name}
            rel={m.relationship ?? (m.name === createdBy ? 'Set up the home' : 'Family')}
            badge={deciders.includes(m.name) ? 'Owner' : 'Helper'}
            badgeKind={deciders.includes(m.name) ? 'owner' : 'helper'}
            finalSay={deciders.includes(m.name)}
          />
        ))}
      </View>

      {/* pending invitations — deciders approve, everyone else sees status */}
      {invited.length > 0 && (
        <>
          <Label>Waiting to join</Label>
          {invited.map((m) => (
            <Card key={m.id} style={styles.pendingCard}>
              <Row style={styles.contactRow}>
                <Avatar name={m.name} size={44} color={T.inkFaint} />
                <View style={styles.flex}>
                  <Text style={styles.memberName}>{m.name}</Text>
                  <Muted style={styles.memberRel}>
                    {m.relationship ? `${m.relationship} · ` : ''}invited by {m.invitedBy}
                    {m.email ? ` · ${m.email}` : ' · no email yet'}
                  </Muted>
                </View>
                {canDecide ? (
                  <Row style={styles.approveRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Approve ${m.name}`}
                      onPress={() => approveAndSend(m)}
                      style={[styles.actBtn, styles.approveBtn]}
                    >
                      <Text style={styles.approveText}>Approve</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Decline ${m.name}`}
                      onPress={() => declineMember(m.id)}
                      style={[styles.actBtn, styles.declineBtn]}
                    >
                      <Text style={styles.declineText}>Decline</Text>
                    </Pressable>
                  </Row>
                ) : (
                  <View style={[styles.badge, styles.badgeInvited]}>
                    <Text style={[styles.badgeText, styles.badgeInvitedText]}>
                      Awaiting {deciders[0]}
                    </Text>
                  </View>
                )}
              </Row>
            </Card>
          ))}
        </>
      )}

      {/* pending item request */}
      {pending.length > 0 && (
        <Well style={styles.pendingWell}>
          <Row style={styles.authorityRow}>
            <Ionicons name="hand-left-outline" size={18} color={T.donate} />
            <Muted style={styles.flex}>
              <Text style={styles.strong}>
                {pending.length === 1
                  ? 'Request pending'
                  : `${pending.length} requests pending`}
                .
              </Text>{' '}
              Only {ownerName} sees who asked — siblings never see each other&apos;s
              requests.
            </Muted>
          </Row>
        </Well>
      )}

      {/* invite form */}
      {inviteOpen ? (
        <Card style={styles.inviteCard}>
          <Label style={styles.inviteLabel}>Invite a family member</Label>
          <TextInput
            style={styles.input}
            value={inviteName}
            onChangeText={setInviteName}
            placeholder="Name — e.g. Noor"
            placeholderTextColor={T.inkFaint}
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            style={[styles.input, styles.inputGap]}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="Their email — where the invite is sent"
            placeholderTextColor={T.inkFaint}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
          />
          <TextInput
            style={[styles.input, styles.inputGap]}
            value={inviteRel}
            onChangeText={setInviteRel}
            placeholder="Relationship (optional)"
            placeholderTextColor={T.inkFaint}
            returnKeyType="done"
            onSubmitEditing={sendInvite}
          />
          <Muted style={styles.inviteNote}>
            {canDecide
              ? 'You hold the final say — the email goes out the moment you approve.'
              : `They'll wait for ${deciders.join(' or ')} to approve; the email is sent on approval.`}
          </Muted>
          <Row style={styles.inviteActions}>
            <View style={styles.flex}>
              <Btn label="Send invitation" onPress={sendInvite} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setInviteOpen(false)}
              style={styles.cancelBtn}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Row>
        </Card>
      ) : (
        <View style={styles.inviteBtn}>
          <Btn label="Invite someone" kind="quiet" onPress={() => setInviteOpen(true)} />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(SETTINGS_ROUTE)}
        style={styles.settingsBtn}
      >
        <Ionicons name="settings-outline" size={17} color={T.inkSoft} />
        <Text style={styles.settingsText}>Settings</Text>
      </Pressable>

      {/* quiet demo control */}
      <Pressable accessibilityRole="button" onPress={viewAsOwner} style={styles.demoBtn}>
        <Ionicons name="swap-horizontal-outline" size={14} color={T.inkFaint} />
        <Text style={styles.demoText}>View as {ownerName} (owner)</Text>
      </Pressable>
    </Screen>
  );
}

function MemberRow({
  name,
  rel,
  badge,
  badgeKind = 'helper',
  avatarName,
  finalSay = false,
}: {
  name: string;
  rel: string;
  badge: string;
  badgeKind?: 'owner' | 'helper' | 'invited';
  avatarName?: string;
  /** True when this member holds the final say in the active household. */
  finalSay?: boolean;
}) {
  const badgeStyle =
    badgeKind === 'owner'
      ? styles.badgeOwner
      : badgeKind === 'invited'
        ? styles.badgeInvited
        : styles.badgeHelper;
  const badgeTextStyle =
    badgeKind === 'owner'
      ? styles.badgeOwnerText
      : badgeKind === 'invited'
        ? styles.badgeInvitedText
        : styles.badgeHelperText;
  return (
    <View style={styles.memberRow}>
      <Avatar
        name={avatarName ?? name}
        size={44}
        color={badgeKind === 'invited' ? T.inkFaint : T.brass}
      />
      <View style={styles.flex}>
        <Text style={styles.memberName}>{name}</Text>
        <Muted style={styles.memberRel}>{rel}</Muted>
      </View>
      {finalSay && (
        <View style={[styles.badge, styles.badgeFinal]}>
          <Ionicons name="key" size={10} color={T.brassDeep} />
          <Text style={[styles.badgeText, styles.badgeFinalText]}>Final say</Text>
        </View>
      )}
      <View style={[styles.badge, badgeStyle]}>
        <Text style={[styles.badgeText, badgeTextStyle]}>{badge}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strong: { color: T.ink, fontWeight: '700' },

  authority: { marginTop: Spacing.two, backgroundColor: T.sunken },
  authorityRow: { alignItems: 'flex-start', gap: Spacing.two },
  govRow: { marginTop: Spacing.two, gap: Spacing.two },
  govText: { fontSize: 12.5, color: T.inkSoft },

  list: { marginTop: Spacing.three, marginBottom: Spacing.two },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: T.lineSoft,
  },
  memberName: { fontSize: 15, fontWeight: '700', color: T.ink },
  memberRel: { fontSize: 11.5, marginTop: 1 },

  badge: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  badgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  badgeOwner: { backgroundColor: T.brassTint },
  badgeOwnerText: { color: T.brassDeep },
  badgeHelper: { backgroundColor: T.sunken },
  badgeHelperText: { color: T.inkSoft },
  badgeInvited: { backgroundColor: T.donateTint },
  badgeInvitedText: { color: T.donate },
  badgeFinal: {
    backgroundColor: T.brassTint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeFinalText: { color: T.brassDeep },

  pendingCard: { marginTop: Spacing.two },
  contactRow: { gap: Spacing.three },
  approveRow: { gap: Spacing.two },
  actBtn: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: Radius.control,
    paddingHorizontal: 14,
  },
  approveBtn: { backgroundColor: T.keepTint },
  approveText: { color: T.keep, fontWeight: '700', fontSize: 13 },
  declineBtn: { backgroundColor: T.sunken },
  declineText: { color: T.inkSoft, fontWeight: '700', fontSize: 13 },

  pendingWell: { marginTop: Spacing.three },

  inviteCard: { marginTop: Spacing.four },
  inviteLabel: { marginTop: 0 },
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
  inputGap: { marginTop: Spacing.two },
  inviteNote: { marginTop: Spacing.two, fontSize: 12.5 },
  inviteActions: { marginTop: Spacing.three, gap: Spacing.two },
  cancelBtn: { minHeight: 52, justifyContent: 'center', paddingHorizontal: Spacing.three },
  cancelText: { color: T.inkSoft, fontWeight: '600', fontSize: 15 },
  inviteBtn: { marginTop: Spacing.four },

  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    marginTop: Spacing.four,
    borderTopWidth: 1,
    borderTopColor: T.lineSoft,
  },
  settingsText: { fontSize: 16, fontWeight: '700', color: T.ink },

  demoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.five,
    paddingVertical: Spacing.two,
  },
  demoText: { fontSize: 12.5, fontWeight: '600', color: T.inkFaint },
});
