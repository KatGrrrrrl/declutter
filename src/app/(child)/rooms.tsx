/**
 * Child rooms — 2-col grid of room cards: serif room name, item count, and
 * mini status chips (undecided / kept / donate). Tap a room to open the
 * inventory filtered to it.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { MiniChip, ROOMS } from '@/components/child/shared';
import { Heading, Label, Muted, Screen, Title } from '@/components/ui';
import { Spacing, T } from '@/constants/theme';
import { useCollections, useStore } from '@/lib/store';

export default function RoomsScreen() {
  const router = useRouter();
  const items = useStore((s) => s.items);
  const collections = useCollections();

  // Canonical rooms first, then any extra rooms items have accumulated.
  const extraRooms = [...new Set(items.map((i) => i.room))].filter(
    (r) => !(ROOMS as readonly string[]).includes(r)
  );
  const rooms = [...ROOMS, ...extraRooms];

  return (
    <Screen>
      <Label>
        {items.length} items · {rooms.length} rooms
      </Label>
      <Title>Rooms</Title>
      <Muted style={styles.sub}>Tap a room to see everything captured in it.</Muted>

      <View style={styles.grid}>
        {rooms.map((room) => {
          const inRoom = items.filter((i) => i.room === room);
          const undecided = inRoom.filter((i) => i.decision === 'undecided').length;
          const kept = inRoom.filter((i) => i.decision === 'keep').length;
          const donate = inRoom.filter((i) => i.decision === 'donate').length;
          return (
            <Pressable
              key={room}
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: '/(child)/inventory', params: { room } })
              }
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <Heading style={styles.roomName}>{room}</Heading>
              <Muted style={styles.count}>
                {inRoom.length === 1 ? '1 item' : `${inRoom.length} items`}
              </Muted>
              <View style={styles.chips}>
                {undecided > 0 && <MiniChip label={`${undecided} undecided`} />}
                {kept > 0 && (
                  <MiniChip label={`${kept} kept`} color={T.keep} tint={T.keepTint} />
                )}
                {donate > 0 && (
                  <MiniChip label={`${donate} donate`} color={T.donate} tint={T.donateTint} />
                )}
                {inRoom.length === 0 && <MiniChip label="Nothing yet" color={T.inkFaint} />}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* collections — sets that cut across rooms (coins, wine, tools…) */}
      {collections.length > 0 && (
        <>
          <Label style={styles.collectionsLabel} asHeading>
            Collections
          </Label>
          <View style={styles.grid}>
            {collections.map((c) => {
              const inSet = items.filter((i) => i.collectionId === c.id && !i.archived);
              const undecided = inSet.filter((i) => i.decision === 'undecided').length;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: '/collection/[id]', params: { id: c.id } })
                  }
                  style={({ pressed }) => [styles.card, styles.collectionCard, pressed && styles.pressed]}
                >
                  <View style={styles.collectionHead}>
                    <Ionicons name="albums-outline" size={15} color={T.brassDeep} />
                    <Heading style={styles.roomName} numberOfLines={1}>
                      {c.name}
                    </Heading>
                  </View>
                  <Muted style={styles.count}>
                    {inSet.length === 1 ? '1 item' : `${inSet.length} items`}
                  </Muted>
                  <View style={styles.chips}>
                    {undecided > 0 && <MiniChip label={`${undecided} undecided`} />}
                    {inSet.length === 0 && <MiniChip label="Nothing yet" color={T.inkFaint} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: Spacing.two },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  card: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 16,
    padding: Spacing.three,
  },
  pressed: { opacity: 0.75 },
  roomName: { fontSize: 17 },
  count: { marginTop: 2, fontSize: 12 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.two,
  },
  collectionsLabel: { marginTop: Spacing.five },
  collectionCard: { borderColor: T.brass, backgroundColor: T.brassTint },
  collectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
