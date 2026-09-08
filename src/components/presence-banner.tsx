/**
 * Inline "someone else is here" strip, shown while another family member has
 * the same household open. Warm and low-key: it reassures that live changes
 * are expected, not alarming. Renders nothing when the viewer is alone.
 */

import { StyleSheet, Text, View } from 'react-native';

import { Spacing, T } from '@/constants/theme';
import { usePresence } from '@/lib/presence';

/** "Tom", "Tom and Rose", "Tom, Rose and 2 others". */
function describe(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? '' : 's'}`;
}

export function PresenceBanner() {
  const others = usePresence((s) => s.others);
  if (!others.length) return null;
  const who = describe(others.map((p) => p.name));
  const verb = others.length === 1 ? 'is' : 'are';
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={styles.strip}
    >
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={2}>
        <Text style={styles.who}>{who}</Text> {verb} here too — changes you make show up
        for each other right away.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: Spacing.four,
    backgroundColor: T.brassTint,
    borderBottomWidth: 1,
    borderBottomColor: T.brass,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: T.keep },
  text: { flex: 1, fontSize: 13.5, lineHeight: 18, color: T.inkSoft },
  who: { fontWeight: '700', color: T.brassDeep },
});
