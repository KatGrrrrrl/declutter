/**
 * Stepped onboarding — one file, internal step state.
 *
 *   welcome → who'll decide (setup-for pick) → household naming
 *           → final say (pick the decider(s)) → passkey explainer
 *           → invite family → done
 *
 * Anyone can start a family home — the adult child setting things up for a
 * parent, or the owner themselves. The "final say" step designates who rules
 * on every keep/donate/let-go; the finishing role is derived from it: you're
 * an 'owner' if you're among the deciders, otherwise a 'contributor' who set
 * the home up for someone else. (The old join-by-invitation path folded into
 * this — creators now cover the helper case.)
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
import { useStore } from '@/lib/store';

type Step = 'welcome' | 'role' | 'household' | 'deciders' | 'passkey' | 'invite';

const STEPS: Step[] = ['role', 'household', 'deciders', 'passkey', 'invite'];

/** Who is this home being set up for — someone else, or the user's own? */
type SetupFor = 'other' | 'self';

/** A family member added during setup, invited when the household opens. */
interface SetupInvite {
  name: string;
  relationship?: string;
  email: string;
}

const looksLikeEmail = (v: string) => v.includes('@') && v.includes('.');

export default function OnboardingScreen() {
  const router = useRouter();
  const completeOnboarding = useStore((s) => s.completeOnboarding);

  const [step, setStep] = useState<Step>('welcome');
  const [setupFor, setSetupFor] = useState<SetupFor>('self');
  const [householdName, setHouseholdName] = useState('The Lakehouse');
  const [userName, setUserName] = useState('');
  /** Is the user themselves among the deciders? */
  const [includeMe, setIncludeMe] = useState(true);
  /** Deciders other than the user, added by name. */
  const [otherDeciders, setOtherDeciders] = useState<string[]>([]);
  const [deciderInput, setDeciderInput] = useState('');
  const [invites, setInvites] = useState<SetupInvite[]>([]);
  const [inviteName, setInviteName] = useState('');
  const [inviteRel, setInviteRel] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  /** Emails for the auto-invited deciders, keyed by name. */
  const [deciderEmails, setDeciderEmails] = useState<Record<string, string>>({});

  const stepIndex = STEPS.indexOf(step);

  /** What we'd call the user right now, falling back to the path's example. */
  const displayName = userName.trim() || (setupFor === 'self' ? 'Rose' : 'Sam');
  const deciderNames = [...(includeMe ? [displayName] : []), ...otherDeciders];

  const goBack = () => {
    if (step === 'role') setStep('welcome');
    else if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
  };

  const pickPath = (who: SetupFor) => {
    setSetupFor(who);
    // Helpers usually aren't the decider; owners usually are. Both can change
    // their mind on the final-say step.
    setIncludeMe(who === 'self');
    setUserName((name) => name || (who === 'self' ? 'Rose' : 'Sam'));
    setStep('household');
  };

  const addDecider = () => {
    const name = deciderInput.trim();
    if (!name) return;
    if (name === displayName) {
      setIncludeMe(true); // typing your own name is the same as the Me chip
    } else if (!otherDeciders.includes(name)) {
      setOtherDeciders((v) => [...v, name]);
    }
    setDeciderInput('');
  };

  const removeDecider = (name: string) =>
    setOtherDeciders((v) => v.filter((n) => n !== name));

  /**
   * A real sign-up starts with an EMPTY household — no sample items, no sample
   * heirs. The seeded demo content is opt-in from the welcome screen. Role is
   * derived from the final-say choice: among the deciders → owner; setting the
   * home up for someone else → contributor.
   */
  const [inviteError, setInviteError] = useState('');

  const addInvite = () => {
    const name = inviteName.trim();
    const email = inviteEmail.trim().toLowerCase();
    if (!name) return;
    if (!looksLikeEmail(email)) {
      setInviteError('Add their email — the invitation has to reach them somewhere.');
      return;
    }
    setInviteError('');
    const exists =
      invites.some((i) => i.name.toLowerCase() === name.toLowerCase()) ||
      deciderNames.some((d) => d.toLowerCase() === name.toLowerCase()) ||
      name.toLowerCase() === displayName.toLowerCase();
    if (!exists) {
      setInvites((v) => [...v, { name, relationship: inviteRel.trim() || undefined, email }]);
    }
    setInviteName('');
    setInviteRel('');
    setInviteEmail('');
  };

  const removeInvite = (name: string) =>
    setInvites((v) => v.filter((i) => i.name !== name));

  const finish = () => {
    const deciders = deciderNames.length ? deciderNames : [displayName];
    completeOnboarding({
      role: deciders.includes(displayName) ? 'owner' : 'contributor',
      householdName: householdName.trim() || 'The Lakehouse',
      userName: displayName,
      startEmpty: true,
      deciderNames: deciders,
      invites,
      deciderEmails,
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
            {STEPS.map((s, i) => (
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
              <Label>Step 1 of {STEPS.length}</Label>
              <Title style={styles.stepTitle}>Who&apos;ll have the final say?</Title>
              <Muted style={styles.stepSub}>
                Anyone can start a family home. The final say on every item belongs
                to whoever the family names — you&apos;ll choose in a moment.
              </Muted>

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}
                onPress={() => pickPath('other')}
              >
                <View style={styles.roleIcon}>
                  <Ionicons name="people-outline" size={22} color={T.brassDeep} />
                </View>
                <View style={styles.flex}>
                  <Heading style={styles.roleTitle}>
                    I&apos;m setting this up for someone
                  </Heading>
                  <Muted style={styles.roleDesc}>
                    Helping a parent or relative get started — the final say will
                    usually be theirs, not mine.
                  </Muted>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}
                onPress={() => pickPath('self')}
              >
                <View style={styles.roleIcon}>
                  <Ionicons name="home-outline" size={22} color={T.brassDeep} />
                </View>
                <View style={styles.flex}>
                  <Heading style={styles.roleTitle}>It&apos;s my home — I&apos;ll decide</Heading>
                  <Muted style={styles.roleDesc}>
                    I hold the final say on what&apos;s kept, passed on, and let go —
                    at my own pace.
                  </Muted>
                </View>
              </Pressable>
            </>
          )}

          {step === 'household' && (
            <>
              <Label>Step {stepIndex + 1} of {STEPS.length}</Label>
              <Title style={styles.stepTitle}>
                {setupFor === 'other' ? 'Name their home' : 'Name your household'}
              </Title>
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
                placeholder={setupFor === 'self' ? 'Rose' : 'Sam'}
                placeholderTextColor={T.inkFaint}
              />

              <View style={styles.stepCta}>
                <Btn label="Continue" big onPress={() => setStep('deciders')} />
              </View>
            </>
          )}

          {step === 'deciders' && (
            <>
              <Label>Step {stepIndex + 1} of {STEPS.length}</Label>
              <Title style={styles.stepTitle}>Who has the final say?</Title>
              <Muted style={styles.stepSub}>
                Every home needs one voice that settles it — usually Mum or Dad.
                Whoever you name here rules on every keep, donate, and let-go.
                Everyone else helps with photos and notes.
              </Muted>

              <Label>Final say in {householdName.trim() || 'this home'}</Label>

              <View style={styles.chipRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: includeMe }}
                  onPress={() => setIncludeMe((v) => !v)}
                  style={[styles.chip, includeMe && styles.chipOn]}
                >
                  <Ionicons
                    name={includeMe ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={includeMe ? T.brassDeep : T.inkFaint}
                  />
                  <Text style={[styles.chipText, includeMe && styles.chipTextOn]}>
                    Me — {displayName}
                  </Text>
                </Pressable>

                {otherDeciders.map((name) => (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name} from the final say`}
                    onPress={() => removeDecider(name)}
                    style={[styles.chip, styles.chipOn]}
                  >
                    <Text style={[styles.chipText, styles.chipTextOn]}>{name}</Text>
                    <Ionicons name="close-circle" size={18} color={T.brassDeep} />
                  </Pressable>
                ))}
              </View>

              {setupFor === 'other' && (
                <Muted style={styles.deciderHint}>
                  Usually the parent, not the helper — add their name below.
                </Muted>
              )}

              <Row style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={deciderInput}
                  onChangeText={setDeciderInput}
                  onSubmitEditing={addDecider}
                  returnKeyType="done"
                  placeholder="Add a name — e.g. Rose"
                  placeholderTextColor={T.inkFaint}
                  accessibilityLabel="Add someone to the final say"
                />
                <Btn label="Add" onPress={addDecider} />
              </Row>

              <View style={styles.stepCta}>
                <Btn
                  label="Continue"
                  big
                  disabled={deciderNames.length === 0}
                  onPress={() => setStep('passkey')}
                />
              </View>
              <Muted style={styles.fine}>
                {deciderNames.length === 0
                  ? 'Name at least one person to continue.'
                  : 'More than one person can share the final say. You can change this later.'}
              </Muted>
            </>
          )}

          {step === 'passkey' && (
            <>
              <Label>
                Step {stepIndex + 1} of {STEPS.length}
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
                <Btn label="Continue" big onPress={() => setStep('invite')} />
              </View>
              <Muted style={styles.fine}>
                Prefer a code? A six-digit backup works on shared iPads.
              </Muted>
            </>
          )}

          {step === 'invite' && (
            <>
              <Label>Step {STEPS.length} of {STEPS.length}</Label>
              <Title style={styles.stepTitle}>Invite the family</Title>
              <Muted style={styles.stepSub}>
                They can start adding photos the moment they join.
              </Muted>

              {/* The decider(s) named earlier are invited automatically —
                  but the invitation needs their email to reach them. */}
              {deciderNames
                .filter((d) => d.toLowerCase() !== displayName.toLowerCase())
                .map((d) => (
                  <Card key={d} style={styles.contactCard}>
                    <Row style={styles.contactRow}>
                      <Avatar name={d} size={44} color={T.brass} />
                      <View style={styles.flex}>
                        <Text style={styles.contactName}>{d}</Text>
                        <Muted>Final say — invited automatically</Muted>
                      </View>
                      <View style={[styles.inviteBtn, styles.inviteBtnDone]}>
                        <Text style={[styles.inviteText, styles.inviteTextDone]}>
                          Invited ✓
                        </Text>
                      </View>
                    </Row>
                    <TextInput
                      style={[styles.input, styles.deciderEmailInput]}
                      value={deciderEmails[d] ?? ''}
                      onChangeText={(v) => setDeciderEmails((m) => ({ ...m, [d]: v }))}
                      placeholder={`${d}'s email — where their invite is sent`}
                      placeholderTextColor={T.inkFaint}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </Card>
                ))}

              {invites.map((c) => (
                <Card key={c.name} style={styles.contactCard}>
                  <Row style={styles.contactRow}>
                    <Avatar name={c.name} size={44} color={T.donate} />
                    <View style={styles.flex}>
                      <Text style={styles.contactName}>{c.name}</Text>
                      <Muted>
                        {c.relationship ? `${c.relationship} · ` : ''}
                        {c.email}
                      </Muted>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${c.name}`}
                      onPress={() => removeInvite(c.name)}
                      style={styles.inviteBtn}
                    >
                      <Text style={styles.inviteText}>Remove</Text>
                    </Pressable>
                  </Row>
                </Card>
              ))}

              {/* Add anyone by name + email — relationship optional. */}
              <Card style={styles.contactCard}>
                <TextInput
                  style={styles.input}
                  value={inviteName}
                  onChangeText={setInviteName}
                  placeholder="Name — e.g. Maya"
                  placeholderTextColor={T.inkFaint}
                  returnKeyType="next"
                />
                <TextInput
                  style={[styles.input, styles.inviteRelInput]}
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder="Their email — where the invite is sent"
                  placeholderTextColor={T.inkFaint}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                />
                <TextInput
                  style={[styles.input, styles.inviteRelInput]}
                  value={inviteRel}
                  onChangeText={setInviteRel}
                  placeholder="Relationship (optional) — e.g. Daughter"
                  placeholderTextColor={T.inkFaint}
                  returnKeyType="done"
                  onSubmitEditing={addInvite}
                />
                {inviteError ? <Muted style={styles.inviteErr}>{inviteError}</Muted> : null}
                <View style={styles.inviteAddRow}>
                  <Btn label="Add family member" kind="quiet" onPress={addInvite} />
                </View>
              </Card>

              <Well style={styles.note}>
                <Row style={styles.noteRow}>
                  <Ionicons name="lock-closed-outline" size={16} color={T.brass} />
                  <Muted style={styles.flex}>
                    The household opens by invitation only — nobody wanders in.
                    Anyone can suggest a new member later; whoever holds the
                    final say approves them.
                  </Muted>
                </Row>
              </Well>

              <View style={styles.stepCta}>
                <Btn
                  label={setupFor === 'self' ? 'Open my household' : 'Open the household'}
                  big
                  onPress={finish}
                />
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

  /* final say (deciders) */
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: T.line,
    borderRadius: Radius.pill,
    backgroundColor: T.surface,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  chipOn: { borderColor: T.brass, backgroundColor: T.brassTint },
  chipText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
  chipTextOn: { color: T.brassDeep },
  deciderHint: { marginTop: Spacing.two, fontSize: 13.5 },
  addRow: { marginTop: Spacing.three, gap: Spacing.two, alignItems: 'stretch' },

  /* invite */
  contactCard: { marginTop: Spacing.two, padding: Spacing.three },
  contactRow: { gap: Spacing.three },
  contactName: { fontSize: 15, fontWeight: '700', color: T.ink },
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
  inviteRelInput: { marginTop: Spacing.two },
  inviteAddRow: { marginTop: Spacing.three },
  deciderEmailInput: { marginTop: Spacing.two },
  inviteErr: { marginTop: Spacing.two, color: T.toss },
  note: { marginTop: Spacing.three },
  noteRow: { alignItems: 'flex-start', gap: Spacing.two },

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
});
