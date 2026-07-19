/**
 * Small shared pieces for the parent (owner) screens: heir avatars, the
 * heir-visibility vocabulary, and duration formatting. Kept tiny on purpose —
 * real primitives live in src/components/ui.tsx.
 */

import { Ionicons } from '@expo/vector-icons';
import { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, T } from '@/constants/theme';

import type { HeirVisibility } from '@/lib/store';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Brass-tinted initial circle for heirs, matching the mockup's `.av-lg`. */
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
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>
        {name.trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** Owner-facing vocabulary for per-item heir visibility. Warm, never morbid. */
export const VISIBILITY_META: Record<
  HeirVisibility,
  { label: string; hint: string; icon: IconName }
> = {
  owner_only: {
    label: 'Only me',
    hint: 'nobody else sees this yet',
    icon: 'lock-closed-outline',
  },
  after_death: {
    label: "After I'm gone",
    hint: 'unlocks for your executor',
    icon: 'time-outline',
  },
  revealed: {
    label: 'Revealed',
    hint: "they'll be notified",
    icon: 'eye-outline',
  },
};

/** 34 → "0:34", 95 → "1:35". */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts?.serif,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
