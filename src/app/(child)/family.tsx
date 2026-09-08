/**
 * Child family — every family home this user helps with, one card each, plus
 * the roster of the home that is open. Plain about authority: the designated
 * decider(s) hold the final say on every item; everyone else helps. Each card
 * shows who set the home up and who has the final say (per household —
 * different homes can have different deciders). The big "+" in the header
 * starts another family home; tapping a card opens it.
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
import { SETTINGS_ROUTE, UPGRADE_ROUTE } from '@/components/settings/routes';
import { Btn, Card, Heading, Label, Muted, Row, Screen, Title, Well } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { sendInviteEmail } from '@/lib/invites';
import { createCloudInvite } from '@/lib/join';
import {
  Member,
  useActiveHousehold,
  useAdminNames,
  useCanDecide,
  useIsAdmin,
  useMembers,
  useStore,
} from '@/lib/store';

export default function FamilyScreen() {
  const router = useRouter();
  const householdName = useStore((s) => s.householdName);
  const ownerName = useStore((s) => s.ownerName);
  const userName = useStore((s) => s.userName);
  const role = useStore((s) => s.role);
  const items = useStore((s) => s.items);
  const households = useStore((s) => s.households);
  const activeHouseholdId = useStore((s) => s.activeHouseholdId);
  const addHousehold = useStore((s) => s.addHousehold);
  const switchHousehold = useStore((s) => s.switchHousehold);
  const setRole = useStore((s) => s.setRole);
  const inviteMember = useStore((s) => s.inviteMember);
  const approveMember = useStore((s) => s.approveMember);
  const declineMember = useStore((s) => s.declineMember);
  const reinviteMember = useStore((s) => s.reinviteMember);
  const removeMember = useStore((s) => s.removeMember);
  const setAdmin = useStore((s) => s.setAdmin);
  const household = useActiveHousehold();
  const members = useMembers();
  const canDecide = useCanDecide();
  const isAdmin = useIsAdmin();
  const adminNames = useAdminNames();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteRel, setInviteRel] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  /** Which member's manage panel is open, and whether it is on the confirm step. */
  const [managing, setManaging] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [addingFamily, setAddingFamily] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [newFamilyDeciders, setNewFamilyDeciders] = useState('');

  const deciders = household?.deciderNames ?? [ownerName];
  const createdBy = household?.createdBy ?? ownerName;

  // Membership (who is IN the household) belongs to the ADMINISTRATORS —
  // separate from item decisions, which belong to the deciders. This matters
  // because the deciders are often invitees who haven't joined yet, so gating
  // approvals on them alone deadlocks: nobody could ever be let in.
  //
  // Approving an invitation stays open to deciders too (they are already
  // trusted with the parent's things). Removing a person does not: that is an
  // administrator's call alone, and the one action that can remove a decider.
  const canManageMembers = isAdmin || canDecide || userName === createdBy;
  const isAdminName = (n: string) =>
    adminNames.some((a) => a.toLowerCase() === n.toLowerCase());

  const active = members.filter((m) => m.status === 'active');
  const invited = members.filter((m) => m.status === 'invited');
  // People who were asked and said no. Listed rather than quietly dropped: an
  // invitation that simply stops appearing is indistinguishable from one that
  // was never sent, and the family is owed the answer they waited for.
  const declined = members.filter((m) => m.status === 'declined');
  const pending = items.filter((i) => i.requestedBy);

  const closeNewFamily = () => {
    setAddingFamily(false);
    setNewFamilyName('');
    setNewFamilyDeciders('');
  };

  /**
   * Start another family home. Comma-separated decider names; blank means this
   * user holds the final say there. The new home opens immediately (the store
   * switches to it), so the roster below is ready for invitations.
   */
  const saveFamily = () => {
    const name = newFamilyName.trim();
    if (!name) return;
    const deciders = newFamilyDeciders
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const res = addHousehold(name, deciders.length ? deciders : undefined);
    if (!res.ok) {
      router.push(UPGRADE_ROUTE);
      return;
    }
    closeNewFamily();
    notify('Family added', `${name} is open now. Invite the people who belong there below.`);
  };

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

  /**
   * Approve → membership flips locally, a real cloud membership invitation is
   * created (so joining actually works), then the invitation email goes out.
   *
   * Also the "ask again" path for someone who declined: the only difference is
   * which way the roster line moves (back to 'invited' rather than on to
   * 'active'); everything downstream — the cloud invitation, the email — is
   * the same invitation being issued a second time.
   */
  const approveAndSend = async (m: Member) => {
    if (m.status === 'declined') reinviteMember(m.id);
    else approveMember(m.id);
    if (!m.email) {
      notify(
        'Approved — no email on file',
        `${m.name} is approved, but this invitation has no email address. Add them again with one to send it.`
      );
      return;
    }
    const cloud = await createCloudInvite(m);
    const res = await sendInviteEmail(m, householdName, userName);
    if (res.ok && cloud.ok) {
      notify(
        'Invitation sent',
        res.alreadyRegistered
          ? `${m.name} already has an Inventory Our Home account — signing in will show them the invitation to join.`
          : `${m.name} will get an email at ${m.email}. Once they sign in, "${householdName}" will be waiting for them to join.`
      );
    } else if (res.ok) {
      notify(
        'Email sent — one more step needed',
        cloud.error ?? 'The cloud invitation could not be created; try approving again after backing up.'
      );
    } else {
      notify('Approved, but the email didn’t send', res.error ?? 'Try again from this screen.');
    }
  };

  /**
   * Remove someone from the home. The store refuses to strand the household —
   * it will not let the last administrator or the last decider go — so the
   * message here explains the way out rather than just saying no.
   */
  const doRemoveMember = (m: Member) => {
    const res = removeMember(m.id);
    setConfirmRemove(null);
    setManaging(null);
    if (res.ok) {
      notify(
        `${m.name} was removed`,
        `They no longer have access to ${householdName}. Everything they added stays in the record — removing a person doesn't remove what they catalogued.`
      );
      return;
    }
    if (res.reason === 'last-admin') {
      notify(
        'Someone has to run this home',
        `${m.name} is the only person who can manage ${householdName}. Make someone else an administrator first, then you can remove them.`
      );
    } else if (res.reason === 'last-decider') {
      notify(
        'Someone has to have the final say',
        `${m.name} is the only decider at ${householdName}. Nothing could be kept or let go without them. Give someone else the final say first.`
      );
    }
  };

  const toggleAdmin = (m: Member) => {
    const res = setAdmin(m.name, !isAdminName(m.name));
    if (!res.ok && res.reason === 'last-admin') {
      notify(
        'Someone has to run this home',
        `${m.name} is the only administrator. Make someone else one first.`
      );
    }
  };

  const viewAsOwner = () => {
    setRole('owner');
    router.replace('/');
  };

  return (
    <Screen>
      <Row style={styles.headerRow}>
        <View style={styles.flex}>
          <Label>{householdName}</Label>
          <Title>Family</Title>
        </View>
        {/* Big "+" — starts another family home. Toggles to a close glyph while
            the form is open so the same target dismisses it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addingFamily ? 'Close the new family form' : 'Add a new family home'}
          accessibilityState={{ expanded: addingFamily }}
          onPress={() => (addingFamily ? closeNewFamily() : setAddingFamily(true))}
          style={({ pressed }) => [styles.addFab, pressed && styles.addFabPressed]}
        >
          <Ionicons name={addingFamily ? 'close' : 'add'} size={36} color={T.surface} />
        </Pressable>
      </Row>

      {/* new family form */}
      {addingFamily && (
        <Card style={styles.newFamilyCard}>
          <Label asHeading style={styles.inviteLabel}>
            New family home
          </Label>
          <TextInput
            style={styles.input}
            value={newFamilyName}
            onChangeText={setNewFamilyName}
            placeholder="Name — e.g. The Cottage"
            placeholderTextColor={T.inkFaint}
            aria-label="New family home name"
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            style={[styles.input, styles.inputGap]}
            value={newFamilyDeciders}
            onChangeText={setNewFamilyDeciders}
            placeholder={`Who has the final say there? (${userName})`}
            placeholderTextColor={T.inkFaint}
            aria-label="Who has the final say in the new family home"
            returnKeyType="done"
            onSubmitEditing={saveFamily}
          />
          <Muted style={styles.inviteNote}>
            Leave that blank if it&rsquo;s you. Separate names with commas for more
            than one.
          </Muted>
          <Row style={styles.inviteActions}>
            <View style={styles.flex}>
              <Btn label="Add family" onPress={saveFamily} />
            </View>
            <Pressable accessibilityRole="button" onPress={closeNewFamily} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Row>
        </Card>
      )}

      {/* families — one card each; the open one carries the authority note */}
      <Label asHeading>Your families</Label>
      {households.map((h) => {
        const open = h.id === activeHouseholdId;
        const hDeciders = h.deciderNames.length ? h.deciderNames : [ownerName];
        return (
          <Pressable
            key={h.id}
            accessibilityRole="button"
            accessibilityState={{ selected: open }}
            accessibilityLabel={open ? `${h.name}, open` : `Open ${h.name}`}
            onPress={() => {
              if (!open) switchHousehold(h.id);
            }}
            style={({ pressed }) => [pressed && !open && styles.pressed]}
          >
            <Card style={[styles.familyCard, open && styles.familyCardOpen]}>
              <Row style={styles.familyHead}>
                <Heading style={styles.flex}>{h.name}</Heading>
                <View style={[styles.badge, open ? styles.badgeOwner : styles.badgeHelper]}>
                  <Text
                    style={[styles.badgeText, open ? styles.badgeOwnerText : styles.badgeHelperText]}
                  >
                    {open ? 'Open' : 'Tap to open'}
                  </Text>
                </View>
              </Row>
              {open && (
                <Row style={[styles.authorityRow, styles.familyNote]}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={T.brass} />
                  <Muted style={styles.flex}>
                    <Text style={styles.strong}>
                      {hDeciders.join(' and ')} {hDeciders.length === 1 ? 'holds' : 'hold'}{' '}
                      the final say here.
                    </Text>{' '}
                    Every keep, donate, and heir choice is theirs. Everyone else helps by
                    adding photos and notes.
                  </Muted>
                </Row>
              )}
              <Row style={styles.govRow}>
                <Ionicons name="key-outline" size={15} color={T.brass} />
                <Muted style={styles.govText}>Final say: {hDeciders.join(', ')}</Muted>
              </Row>
              <Row style={styles.govRow}>
                <Ionicons name="home-outline" size={15} color={T.brass} />
                <Muted style={styles.govText}>Set up by {h.createdBy || createdBy}</Muted>
              </Row>
            </Card>
          </Pressable>
        );
      })}

      {/* members of the open family */}
      <Label asHeading style={styles.rosterLabel}>
        People at {householdName}
      </Label>
      <View style={styles.list}>
        {active.map((m) => {
          const admin = isAdminName(m.name);
          const open = managing === m.id;
          return (
            <View key={m.id}>
              <MemberRow
                name={m.name === userName ? `${m.name} (you)` : m.name}
                avatarName={m.name}
                rel={m.relationship ?? (m.name === createdBy ? 'Set up the home' : 'Family')}
                badge={deciders.includes(m.name) ? 'Owner' : 'Helper'}
                badgeKind={deciders.includes(m.name) ? 'owner' : 'helper'}
                finalSay={deciders.includes(m.name)}
                admin={admin}
                // Administrators manage everyone but themselves: stepping down
                // is a different decision from removing someone, and mixing
                // the two is how a household locks itself out.
                onManage={isAdmin && m.name !== userName ? () => {
                  setConfirmRemove(null);
                  setManaging(open ? null : m.id);
                } : undefined}
                managing={open}
              />
              {open && (
                <Well style={styles.manageWell}>
                  <Muted style={styles.manageNote}>
                    {admin
                      ? `${m.name} can manage this home — add and remove people, and remove items from the record.`
                      : `${m.name} helps here. Administrators can also manage people and remove items.`}
                  </Muted>
                  <Row style={styles.manageActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        admin
                          ? `Remove ${m.name} as an administrator`
                          : `Make ${m.name} an administrator`
                      }
                      onPress={() => toggleAdmin(m)}
                      style={[styles.actBtn, styles.approveBtn]}
                    >
                      <Text style={styles.approveText}>
                        {admin ? 'Not an administrator' : 'Make administrator'}
                      </Text>
                    </Pressable>
                    {confirmRemove === m.id ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Yes, remove ${m.name} from this home`}
                        onPress={() => doRemoveMember(m)}
                        style={[styles.actBtn, styles.declineBtn]}
                      >
                        <Text style={styles.declineText}>Yes — remove them</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${m.name} from this home`}
                        onPress={() => setConfirmRemove(m.id)}
                        style={[styles.actBtn, styles.declineBtn]}
                      >
                        <Text style={styles.declineText}>Remove from home</Text>
                      </Pressable>
                    )}
                  </Row>
                  {confirmRemove === m.id && (
                    <Muted style={styles.manageNote}>
                      {m.name} loses access to {householdName}. Everything they added
                      stays — the photos, the stories, the record.
                    </Muted>
                  )}
                </Well>
              )}
            </View>
          );
        })}
      </View>

      {/* pending invitations — deciders approve, everyone else sees status */}
      {invited.length > 0 && (
        <>
          <Label asHeading>Waiting to join</Label>
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
                {canManageMembers ? (
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
                      Awaiting approval
                    </Text>
                  </View>
                )}
              </Row>
            </Card>
          ))}
        </>
      )}

      {/* declined invitations — the answer, kept visible */}
      {declined.length > 0 && (
        <>
          <Label asHeading>Declined</Label>
          {declined.map((m) => (
            <Card key={m.id} style={styles.pendingCard}>
              <Row style={styles.contactRow}>
                <Avatar name={m.name} size={44} color={T.inkFaint} />
                <View style={styles.flex}>
                  <Text style={styles.memberName}>{m.name}</Text>
                  <Muted style={styles.memberRel}>
                    {m.relationship ? `${m.relationship} · ` : ''}started a home of
                    their own instead
                    {m.email ? ` · ${m.email}` : ''}
                  </Muted>
                </View>
                {canManageMembers ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${m.name} again`}
                    onPress={() => approveAndSend(m)}
                    style={[styles.actBtn, styles.approveBtn]}
                  >
                    <Text style={styles.approveText}>Ask again</Text>
                  </Pressable>
                ) : null}
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
          <Label asHeading style={styles.inviteLabel}>
            Invite a family member
          </Label>
          <TextInput
            style={styles.input}
            value={inviteName}
            onChangeText={setInviteName}
            placeholder="Name — e.g. Noor"
            placeholderTextColor={T.inkFaint}
            aria-label="Name"
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            style={[styles.input, styles.inputGap]}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="Their email — where the invite is sent"
            placeholderTextColor={T.inkFaint}
            aria-label="Their email"
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
            aria-label="Relationship (optional)"
            returnKeyType="done"
            onSubmitEditing={sendInvite}
          />
          <Muted style={styles.inviteNote}>
            {canManageMembers
              ? 'They join once you approve them here — the email goes out the moment you do.'
              : 'A household organizer approves new members; the email is sent on approval.'}
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
        accessibilityLabel="Settings"
        onPress={() => router.push(SETTINGS_ROUTE)}
        style={styles.settingsBtn}
      >
        <Ionicons name="settings-outline" size={17} color={T.inkSoft} />
        <Text style={styles.settingsText}>Settings</Text>
      </Pressable>

      {/* Quiet demo control. Hidden in the owner view, which now reaches this
          same screen from Settings — "View as the owner" while you ARE the
          owner is a switch to nowhere. */}
      {role !== 'owner' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View as ${ownerName}, the owner`}
          onPress={viewAsOwner}
          style={styles.demoBtn}
        >
          <Ionicons name="swap-horizontal-outline" size={14} color={T.inkFaint} />
          <Text style={styles.demoText}>View as {ownerName} (owner)</Text>
        </Pressable>
      )}
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
  admin = false,
  onManage,
  managing = false,
}: {
  name: string;
  rel: string;
  badge: string;
  badgeKind?: 'owner' | 'helper' | 'invited';
  avatarName?: string;
  /** True when this member holds the final say in the active household. */
  finalSay?: boolean;
  /** True when this member administers the household (people + the record). */
  admin?: boolean;
  /** Opens the manage panel. Given only to administrators, for other people. */
  onManage?: () => void;
  managing?: boolean;
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
      {admin && (
        <View style={[styles.badge, styles.badgeAdmin]}>
          <Ionicons name="shield-checkmark" size={10} color={T.brassDeep} />
          <Text style={[styles.badgeText, styles.badgeAdminText]}>Admin</Text>
        </View>
      )}
      {finalSay && (
        <View style={[styles.badge, styles.badgeFinal]}>
          <Ionicons name="key" size={10} color={T.brassDeep} />
          <Text style={[styles.badgeText, styles.badgeFinalText]}>Final say</Text>
        </View>
      )}
      <View style={[styles.badge, badgeStyle]}>
        <Text style={[styles.badgeText, badgeTextStyle]}>{badge}</Text>
      </View>
      {!!onManage && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Manage ${name}`}
          accessibilityState={{ expanded: managing }}
          onPress={onManage}
          style={({ pressed }) => [styles.manageBtn, pressed && styles.manageBtnPressed]}
        >
          <Ionicons
            name={managing ? 'chevron-up' : 'ellipsis-horizontal'}
            size={16}
            color={T.inkSoft}
          />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strong: { color: T.ink, fontWeight: '700' },

  headerRow: { alignItems: 'flex-end', gap: Spacing.three },
  addFab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: T.brass,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  addFabPressed: { opacity: 0.8 },
  pressed: { opacity: 0.7 },

  newFamilyCard: { marginTop: Spacing.three, backgroundColor: T.sunken },

  familyCard: { marginTop: Spacing.two },
  familyCardOpen: { borderColor: T.brass, backgroundColor: T.sunken },
  familyHead: { alignItems: 'center', gap: Spacing.two },
  familyNote: { marginTop: Spacing.two },
  rosterLabel: { marginTop: Spacing.four },

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
  badgeAdmin: {
    backgroundColor: T.brassTint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeAdminText: { color: T.brassDeep },

  manageBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  manageBtnPressed: { opacity: 0.6 },
  manageWell: { marginTop: Spacing.two, marginBottom: Spacing.two },
  manageNote: { fontSize: 13 },
  manageActions: { gap: Spacing.two, marginTop: Spacing.two, flexWrap: 'wrap' },

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
