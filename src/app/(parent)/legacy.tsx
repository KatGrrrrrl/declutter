/**
 * Legacy access — the executor screen. Someone you trust, ready, and locked
 * out until truly needed: a designated executor, the three-step unlock
 * protocol, and reassurance that nothing here is set in stone.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/parent/bits';
import { Card, Label, Muted, Row, Screen, Title, Well } from '@/components/ui';
import { Fonts, Spacing, T } from '@/constants/theme';

const STEPS = [
  {
    title: 'Rebecca requests access',
    body:
      'One button on her side, nothing more. If you are able to respond, ' +
      'you are notified — a false alarm ends right here.',
  },
  {
    title: 'Documentation is reviewed',
    body:
      'A death certificate or incapacity papers are checked before anything ' +
      'opens. No documentation, no unlock.',
  },
  {
    title: 'Read-only unlock',
    body:
      'The inventory and your memorandum open to her exactly as you left ' +
      'them — stories, heirs, and wishes intact.',
  },
];

export default function LegacyScreen() {
  const router = useRouter();

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Export"
        onPress={() => router.back()}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={20} color={T.inkSoft} />
        <Text style={styles.backText}>Export</Text>
      </Pressable>

      <Text style={styles.eyebrow}>When the time comes</Text>
      <Title style={styles.title}>Legacy access</Title>
      <Muted style={styles.sub}>
        Someone you trust, ready — and locked out until truly needed.
      </Muted>

      <Card style={styles.execCard}>
        <Row style={styles.execRow}>
          <Avatar name="Rebecca" size={48} color={T.donate} />
          <View style={styles.execMain}>
            <Text style={styles.execName}>Rebecca</Text>
            <Muted style={styles.execRel}>Family attorney</Muted>
          </View>
          <View style={styles.statusChip}>
            <Text style={styles.statusText}>Designated</Text>
          </View>
        </Row>
      </Card>

      <Label>How unlock works</Label>
      <View>
        {STEPS.map((step, i) => (
          <Row key={step.title} style={styles.step}>
            <View style={styles.stepRail}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              {i < STEPS.length - 1 ? <View style={styles.stepLine} /> : null}
            </View>
            <View style={styles.stepMain}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Muted style={styles.stepBody}>{step.body}</Muted>
            </View>
          </Row>
        ))}
      </View>

      <Well style={styles.note}>
        <Ionicons name="eye-outline" size={18} color={T.brass} style={styles.noteIcon} />
        <Text style={styles.noteText}>
          Rebecca can <Text style={styles.noteStrong}>read, never edit</Text> —
          and you can hand this role to someone else anytime. Nothing here is
          set in stone.
        </Text>
      </Well>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    marginTop: Spacing.two,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingRight: Spacing.three,
  },
  backText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },

  eyebrow: {
    marginTop: Spacing.two,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: T.brassDeep,
  },
  title: { marginTop: 4, marginBottom: 0 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 4, marginBottom: Spacing.three },

  execCard: { marginBottom: Spacing.two },
  execRow: { gap: 13 },
  execMain: { flex: 1, minWidth: 0 },
  execName: { fontSize: 17, fontWeight: '700', color: T.ink },
  execRel: { fontSize: 14, marginTop: 1 },
  statusChip: {
    backgroundColor: T.donateTint,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  statusText: { fontSize: 13, fontWeight: '700', color: T.donate },

  step: { alignItems: 'stretch', gap: 13, paddingVertical: 2 },
  stepRail: { alignItems: 'center', width: 30 },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.brassTint,
    borderWidth: 1,
    borderColor: T.brass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    fontFamily: Fonts?.serif,
    fontSize: 14,
    fontWeight: '700',
    color: T.brassDeep,
  },
  stepLine: { flex: 1, width: 1.5, backgroundColor: T.line, marginVertical: 4 },
  stepMain: { flex: 1, paddingBottom: Spacing.three },
  stepTitle: { fontSize: 16, fontWeight: '700', color: T.ink, marginTop: 4 },
  stepBody: { fontSize: 14, lineHeight: 20, marginTop: 4 },

  note: {
    marginTop: Spacing.three,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  noteIcon: { marginTop: 2 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21, color: T.inkSoft },
  noteStrong: { color: T.ink, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
