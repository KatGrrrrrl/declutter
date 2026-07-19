/**
 * Child family — the household roster, plain about authority: the owner
 * decides everything; contributors help. Includes a pending-request info row,
 * an invite stub (invites need the owner's approval), and a quiet demo
 * control to view the app as the owner.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, notify } from '@/components/child/shared';
import { SETTINGS_ROUTE } from '@/components/settings/routes';
import { Btn, Card, Label, Muted, Row, Screen, Title, Well } from '@/components/ui';
import { Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';

export default function FamilyScreen() {
  const router = useRouter();
  const householdName = useStore((s) => s.householdName);
  const ownerName = useStore((s) => s.ownerName);
  const userName = useStore((s) => s.userName);
  const people = useStore((s) => s.people);
  const items = useStore((s) => s.items);
  const setRole = useStore((s) => s.setRole);

  const pending = items.filter((i) => i.requestedBy);

  // Roster: owner, then you, then other known family (skip your own name),
  // with one "Invited" example so the state is visible in the demo.
  const others = people.filter(
    (p) => p.displayName !== userName && p.displayName !== ownerName
  );
  const invitedExample = others[others.length - 1];
  const activeOthers = others.slice(0, -1);

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
            <Text style={styles.strong}>{ownerName} owns this household.</Text> Every
            keep, donate, and heir choice is hers. You help by adding photos and notes.
          </Muted>
        </Row>
      </Card>

      {/* members */}
      <View style={styles.list}>
        <MemberRow name={ownerName} rel="Owner of the home" badge="Owner" badgeKind="owner" />
        <MemberRow name={`${userName} (you)`} avatarName={userName} rel="Helping organize" badge="Helper" />
        {activeOthers.map((p) => (
          <MemberRow key={p.id} name={p.displayName} rel={p.relationship} badge="Helper" />
        ))}
        {invitedExample && (
          <MemberRow
            name={invitedExample.displayName}
            rel={invitedExample.relationship}
            badge="Invited"
            badgeKind="invited"
          />
        )}
      </View>

      {/* pending request */}
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

      <View style={styles.inviteBtn}>
        <Btn
          label="Invite someone"
          kind="quiet"
          onPress={() =>
            notify(
              'Invites need approval',
              `Invites require ${ownerName}'s approval as the owner. She'll get a note to confirm before anyone joins.`
            )
          }
        />
      </View>

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
}: {
  name: string;
  rel: string;
  badge: string;
  badgeKind?: 'owner' | 'helper' | 'invited';
  avatarName?: string;
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

  list: { marginTop: Spacing.three },
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

  pendingWell: { marginTop: Spacing.three },
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
