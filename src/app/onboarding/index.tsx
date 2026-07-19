/**
 * Stepped onboarding — one file, internal step state.
 *
 *   welcome → role pick → household (owner) / join (contributor)
 *           → passkey explainer → invite family (owner only) → done
 *
 * Demo scaffolding: no real auth or invites. Finish calls
 * completeOnboarding and lands on / (which redirects by role).
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/child/shared';
import { Body, Btn, Card, CONTENT_MAX, Heading, Label, Muted, Row, Title, Well } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { Role, useStore } from '@/lib/store';

type Step = 'welcome' | 'role' | 'household' | 'join' | 'passkey' | 'invite';

const OWNER_STEPS: Step[] = ['role', 'household', 'passkey', 'invite'];
const CONTRIB_STEPS: Step[] = ['role', 'join', 'passkey'];

const CONTACTS = [
  { name: 'Maya', relationship: 'Daughter' },
  { name: 'Sam', relationship: 'Son' },
  { name: 'Rebecca', relationship: 'Family attorney', color: T.donate },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const completeOnboarding = useStore((s) => s.completeOnboarding);
  const ownerName = useStore((s) => s.ownerName);

  const [step, setStep] = useState<Step>('welcome');
  const [role, setRole] = useState<Role>('owner');
  const [householdName, setHouseholdName] = useState('The Lakehouse');
  const [userName, setUserName] = useState('');
  const [invited, setInvited] = useState<string[]>([]);

  const steps = role === 'owner' ? OWNER_STEPS : CONTRIB_STEPS;
  const stepIndex = steps.indexOf(step);

  const goBack = () => {
    if (step === 'role') setStep('welcome');
    else if (stepIndex > 0) setStep(steps[stepIndex - 1]);
  };

  const pickRole = (r: Role) => {
    setRole(r);
    setUserName((name) => name || (r === 'owner' ? 'Rose' : 'Sam'));
    setStep(r === 'owner' ? 'household' : 'join');
  };

  /**
   * A real sign-up starts with an EMPTY household — no sample items, no sample
   * heirs. The seeded demo content is now opt-in from the welcome screen.
   */
  const finish = () => {
    completeOnboarding({
      role,
      householdName: householdName.trim() || 'The Lakehouse',
      userName: userName.trim() || (role === 'owner' ? 'Rose' : 'Sam'),
      startEmpty: true,
    });
    router.replace('/');
  };

  /** Opt-in tour: keeps the seeded Lakehouse so the app can be explored. */
  const exploreDemo = () => {
    completeOnboarding({
      role: 'owner',
      householdName: 'The Lakehouse',
      userName: 'Rose',
      startEmpty: false,
    });
    router.replace('/');
  };

  /* ---------- welcome ---------- */

  if (step === 'welcome') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Household Legacy</Text>
          <Text style={styles.wordmark}>
            Declutter
            <Text style={styles.wordmarkDot}>.</Text>
          </Text>
          <Text style={styles.lede}>
            The family home holds a lifetime of stories. Let&apos;s go through it
            together — gently, and in your own time.
          </Text>
          <View style={styles.heroCta}>
            <Btn label="Get started" big onPress={() => setStep('role')} />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={exploreDemo}
            style={({ pressed }) => [styles.demoLink, pressed && styles.pressed]}
          >
            <Text style={styles.demoLinkText}>Explore with sample items</Text>
          </Pressable>
          <Muted style={styles.fine}>One household, the whole family. No ads, ever.</Muted>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------- stepped screens ---------- */

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" onPress={goBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={18} color={T.inkSoft} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.dots}>
            {steps.map((s, i) => (
              <View key={s} style={[styles.dot, i <= stepIndex && styles.dotOn]} />
            ))}
          </View>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 'role' && (
            <>
              <Label>Step 1 of {steps.length}</Label>
              <Title style={styles.stepTitle}>Whose home is it?</Title>
              <Muted style={styles.stepSub}>
                This decides who holds the keys — everything else follows from it.
              </Muted>

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}
                onPress={() => pickRole('contributor')}
              >
                <View style={styles.roleIcon}>
                  <Ionicons name="camera-outline" size={22} color={T.brassDeep} />
                </View>
                <View style={styles.flex}>
                  <Heading style={styles.roleTitle}>
                    I&apos;m helping organize a family home
                  </Heading>
                  <Muted style={styles.roleDesc}>
                    I&apos;ll photograph and help sort — the owner makes every decision.
                  </Muted>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}
                onPress={() => pickRole('owner')}
              >
                <View style={styles.roleIcon}>
                  <Ionicons name="home-outline" size={22} color={T.brassDeep} />
                </View>
                <View style={styles.flex}>
                  <Heading style={styles.roleTitle}>It&apos;s my home</Heading>
                  <Muted style={styles.roleDesc}>
                    I decide what&apos;s kept, passed on, and let go — at my own pace.
                  </Muted>
                </View>
              </Pressable>
            </>
          )}

          {step === 'household' && (
            <>
              <Label>Step 2 of {steps.length}</Label>
              <Title style={styles.stepTitle}>Name your household</Title>
              <Muted style={styles.stepSub}>Just something the family will recognize.</Muted>

              <Label>Household name</Label>
              <TextInput
                style={styles.input}
                value={householdName}
                onChangeText={setHouseholdName}
                placeholder="The Lakehouse"
                placeholderTextColor={T.inkFaint}
              />

              <Label>Your name</Label>
              <TextInput
                style={styles.input}
                value={userName}
                onChangeText={setUserName}
                placeholder="Rose"
                placeholderTextColor={T.inkFaint}
              />

              <View style={styles.stepCta}>
                <Btn label="Continue" big onPress={() => setStep('passkey')} />
              </View>
            </>
          )}

          {step === 'join' && (
            <>
              <Label>Step 2 of {steps.length} · Helper</Label>
              <Title style={styles.stepTitle}>Join your family</Title>
              <Muted style={styles.stepSub}>
                Declutter households open by invitation only.
              </Muted>

              <Card style={styles.joinCard}>
                <Row style={styles.joinRow}>
                  <Avatar name={householdName} size={44} />
                  <View style={styles.flex}>
                    <Heading style={styles.roleTitle}>{householdName}</Heading>
                    <Muted>
                      {ownerName} invited you — she approves every member, so nobody
                      wanders in.
                    </Muted>
                  </View>
                  <Ionicons name="checkmark-circle" size={22} color={T.keep} />
                </Row>
              </Card>

              <Label>Your name</Label>
              <TextInput
                style={styles.input}
                value={userName}
                onChangeText={setUserName}
                placeholder="Sam"
                placeholderTextColor={T.inkFaint}
              />

              <View style={styles.stepCta}>
                <Btn label="Accept the invitation" big onPress={() => setStep('passkey')} />
              </View>
            </>
          )}

          {step === 'passkey' && (
            <>
              <Label>
                Step {stepIndex + 1} of {steps.length}
              </Label>
              <Title style={styles.stepTitle}>Your key is your face</Title>

              <View style={styles.glyphWrap}>
                <View style={styles.glyph}>
                  <Ionicons name="scan-outline" size={54} color={T.brassDeep} />
                  <View style={styles.glyphInner}>
                    <Ionicons name="happy-outline" size={26} color={T.brassDeep} />
                  </View>
                </View>
                <Heading style={styles.glyphHeading}>No passwords to remember</Heading>
                <Body style={styles.glyphBody}>
                  Sign in the same way you unlock your phone — a glance or a fingertip.
                  Nothing to write on a sticky note, nothing to forget.
                </Body>
              </View>

              <View style={styles.stepCta}>
                <Btn
                  label="Continue"
                  big
                  onPress={() => (role === 'owner' ? setStep('invite') : finish())}
                />
              </View>
              <Muted style={styles.fine}>
                Prefer a code? A six-digit backup works on shared iPads.
              </Muted>
            </>
          )}

          {step === 'invite' && (
            <>
              <Label>Step {steps.length} of {steps.length}</Label>
              <Title style={styles.stepTitle}>Invite the family</Title>
              <Muted style={styles.stepSub}>
                They can start adding photos the moment they join.
              </Muted>

              {CONTACTS.map((c) => {
                const done = invited.includes(c.name);
                return (
                  <Card key={c.name} style={styles.contactCard}>
                    <Row style={styles.joinRow}>
                      <Avatar name={c.name} size={44} color={c.color ?? T.brass} />
                      <View style={styles.flex}>
                        <Text style={styles.contactName}>{c.name}</Text>
                        <Muted>{c.relationship}</Muted>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        disabled={done}
                        onPress={() => setInvited((v) => [...v, c.name])}
                        style={[styles.inviteBtn, done && styles.inviteBtnDone]}
                      >
                        <Text style={[styles.inviteText, done && styles.inviteTextDone]}>
                          {done ? 'Invited ✓' : 'Invite'}
                        </Text>
                      </Pressable>
                    </Row>
                  </Card>
                );
              })}

              <Well style={styles.note}>
                <Row style={styles.noteRow}>
                  <Ionicons name="lock-closed-outline" size={16} color={T.brass} />
                  <Muted style={styles.flex}>
                    Invitations require your approval as the owner. Change anyone&apos;s
                    role — or remove them — whenever you like.
                  </Muted>
                </Row>
              </Well>

              <View style={styles.stepCta}>
                <Btn label="Open my household" big onPress={finish} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.ground },
  flex: { flex: 1 },

  /* welcome */
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    width: '100%',
    maxWidth: CONTENT_MAX,
    alignSelf: 'center',
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: T.brassDeep,
    marginBottom: Spacing.two,
  },
  wordmark: {
    fontFamily: Fonts?.serif,
    fontSize: 46,
    fontWeight: '600',
    color: T.heading,
  },
  wordmarkDot: { color: T.brass },
  lede: {
    fontFamily: Fonts?.serif,
    fontStyle: 'italic',
    fontSize: 17,
    lineHeight: 26,
    color: T.inkSoft,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  heroCta: { alignSelf: 'stretch', marginTop: Spacing.five },
  demoLink: {
    alignSelf: 'stretch',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  demoLinkText: {
    fontSize: 15,
    fontWeight: '600',
    color: T.brassDeep,
    textDecorationLine: 'underline',
  },
  fine: { textAlign: 'center', marginTop: Spacing.three, fontSize: 11.5 },

  /* stepped chrome */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4 },
  backText: { fontSize: 13, fontWeight: '600', color: T.inkSoft },
  dots: { flexDirection: 'row', gap: 6, paddingRight: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.line },
  dotOn: { backgroundColor: T.brass },

  // Capped + centered so steps (and their buttons) don't stretch on desktop.
  body: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    alignSelf: 'center',
    width: '100%',
    maxWidth: CONTENT_MAX,
  },
  stepTitle: { marginTop: Spacing.one },
  stepSub: { marginBottom: Spacing.two },
  stepCta: { marginTop: Spacing.five },
  pressed: { opacity: 0.75 },

  /* role cards */
  roleCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 18,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: T.brassTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleTitle: { fontSize: 17 },
  roleDesc: { marginTop: 3 },

  /* inputs */
  input: {
    backgroundColor: T.surface,
    borderWidth: 1.5,
    borderColor: T.brass,
    borderRadius: Radius.control,
    paddingVertical: 13,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts?.serif,
    fontSize: 18,
    color: T.ink,
  },

  /* join (contributor) */
  joinCard: { marginTop: Spacing.three },
  joinRow: { gap: Spacing.three },
  contactCard: { marginTop: Spacing.two, padding: Spacing.three },
  contactName: { fontSize: 15, fontWeight: '700', color: T.ink },

  /* passkey */
  glyphWrap: { alignItems: 'center', marginTop: Spacing.four },
  glyph: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: T.brassTint,
    borderWidth: 1,
    borderColor: T.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphInner: { position: 'absolute' },
  glyphHeading: { marginTop: Spacing.three, fontSize: 21 },
  glyphBody: {
    textAlign: 'center',
    color: T.inkSoft,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.two,
  },

  /* invite */
  inviteBtn: {
    borderWidth: 1,
    borderColor: T.brass,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  inviteBtnDone: { borderColor: 'transparent', backgroundColor: T.keepTint },
  inviteText: { fontSize: 12, fontWeight: '700', color: T.brassDeep },
  inviteTextDone: { color: T.keep },
  note: { marginTop: Spacing.three },
  noteRow: { alignItems: 'flex-start', gap: Spacing.two },
});
