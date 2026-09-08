/**
 * Welcome — the first screen a new visitor sees (index route, before any home
 * exists). Three doors out: try the seeded demo, start a real home, or sign in
 * to one already set up. Replaces the old "straight into /onboarding" redirect.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Btn, Label, Muted, Screen, Title } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';

const HERO = require('../../assets/images/welcome-hero.webp');

const STEPS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'camera-outline',
    title: 'They photograph a room',
    body: 'One tap per object — a child or anyone helping can clear a room in an afternoon.',
  },
  {
    icon: 'albums-outline',
    title: 'You decide, from your chair',
    body: 'Keep, donate or let go, one at a time. Your say is final, and you can change your mind.',
  },
  {
    icon: 'mic-outline',
    title: 'You say why it matters',
    body: 'Record the story in your voice, note who a keepsake is for, and export it when you’re ready.',
  },
];

export function Welcome() {
  const router = useRouter();
  const role = useStore((s) => s.role);

  const seeDemo = () =>
    router.push(role === 'owner' ? '/(parent)/decide' : '/(child)/capture');

  return (
    <Screen>
      <Label>Inventory Our Home</Label>

      <View style={styles.heroWrap}>
        <Image
          source={HERO}
          style={styles.heroImg}
          resizeMode="cover"
          accessibilityLabel="A blue-and-white china teapot on a worn kitchen counter."
        />
      </View>

      <Title style={styles.thesis}>
        A house full of things. A few that are really about someone.
      </Title>
      <Muted style={styles.lede}>
        Your children photograph a room. You decide what stays, what goes and
        what it meant — at your pace, with the last word always yours.
      </Muted>

      <View style={styles.cta}>
        <Btn label="See the demo" kind="brass" big onPress={seeDemo} />
        <Btn label="Start a home" kind="primary" big onPress={() => router.push('/onboarding')} />
      </View>
      <Text
        accessibilityRole="button"
        onPress={() => router.push('/login')}
        style={styles.signin}
        suppressHighlighting
      >
        Already set up a home?{'  '}
        <Text style={styles.signinStrong}>Sign in</Text>
      </Text>

      <View style={styles.howHead}>
        <Text style={styles.eyebrow}>How it goes</Text>
        <View style={styles.rule} />
      </View>
      <View style={styles.steps}>
        {STEPS.map((s) => (
          <View key={s.title} style={styles.step}>
            <View style={styles.stepGlyph}>
              <Ionicons name={s.icon} size={18} color={T.brassDeep} />
            </View>
            <View style={styles.stepMain}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Muted style={styles.stepBody}>{s.body}</Muted>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.reassure}>
        <Ionicons name="phone-portrait-outline" size={15} color={T.inkSoft} />
        <Muted style={styles.reassureText}>
          Free and unlimited — on your device, backed up, and shared with your
          family. Pro adds a little AI, from $4.99 a month.
        </Muted>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    width: '100%',
    aspectRatio: 4 / 3,
    maxHeight: 360, // keep the hero from dominating on wide/desktop screens
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: T.sunken,
    marginTop: Spacing.two,
  },
  heroImg: { width: '100%', height: '100%' },
  thesis: { marginTop: Spacing.four, marginBottom: 0 },
  lede: { fontSize: 16, lineHeight: 23, marginTop: Spacing.two },

  cta: { gap: Spacing.two, marginTop: Spacing.four },
  signin: {
    textAlign: 'center',
    marginTop: Spacing.three,
    fontSize: 15,
    color: T.inkSoft,
    paddingVertical: 6,
  },
  signinStrong: { color: T.heading, fontWeight: '700' },

  howHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.six,
    marginBottom: Spacing.three,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: T.brassDeep,
  },
  rule: { flex: 1, height: 1, backgroundColor: T.line },

  steps: { gap: Spacing.three },
  step: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  stepGlyph: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: T.brassTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepMain: { flex: 1, minWidth: 0 },
  stepTitle: {
    fontFamily: Fonts?.serif,
    fontSize: 18,
    fontWeight: '600',
    color: T.heading,
    marginBottom: 2,
  },
  stepBody: { fontSize: 14.5, lineHeight: 20 },

  reassure: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    marginTop: Spacing.five,
    marginBottom: Spacing.four,
  },
  reassureText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
});
