/**
 * Declutter UI kit — small shared primitives matching the mockup's design
 * language: white ground, navy serif headings, brass labels, tinted decision
 * pills, hairline-bordered cards. Screens compose these; keep them dumb.
 */

import { Image } from 'expo-image';
import { PropsWithChildren } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts, Radius, Spacing, T } from '@/constants/theme';

import type { Decision } from '@/lib/store';

/* ---------- layout ---------- */

export function Screen({
  children,
  scroll = true,
  padded = true,
}: PropsWithChildren<{ scroll?: boolean; padded?: boolean }>) {
  const inner = padded ? styles.padded : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[inner, styles.scrollContent]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Row({ style, ...rest }: ViewProps) {
  return <View style={[styles.row, style]} {...rest} />;
}

/* ---------- typography ---------- */

/** Big navy serif screen title. */
export function Title({ style, ...rest }: TextProps) {
  return <Text style={[styles.title, style]} {...rest} />;
}

/** Navy serif for card/item names. */
export function Heading({ style, ...rest }: TextProps) {
  return <Text style={[styles.heading, style]} {...rest} />;
}

/** Brass uppercase section label. */
export function Label({ style, ...rest }: TextProps) {
  return <Text style={[styles.label, style]} {...rest} />;
}

export function Body({ style, ...rest }: TextProps) {
  return <Text style={[styles.body, style]} {...rest} />;
}

export function Muted({ style, ...rest }: TextProps) {
  return <Text style={[styles.muted, style]} {...rest} />;
}

/* ---------- surfaces ---------- */

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

/** Recessed panel (search wells, story panels, toggles). */
export function Well({ style, ...rest }: ViewProps) {
  return <View style={[styles.well, style]} {...rest} />;
}

/* ---------- controls ---------- */

export function Btn({
  label,
  onPress,
  kind = 'primary',
  big = false,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'quiet' | 'brass';
  big?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' && styles.btnPrimary,
        kind === 'brass' && styles.btnBrass,
        kind === 'quiet' && styles.btnQuiet,
        big && styles.btnBig,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          big && styles.btnTextBig,
          kind === 'quiet' && styles.btnTextQuiet,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const DECISION_META: Record<
  Exclude<Decision, 'undecided'>,
  { label: string; color: string; tint: string }
> = {
  keep: { label: 'Keep', color: T.keep, tint: T.keepTint },
  donate: { label: 'Donate', color: T.donate, tint: T.donateTint },
  toss: { label: 'Let go', color: T.toss, tint: T.tossTint },
};

export function DecisionPill({ decision }: { decision: Decision }) {
  if (decision === 'undecided') {
    return (
      <View style={[styles.pill, { backgroundColor: T.sunken }]}>
        <Text style={[styles.pillText, { color: T.inkSoft }]}>Undecided</Text>
      </View>
    );
  }
  const m = DECISION_META[decision];
  return (
    <View style={[styles.pill, { backgroundColor: m.tint }]}>
      <Text style={[styles.pillText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

export function Tag({ children }: { children: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>#{children}</Text>
    </View>
  );
}

/* ---------- photo placeholder ---------- */

/**
 * Renders the item photo when present, else a clean neutral placeholder with
 * the item's initial in serif — matching the mockup's quiet gray photo boxes.
 */
export function PhotoBox({
  title,
  photoUri,
  height = 180,
  radius = 16,
}: {
  title: string;
  photoUri?: string;
  height?: number;
  radius?: number;
}) {
  if (photoUri) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={{ height, borderRadius: radius, backgroundColor: T.sunken }}
        contentFit="cover"
        accessibilityLabel={title}
      />
    );
  }
  return (
    <View style={[styles.photoBox, { height, borderRadius: radius }]}>
      <Text style={styles.photoInitial}>{title.slice(0, 1)}</Text>
    </View>
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.ground },
  flex: { flex: 1 },
  padded: { paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.six },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  title: {
    fontFamily: Fonts?.serif,
    fontSize: 30,
    fontWeight: '600',
    color: T.heading,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  heading: {
    fontFamily: Fonts?.serif,
    fontSize: 19,
    fontWeight: '600',
    color: T.heading,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: T.brassDeep,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  body: { fontSize: 15, lineHeight: 21, color: T.ink },
  muted: { fontSize: 13, lineHeight: 18, color: T.inkSoft },

  card: {
    backgroundColor: T.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: T.line,
    padding: Spacing.three,
  },
  well: {
    backgroundColor: T.sunken,
    borderRadius: Radius.control,
    padding: Spacing.three,
  },

  btn: {
    borderRadius: Radius.control,
    paddingVertical: 12,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: T.heading },
  btnBrass: { backgroundColor: T.brass },
  btnQuiet: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
  },
  btnBig: { paddingVertical: 18, borderRadius: 18 },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  btnTextBig: { fontSize: 17 },
  btnTextQuiet: { color: T.ink },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },

  pill: {
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 12, fontWeight: '700' },

  tag: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: T.line,
    paddingVertical: 3,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  tagText: { fontSize: 12, color: T.inkSoft },

  photoBox: {
    backgroundColor: T.sunken,
    borderWidth: 1,
    borderColor: T.lineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontFamily: Fonts?.serif,
    fontSize: 44,
    color: T.inkFaint,
  },
});

export { DECISION_META };
