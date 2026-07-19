/**
 * Shared bits for the child (contributor) screens: canonical room list,
 * initials avatar, mini status chips, and a cross-platform alert.
 * Child-mode only — foundation primitives live in components/ui.tsx.
 */

import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, T } from '@/constants/theme';

/** Canonical capture rooms; inventory may contain others added over time. */
export const ROOMS = [
  'Kitchen',
  'Living room',
  'Bedroom',
  'Study',
  'Garage',
] as const;

/** Alert that also works on web (RN's Alert is a no-op there). */
export function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

/** Round initials avatar, brass by default. */
export function Avatar({
  name,
  size = 44,
  color = T.brass,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** Small tinted count chip, e.g. "3 undecided" on a room card. */
export function MiniChip({
  label,
  color = T.inkSoft,
  tint = T.sunken,
}: {
  label: string;
  color?: string;
  tint?: string;
}) {
  return (
    <View style={[styles.miniChip, { backgroundColor: tint }]}>
      <Text style={[styles.miniChipText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontFamily: Fonts?.serif,
    fontWeight: '700',
  },
  miniChip: {
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  miniChipText: { fontSize: 11, fontWeight: '600' },
});
