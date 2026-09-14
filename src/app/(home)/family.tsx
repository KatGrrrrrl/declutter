/**
 * Family — every home on this device, one card each, and the people of the
 * home that is open.
 *
 * Who is in a home, who has the final say and who administers it now come
 * from the database membership (src/lib/membership.ts), not from a roster the
 * device kept by name. That roster could claim someone had joined who never
 * signed in, and its "decider" and "admin" flags were writable by any member.
 *
 * - Owners and administrators invite people (the invite-member function
 *   creates the invitation and sends the email together). Only someone with
 *   the final say can give it to someone else.
 * - Administrators remove people and grant administrator standing; the
 *   database keeps at least one owner and one administrator, and says so.
 * - Whoever set a home up holds the final say until the person it's for
 *   joins; then they can hand it over from their own row.
 * - Every change reports back: a refusal is shown, never swallowed.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, notify } from '@/components/child/shared';
import { SETTINGS_ROUTE } from '@/components/settings/routes';
import { Btn, Card, Heading, Label, Muted, Row, Screen, Title, Well } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { useSession } from '@/lib/auth';
import { createHousehold, uploadLocalHousehold } from '@/lib/household';
import {
  inviteToHousehold,
  memberName,
  removeFromHousehold,
  setAdministrator,
  setMemberRole,
  useCanDecide,
  useHouseholdMembers,
  useIsAdmin,
  useLoadHouseholdMembers,
  useMyMemberships,
  type HouseholdMember,
} from '@/lib/membership';
import { useStore } from '@/lib/store';

/** The sample family, shown read-only in the demo (it has no accounts). */
const DEMO_PEOPLE = [
  { name: 'Rose', rel: 'Mum', finalSay: true, admin: false },
  { name: 'Sam', rel: 'Son · set up the home', finalSay: false, admin: true },
  { name: 'Maya', rel: 'Daughter', finalSay: false, admin: false },
];

const decides = (m: Pick<HouseholdMember, 'role'>) => m.role === 'owner' || m.role === 'co_owner';

