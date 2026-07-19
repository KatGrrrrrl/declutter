/**
 * Child inventory — the power list. Search, decision filter chips, optional
 * ?room= filter (from Rooms). Heir info is never shown to contributors:
 * a revealed assignment shows "→ Name"; any other assignment is just a quiet
 * lock glyph — the contributor can see an heir exists, never who.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ItemQuotaMeter } from '@/components/limit-banner';
import { Heading, Label, Muted, PhotoBox, Screen, DecisionPill, Title } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { Decision, useStore } from '@/lib/store';

type Filter = 'all' | Decision;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'keep', label: 'Keep' },
  { key: 'donate', label: 'Donate' },
  { key: 'toss', label: 'Let go' },
  { key: 'undecided', label: 'Undecided' },
];

export default function InventoryScreen() {
  const router = useRouter();
  const { room: roomParam } = useLocalSearchParams<{ room?: string }>();
  const items = useStore((s) => s.items);
  const people = useStore((s) => s.people);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // The ?room= param is the single source of truth for the room filter;
  // clearing the chip clears the param in place via router.setParams.
  const room = roomParam || undefined;

  const q = query.trim().toLowerCase();
  const shown = items.filter((it) => {
    if (filter !== 'all' && it.decision !== filter) return false;
    if (room && it.room !== room) return false;
    if (
      q &&
      !it.title.toLowerCase().includes(q) &&
      !it.room.toLowerCase().includes(q) &&
      !it.tags.some((t) => t.toLowerCase().includes(q))
    ) {
      return false;
    }
    return true;
  });

  return (
    <Screen scroll={false}>
      <Label>
        {items.length} items{room ? ` · ${room}` : ''}
      </Label>
      <Title>Inventory</Title>

      {/* free-plan usage; renders nothing on Pro */}
      <ItemQuotaMeter style={styles.quota} />

      {/* search well */}
      <View style={styles.search}>
        <Ionicons name="search-outline" size={16} color={T.inkFaint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search items, tags, rooms…"
          placeholderTextColor={T.inkFaint}
          autoCorrect={false}
        />
      </View>

      {/* filter chips */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                accessibilityRole="button"
                onPress={() => setFilter(f.key)}
                style={[styles.fchip, filter === f.key && styles.fchipOn]}
              >
                <Text style={[styles.fchipText, filter === f.key && styles.fchipTextOn]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
            {room && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.setParams({ room: '' })}
                style={[styles.fchip, styles.roomChip]}
              >
                <Text style={styles.roomChipText}>{room}</Text>
                <Ionicons name="close" size={13} color={T.brassDeep} />
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>

      {/* rows */}
      <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
        {shown.map((it) => {
          const revealedHeir =
            it.heirPersonId && it.heirVisibility === 'revealed'
              ? people.find((p) => p.id === it.heirPersonId)
              : undefined;
          const hiddenHeir = !!it.heirPersonId && it.heirVisibility !== 'revealed';
          return (
            <Pressable
              key={it.id}
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: '/item/[id]', params: { id: it.id } })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.thumb}>
                <PhotoBox title={it.title} photoUri={it.photoUri} height={56} radius={12} />
              </View>
              <View style={styles.main}>
                <Heading style={styles.rowTitle} numberOfLines={1}>
                  {it.title}
                </Heading>
                <View style={styles.subRow}>
                  <Muted style={styles.roomText}>{it.room}</Muted>
                  {it.tags.map((t) => (
                    <Text key={t} style={styles.tagText}>
                      #{t}
                    </Text>
                  ))}
                </View>
              </View>
              <View style={styles.end}>
                <DecisionPill decision={it.decision} />
                {revealedHeir && (
                  <Text style={styles.heirText}>→ {revealedHeir.displayName}</Text>
                )}
                {hiddenHeir && (
                  <View style={styles.lock}>
                    <Ionicons name="lock-closed-outline" size={11} color={T.inkFaint} />
                    <Text style={styles.lockText}>heir set</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
        {shown.length === 0 && (
          <Muted style={styles.empty}>
            Nothing here yet — try a different filter, or capture a few things first.
          </Muted>
        )}
        <View style={styles.bottomPad} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  quota: { marginTop: Spacing.one, marginBottom: Spacing.two },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: T.sunken,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: Radius.control,
    paddingHorizontal: 13,
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13.5, color: T.ink },

  filters: {
    flexDirection: 'row',
    gap: 7,
    paddingBottom: Spacing.three,
  },
  fchip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  fchipOn: { backgroundColor: T.ink, borderColor: T.ink },
  fchipText: { fontSize: 12, fontWeight: '600', color: T.inkSoft },
  fchipTextOn: { color: T.surface },
  roomChip: { backgroundColor: T.brassTint, borderColor: 'transparent' },
  roomChipText: { fontSize: 12, fontWeight: '600', color: T.brassDeep },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: T.lineSoft,
  },
  pressed: { opacity: 0.7 },
  thumb: { width: 56 },
  main: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15.5 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  roomText: { fontSize: 11.5 },
  tagText: { fontSize: 11.5, color: T.brassDeep },
  end: { alignItems: 'flex-end', gap: 5 },
  heirText: { fontSize: 11, fontWeight: '600', color: T.brassDeep },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lockText: { fontSize: 10, fontWeight: '600', color: T.inkFaint },

  empty: { textAlign: 'center', marginTop: Spacing.five },
  bottomPad: { height: Spacing.six },
});
