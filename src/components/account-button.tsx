/**
 * AccountButton — a compact, discoverable route into Settings (where the
 * prominent Log out lives) from a screen's header. The desktop rail already
 * carries Account & settings + Log out; on mobile the bottom tab bar can't, so
 * the primary per-role landing screens (Capture, Decide) surface this instead.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { SETTINGS_ROUTE } from '@/components/settings/routes';
import { T } from '@/constants/theme';

export function AccountButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Account and settings"
      onPress={() => router.push(SETTINGS_ROUTE)}
      style={({ pressed }) => [styles.btn, compact && styles.btnCompact, pressed && styles.pressed]}
      hitSlop={6}
    >
      <Ionicons name="person-circle-outline" size={compact ? 22 : 19} color={T.inkSoft} />
      {!compact && <Text style={styles.label}>Account</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
  },
  btnCompact: { paddingHorizontal: 0, width: 40, justifyContent: 'center', borderColor: 'transparent', backgroundColor: 'transparent' },
  label: { fontSize: 13.5, fontWeight: '700', color: T.inkSoft },
  pressed: { opacity: 0.7 },
});