export default function FamilyScreen() {
  const router = useRouter();
  const householdName = useStore((s) => s.householdName);
  const items = useStore((s) => s.items);
  const households = useStore((s) => s.households);
  const activeHouseholdId = useStore((s) => s.activeHouseholdId);
  const switchHousehold = useStore((s) => s.switchHousehold);
  const isDemo = useStore((s) => s.isDemo);
  const demoRole = useStore((s) => s.demoRole);
  const setDemoRole = useStore((s) => s.setDemoRole);
  const userName = useStore((s) => s.userName);
  const { userId: myUserId, status } = useSession();
  const canDecide = useCanDecide();
  const isAdmin = useIsAdmin();
  const myMemberships = useMyMemberships();
  useLoadHouseholdMembers();
  const members = useHouseholdMembers();

  const openHousehold = households.find((h) => h.id === activeHouseholdId);
  const shared = Boolean(openHousehold?.cloudLinkedAt) && !isDemo;
  const canInvite = shared && (canDecide || isAdmin);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteRel, setInviteRel] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFinalSay, setInviteFinalSay] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Which member's manage panel is open, and whether it is on the confirm step. */
  const [managing, setManaging] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const [addingFamily, setAddingFamily] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');

  const active = members.filter((m) => m.status === 'active');
  const invited = members.filter((m) => m.status === 'invited');
  // People who were asked and said no. Listed rather than dropped: an
  // invitation that simply stops appearing is indistinguishable from one that
  // was never sent, and the family is owed the answer they waited for.
  const declined = members.filter((m) => m.status === 'revoked' && m.declinedAt);
  const activeDeciders = active.filter(decides);
  const deciderLabels = isDemo ? ['Rose'] : activeDeciders.map(memberName);
  const pending = items.filter((i) => i.requestedBy);

  const closeNewFamily = () => {
    setAddingFamily(false);
    setNewFamilyName('');
  };

  /** Another family home: created in the account first, then opened here. */
  const saveFamily = async () => {
    const name = newFamilyName.trim();
    if (!name) return;
    if (status !== 'signed-in') {
      notify('Sign in to add a home', 'Homes live in your account so family can join them.');
      return;
    }
    setBusy(true);
    const res = await createHousehold(name, { displayName: userName });
    setBusy(false);
    if (!res.ok) {
      notify('Couldn’t add that home', res.error);
      return;
    }
    closeNewFamily();
    notify('Family added', `${name} is open now. Invite the people who belong there below.`);
  };

  const sendInvite = async () => {
    const name = inviteName.trim();
    const email = inviteEmail.trim().toLowerCase();
    if (!name) return;
    if (!email.includes('@') || !email.includes('.')) {
      notify('An email is needed', 'The invitation has to reach them somewhere — add their email address.');
      return;
    }
    setBusy(true);
    const res = await inviteToHousehold({
      email,
      name,
      relationship: inviteRel.trim() || undefined,
      role: inviteFinalSay && canDecide ? 'co_owner' : 'contributor',
    });
    setBusy(false);
    if (!res.ok) {
      notify('The invitation didn’t go', res.error);
      return;
    }
    notify(
      res.alreadyMember ? `${name} is already here` : 'Invitation sent',
      res.alreadyMember
        ? `${name} has already joined ${householdName}.`
        : res.alreadyRegistered
          ? `${name} already has an account — the invitation will be waiting when they next sign in.`
          : `${name} will get an email at ${email}. Once they sign in, ${householdName} will be waiting for them.`
    );
    setInviteName('');
    setInviteRel('');
    setInviteEmail('');
    setInviteFinalSay(false);
    setInviteOpen(false);
  };

  /** Send an invitation again — the same person, the same standing. */
  const askAgain = async (m: HouseholdMember) => {
    if (!m.email) return;
    setBusy(true);
    const res = await inviteToHousehold({
      email: m.email,
      name: m.displayName ?? undefined,
      relationship: m.relationship ?? undefined,
      role: decides(m) && canDecide ? 'co_owner' : 'contributor',
    });
    setBusy(false);
    if (res.ok) notify('Invitation sent again', `${memberName(m)} will find it when they sign in.`);
    else notify('The invitation didn’t go', res.error);
  };

  const withdraw = async (m: HouseholdMember) => {
    const res = await removeFromHousehold(m.id);
    if (res.ok) notify('Invitation withdrawn', `${memberName(m)} can’t join ${householdName} with it any more.`);
    else notify('Couldn’t withdraw it', res.error);
  };

  const doRemoveMember = async (m: HouseholdMember) => {
    setConfirmRemove(null);
    setManaging(null);
    const res = await removeFromHousehold(m.id);
    if (res.ok) {
      notify(
        `${memberName(m)} was removed`,
        `They no longer have access to ${householdName}. Everything they added stays in the record — removing a person doesn't remove what they catalogued.`
      );
    } else {
      notify('They weren’t removed', res.error);
    }
  };

  const toggleAdmin = async (m: HouseholdMember) => {
    const res = await setAdministrator(m.id, !m.isAdmin);
    if (!res.ok) notify('That didn’t change', res.error);
  };

  const toggleFinalSay = async (m: HouseholdMember) => {
    const res = await setMemberRole(m.id, decides(m) ? 'contributor' : 'co_owner');
    if (!res.ok) notify('That didn’t change', res.error);
  };

  /** The person who set the home up hands the final say to someone who has joined. */
  const handOver = async (me: HouseholdMember) => {
    const res = await setMemberRole(me.id, 'contributor');
    if (res.ok) {
      notify('You’ve handed over the final say', `${deciderLabels.filter((n) => n !== memberName(me)).join(' and ')} decides now. You can still add and help.`);
      router.replace('/');
    } else {
      notify('That didn’t change', res.error);
    }
  };

  const shareThisHome = async () => {
    if (!openHousehold) return;
    setBusy(true);
    const res = await uploadLocalHousehold(openHousehold.id);
    setBusy(false);
    if (res.ok) notify('Shared', `${openHousehold.name} is in your account now — invite the family below.`);
    else notify('Couldn’t share this home yet', res.error);
  };

  const standingLabel = (hid: string, linked: boolean) => {
    if (isDemo) return 'Rose has the final say · Sam set it up';
    if (!linked) return 'Only on this device';
    const m = myMemberships[hid];
    if (!m) return 'Shared with the family';
    return [m.role === 'owner' || m.role === 'co_owner' ? 'You have the final say' : 'You help here', m.isAdmin ? 'you administer it' : null]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <Screen>
      <Row style={styles.headerRow}>
        <View style={styles.flex}>
          <Label>{householdName}</Label>
          <Title>Family</Title>
        </View>
        {/* Big "+" — starts another family home. */}
        {!isDemo && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addingFamily ? 'Close the new family form' : 'Add a new family home'}
            accessibilityState={{ expanded: addingFamily }}
            onPress={() => (addingFamily ? closeNewFamily() : setAddingFamily(true))}
            style={({ pressed }) => [styles.addFab, pressed && styles.addFabPressed]}
          >
            <Ionicons name={addingFamily ? 'close' : 'add'} size={36} color={T.surface} />
          </Pressable>
        )}
      </Row>

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
            returnKeyType="done"
            onSubmitEditing={() => void saveFamily()}
          />
          <Muted style={styles.inviteNote}>
            You&rsquo;ll start with the final say there. Invite whoever should decide,
            and hand it over once they join.
          </Muted>
          <Row style={styles.inviteActions}>
            <View style={styles.flex}>
              <Btn label={busy ? 'Adding…' : 'Add family'} onPress={() => void saveFamily()} disabled={busy} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={closeNewFamily} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </Row>
        </Card>
      )}

      {/* families — one card each */}
      <Label asHeading>Your families</Label>
      {households.map((h) => {
        const open = h.id === activeHouseholdId;
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
                  <Text style={[styles.badgeText, open ? styles.badgeOwnerText : styles.badgeHelperText]}>
                    {open ? 'Open' : 'Tap to open'}
                  </Text>
                </View>
              </Row>
              {open && deciderLabels.length > 0 && (
                <Row style={[styles.authorityRow, styles.familyNote]}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={T.brass} />
                  <Muted style={styles.flex}>
                    <Text style={styles.strong}>
                      {deciderLabels.join(' and ')} {deciderLabels.length === 1 ? 'holds' : 'hold'} the final say here.
                    </Text>{' '}
                    Every keep, donate, and heir choice is theirs. Everyone else helps by adding photos and notes.
                  </Muted>
                </Row>
              )}
              <Row style={styles.govRow}>
                <Ionicons name="key-outline" size={15} color={T.brass} />
                <Muted style={styles.govText}>{standingLabel(h.id, Boolean(h.cloudLinkedAt))}</Muted>
              </Row>
            </Card>
          </Pressable>
        );
      })}

      <Label asHeading style={styles.rosterLabel}>
        People at {householdName}
      </Label>

      {isDemo ? (
        <View style={styles.list}>
          {DEMO_PEOPLE.map((p) => (
            <MemberRow
              key={p.name}
              name={p.name}
              rel={p.rel}
              badge={p.finalSay ? 'Owner' : 'Helper'}
              badgeKind={p.finalSay ? 'owner' : 'helper'}
              finalSay={p.finalSay}
              admin={p.admin}
            />
          ))}
          <Muted style={styles.inviteNote}>A sample family. Start your own home to invite real people.</Muted>
        </View>
      ) : !shared ? (
        <Well style={styles.pendingWell}>
          <Muted>
            {openHousehold?.name ?? 'This home'} is only on this device. Share it with your account to
            invite family.
          </Muted>
          {status === 'signed-in' ? (
            <View style={styles.inviteBtn}>
              <Btn label={busy ? 'Sharing…' : 'Share this home'} onPress={() => void shareThisHome()} disabled={busy} />
            </View>
          ) : null}
        </Well>
      ) : (
        <View style={styles.list}>
          {active.map((m) => {
            const isMe = m.userId === myUserId;
            const open = managing === m.id;
            const otherDecidersJoined = activeDeciders.some((d) => d.id !== m.id);
            // Administrators manage everyone but themselves; a decider may hand
            // over their own final say once someone else can hold it.
            const canManageThis = !isMe && isAdmin;
            const canHandOver = isMe && decides(m) && otherDecidersJoined;
            return (
              <View key={m.id}>
                <MemberRow
                  name={isMe ? `${memberName(m)} (you)` : memberName(m)}
                  avatarName={memberName(m)}
                  rel={m.relationship ?? (decides(m) ? 'Final say' : 'Family')}
                  badge={decides(m) ? 'Owner' : 'Helper'}
                  badgeKind={decides(m) ? 'owner' : 'helper'}
                  finalSay={decides(m)}
                  admin={m.isAdmin}
                  onManage={
                    canManageThis || canHandOver
                      ? () => {
                          setConfirmRemove(null);
                          setManaging(open ? null : m.id);
                        }
                      : undefined
                  }
                  managing={open}
                />
                {open && canHandOver && (
                  <Well style={styles.manageWell}>
                    <Muted style={styles.manageNote}>
                      Someone else now has the final say too. If this home is theirs to decide, you can step back to
                      helping — you&rsquo;ll still add photos, stories and notes.
                    </Muted>
                    <Row style={styles.manageActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Hand over the final say"
                        onPress={() => void handOver(m)}
                        style={[styles.actBtn, styles.approveBtn]}
                      >
                        <Text style={styles.approveText}>Hand over the final say</Text>
                      </Pressable>
                    </Row>
                  </Well>
                )}
                {open && canManageThis && (
                  <Well style={styles.manageWell}>
                    <Muted style={styles.manageNote}>
                      {m.isAdmin
                        ? `${memberName(m)} can manage this home — add and remove people, and remove items from the record.`
                        : `${memberName(m)} helps here. Administrators can also manage people and remove items.`}
                    </Muted>
                    <Row style={styles.manageActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          m.isAdmin ? `Remove ${memberName(m)} as an administrator` : `Make ${memberName(m)} an administrator`
                        }
                        onPress={() => void toggleAdmin(m)}
                        style={[styles.actBtn, styles.approveBtn]}
                      >
                        <Text style={styles.approveText}>{m.isAdmin ? 'Not an administrator' : 'Make administrator'}</Text>
                      </Pressable>
                      {canDecide && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            decides(m) ? `Take the final say from ${memberName(m)}` : `Give ${memberName(m)} the final say`
                          }
                          onPress={() => void toggleFinalSay(m)}
                          style={[styles.actBtn, styles.approveBtn]}
                        >
                          <Text style={styles.approveText}>{decides(m) ? 'Remove final say' : 'Give final say'}</Text>
                        </Pressable>
                      )}
                      {confirmRemove === m.id ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Yes, remove ${memberName(m)} from this home`}
                          onPress={() => void doRemoveMember(m)}
                          style={[styles.actBtn, styles.declineBtn]}
                        >
                          <Text style={styles.declineText}>Yes — remove them</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${memberName(m)} from this home`}
                          onPress={() => setConfirmRemove(m.id)}
                          style={[styles.actBtn, styles.declineBtn]}
                        >
                          <Text style={styles.declineText}>Remove from home</Text>
                        </Pressable>
                      )}
                    </Row>
                    {confirmRemove === m.id && (
                      <Muted style={styles.manageNote}>
                        {memberName(m)} loses access to {householdName}. Everything they added stays — the photos, the
                        stories, the record.
                      </Muted>
                    )}
                  </Well>
                )}
              </View>
            );
          })}
        </View>
      )}

      {shared && invited.length > 0 && (
        <>
          <Label asHeading>Waiting to join</Label>
          {invited.map((m) => (
            <Card key={m.id} style={styles.pendingCard}>
              <Row style={styles.contactRow}>
                <Avatar name={memberName(m)} size={44} color={T.inkFaint} />
                <View style={styles.flex}>
                  <Text style={styles.memberName}>{memberName(m)}</Text>
                  <Muted style={styles.memberRel}>
                    {[m.relationship, decides(m) ? 'will have the final say' : 'will help', m.email].filter(Boolean).join(' · ')}
                  </Muted>
                </View>
                {canInvite ? (
                  <Row style={styles.approveRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${memberName(m)}'s invitation again`}
                      onPress={() => void askAgain(m)}
                      style={[styles.actBtn, styles.approveBtn]}
                    >
                      <Text style={styles.approveText}>Resend</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Withdraw ${memberName(m)}'s invitation`}
                      onPress={() => void withdraw(m)}
                      style={[styles.actBtn, styles.declineBtn]}
                    >
                      <Text style={styles.declineText}>Withdraw</Text>
                    </Pressable>
                  </Row>
                ) : (
                  <View style={[styles.badge, styles.badgeInvited]}>
                    <Text style={[styles.badgeText, styles.badgeInvitedText]}>Invited</Text>
                  </View>
                )}
              </Row>
            </Card>
          ))}
        </>
      )}

      {shared && declined.length > 0 && (
        <>
          <Label asHeading>Declined</Label>
          {declined.map((m) => (
            <Card key={m.id} style={styles.pendingCard}>
              <Row style={styles.contactRow}>
                <Avatar name={memberName(m)} size={44} color={T.inkFaint} />
                <View style={styles.flex}>
                  <Text style={styles.memberName}>{memberName(m)}</Text>
                  <Muted style={styles.memberRel}>
                    {[m.relationship, 'said no to the invitation', m.email].filter(Boolean).join(' · ')}
                  </Muted>
                </View>
                {canInvite && m.email ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${memberName(m)} again`}
                    onPress={() => void askAgain(m)}
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

      {pending.length > 0 && (
        <Well style={styles.pendingWell}>
          <Row style={styles.authorityRow}>
            <Ionicons name="hand-left-outline" size={18} color={T.donate} />
            <Muted style={styles.flex}>
              <Text style={styles.strong}>
                {pending.length === 1 ? 'Request pending' : `${pending.length} requests pending`}.
              </Text>{' '}
              Only {deciderLabels.join(' and ') || 'whoever has the final say'} sees who asked — siblings never see
              each other&apos;s requests.
            </Muted>
          </Row>
        </Well>
      )}

      {canInvite ? (
        inviteOpen ? (
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
              onSubmitEditing={() => void sendInvite()}
            />
            {canDecide && (
              <Pressable
                role="checkbox"
                aria-checked={inviteFinalSay}
                accessibilityLabel="They'll have the final say"
                onPress={() => setInviteFinalSay((v) => !v)}
                style={styles.checkRow}
              >
                <Ionicons
                  name={inviteFinalSay ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={inviteFinalSay ? T.brassDeep : T.inkSoft}
                />
                <Text style={styles.checkText}>They&rsquo;ll have the final say</Text>
              </Pressable>
            )}
            <Muted style={styles.inviteNote}>
              The email goes out now. They join when they sign in with that address.
            </Muted>
            <Row style={styles.inviteActions}>
              <View style={styles.flex}>
                <Btn label={busy ? 'Sending…' : 'Send invitation'} onPress={() => void sendInvite()} disabled={busy} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
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
        )
      ) : shared ? (
        <Muted style={styles.inviteNote}>
          To bring someone else in, ask whoever has the final say or administers {householdName}.
        </Muted>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={() => router.push(SETTINGS_ROUTE)}
        style={styles.settingsBtn}
      >
        <Ionicons name="settings-outline" size={17} color={T.inkSoft} />
        <Text style={styles.settingsText}>Settings</Text>
      </Pressable>

      {/* Demo only: switch the sample home to Rose's view. */}
      {isDemo && demoRole !== 'owner' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View as Rose, the owner"
          onPress={() => {
            setDemoRole('owner');
            router.replace('/');
          }}
          style={styles.demoBtn}
        >
          <Ionicons name="swap-horizontal-outline" size={14} color={T.inkFaint} />
          <Text style={styles.demoText}>View as Rose (owner)</Text>
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

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, marginTop: Spacing.two },
  checkText: { fontSize: 15, color: T.ink },
});
