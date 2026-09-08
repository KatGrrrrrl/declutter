/**
 * Child rooms — the house, floor by floor. Each room is a card: serif room
 * name, how to find it, item count, and mini status chips (undecided / kept /
 * donate). Tap a room to open the inventory filtered to it.
 *
 * Rooms are the household's own, not a fixed list: any member may add one and
 * fill in its map — which floor it is on and how to find it ("end of the
 * landing, on the left"), which is what a child photographing an unfamiliar
 * house actually needs. Removing a room is an administrator's call, and only
 * ever when it is empty; a room holding items must be emptied first, so
 * nothing the family catalogued can fall out of the record by accident.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MiniChip, notify } from '@/components/child/shared';
import { Btn, Heading, Label, Muted, Screen, Title, Well } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import {
  FLOORS,
  Room,
  isGhostRoom,
  useCollections,
  useIsAdmin,
  useRooms,
  useStore,
} from '@/lib/store';

/** Rooms nobody has placed on a floor yet gather under this heading. */
const UNPLACED = 'Not placed yet';

export default function RoomsScreen() {
  const router = useRouter();
  const items = useStore((s) => s.items);
  const collections = useCollections();
  const rooms = useRooms();
  const isAdmin = useIsAdmin();
  const addRoom = useStore((s) => s.addRoom);
  const updateRoom = useStore((s) => s.updateRoom);
  const removeRoom = useStore((s) => s.removeRoom);

  /** Which room's editor is open — 'new' for the add form, else a room id. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftFloor, setDraftFloor] = useState('');
  const [draftNote, setDraftNote] = useState('');

  const openNew = () => {
    setDraftName('');
    setDraftFloor('');
    setDraftNote('');
    setEditing('new');
  };

  const openEdit = (room: Room) => {
    setDraftName(room.name);
    setDraftFloor(room.floor ?? '');
    setDraftNote(room.locationNote ?? '');
    setEditing(room.id);
  };

  const close = () => setEditing(null);

  const save = () => {
    const name = draftName.trim();
    if (!name) {
      notify('A room needs a name', 'Even "Spare room" is enough to start with.');
      return;
    }
    // A ghost room — one that exists only because an item names it — has no
    // record to update yet, so saving it CREATES the record rather than
    // editing one. That is how a room that arrived on an item from another
    // device gets its place on the map filled in here.
    //
    // A ghost is created under its ORIGINAL name first, so the items already
    // in it stay attached; a rename in the same save is then a real rename on
    // the new record, which carries those items across with it.
    const room = rooms.find((r) => r.id === editing);
    const ghost = room && isGhostRoom(room);
    let res: { ok: boolean; reason?: string; id?: string };
    if (editing === 'new') {
      res = addRoom(name, { floor: draftFloor, locationNote: draftNote });
    } else if (ghost) {
      res = addRoom(room.name, { floor: draftFloor, locationNote: draftNote });
      if (res.ok && res.id && name !== room.name) {
        res = updateRoom(res.id, { name });
      }
    } else {
      res = updateRoom(editing!, { name, floor: draftFloor, locationNote: draftNote });
    }
    if (!res.ok) {
      notify(
        res.reason === 'duplicate' ? 'That room already exists' : 'That name won’t work',
        res.reason === 'duplicate'
          ? `This home already has a ${name}. Open that one instead — two rooms with one name would fight over the same things.`
          : 'Give the room a name and try again.'
      );
      return;
    }
    close();
  };

  const doRemove = (room: Room) => {
    const res = removeRoom(room.id);
    if (!res.ok) {
      notify(
        'Move these things first',
        `${room.name} still holds ${res.count === 1 ? '1 item' : `${res.count} items`}. ` +
          'Move them to another room, then the room can go — nothing the family ' +
          'catalogued should disappear with it.'
      );
      return;
    }
    close();
  };

  // Group by floor, keeping the order useRooms already put them in (FLOORS
  // order, then anything typed, then the unplaced). One pass, no sorting: the
  // selector is the single place that decides room order.
  const byFloor: { floor: string; rooms: Room[] }[] = [];
  rooms.forEach((r) => {
    const floor = r.floor?.trim() || UNPLACED;
    const group = byFloor.find((g) => g.floor === floor);
    if (group) group.rooms.push(r);
    else byFloor.push({ floor, rooms: [r] });
  });
  // Floor headings only earn their space once the family has actually placed
  // something. A brand-new home is just a list of rooms.
  const showFloors = byFloor.some((g) => g.floor !== UNPLACED);

  return (
    <Screen>
      <Label>
        {items.length} items · {rooms.length} rooms
      </Label>
      <Title>Rooms</Title>
      <Muted style={styles.sub}>
        Tap a room to see everything captured in it. Add your own rooms, and note
        where each one is so anyone can find it.
      </Muted>

      {editing === 'new' ? (
        <RoomForm
          heading="Add a room"
          name={draftName}
          floor={draftFloor}
          note={draftNote}
          onName={setDraftName}
          onFloor={setDraftFloor}
          onNote={setDraftNote}
          onSave={save}
          onCancel={close}
        />
      ) : (
        <View style={styles.addRow}>
          <Btn label="Add a room" kind="quiet" onPress={openNew} />
        </View>
      )}

      {byFloor.map((group) => (
        <View key={group.floor}>
          {showFloors && (
            <Label style={styles.floorLabel} asHeading>
              {group.floor}
            </Label>
          )}
          <View style={styles.grid}>
            {group.rooms.map((room) => {
              const inRoom = items.filter((i) => i.room === room.name);
              const undecided = inRoom.filter((i) => i.decision === 'undecided').length;
              const kept = inRoom.filter((i) => i.decision === 'keep').length;
              const donate = inRoom.filter((i) => i.decision === 'donate').length;
              if (editing === room.id) {
                return (
                  <View key={room.id} style={styles.formSlot}>
                    <RoomForm
                      heading={`Edit ${room.name}`}
                      name={draftName}
                      floor={draftFloor}
                      note={draftNote}
                      onName={setDraftName}
                      onFloor={setDraftFloor}
                      onNote={setDraftNote}
                      onSave={save}
                      onCancel={close}
                      onRemove={isAdmin && !isGhostRoom(room) ? () => doRemove(room) : undefined}
                    />
                  </View>
                );
              }
              return (
                <View key={room.id} style={styles.card}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${room.name}`}
                    onPress={() =>
                      router.push({ pathname: '/(child)/inventory', params: { room: room.name } })
                    }
                    style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
                  >
                    <Heading style={styles.roomName}>{room.name}</Heading>
                    {!!room.locationNote && (
                      <Muted style={styles.where} numberOfLines={2}>
                        {room.locationNote}
                      </Muted>
                    )}
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${room.name}`}
                    onPress={() => openEdit(room)}
                    style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
                  >
                    <Ionicons name="create-outline" size={15} color={T.brassDeep} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ))}

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
                  accessibilityLabel={`Open ${c.name}`}
                  onPress={() =>
                    router.push({ pathname: '/collection/[id]', params: { id: c.id } })
                  }
                  style={({ pressed }) => [
                    styles.card,
                    styles.cardBody,
                    styles.collectionCard,
                    pressed && styles.pressed,
                  ]}
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

/**
 * Add/edit form for one room: name, which floor, and how to find it. The floor
 * chips are suggestions rather than a closed list — tapping the chosen one
 * again clears it, and the field underneath takes anything ("Boathouse").
 */
function RoomForm({
  heading,
  name,
  floor,
  note,
  onName,
  onFloor,
  onNote,
  onSave,
  onCancel,
  onRemove,
}: {
  heading: string;
  name: string;
  floor: string;
  note: string;
  onName: (v: string) => void;
  onFloor: (v: string) => void;
  onNote: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  return (
    <Well style={styles.form}>
      <Label asHeading>{heading}</Label>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={onName}
        placeholder="Sun porch"
        placeholderTextColor={T.inkFaint}
        accessibilityLabel="Room name"
        returnKeyType="done"
      />

      <Label style={styles.formLabel}>Which floor</Label>
      <View style={styles.floorChips}>
        {FLOORS.map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityLabel={f}
            onPress={() => onFloor(floor === f ? '' : f)}
            style={[styles.floorChip, floor === f && styles.floorChipOn]}
          >
            <Text style={[styles.floorChipText, floor === f && styles.floorChipTextOn]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={floor}
        onChangeText={onFloor}
        placeholder="…or type another (Boathouse, Barn)"
        placeholderTextColor={T.inkFaint}
        accessibilityLabel="Floor"
        returnKeyType="done"
      />

      <Label style={styles.formLabel}>How to find it</Label>
      <TextInput
        style={[styles.input, styles.noteInput]}
        value={note}
        onChangeText={onNote}
        placeholder="End of the landing, on the left"
        placeholderTextColor={T.inkFaint}
        accessibilityLabel="How to find this room"
        multiline
      />

      <View style={styles.formActions}>
        <Btn label="Save" kind="brass" onPress={onSave} />
        <Btn label="Cancel" kind="quiet" onPress={onCancel} />
      </View>
      {!!onRemove && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove this room`}
          onPress={onRemove}
          style={({ pressed }) => [styles.removeLink, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={15} color={T.toss} />
          <Text style={styles.removeText}>Remove this room</Text>
        </Pressable>
      )}
    </Well>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: Spacing.two },
  addRow: { marginTop: Spacing.two, alignSelf: 'flex-start' },
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
  },
  cardBody: { padding: Spacing.three },
  editBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    padding: 8,
    borderRadius: Radius.pill,
  },
  pressed: { opacity: 0.75 },
  roomName: { fontSize: 17, paddingRight: Spacing.three },
  where: { marginTop: 3, fontSize: 12, fontStyle: 'italic' },
  count: { marginTop: 2, fontSize: 12 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.two,
  },
  floorLabel: { marginTop: Spacing.four },
  formSlot: { flexBasis: '100%' },
  form: { marginTop: Spacing.two },
  formLabel: { marginTop: Spacing.three },
  input: {
    marginTop: Spacing.one,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    color: T.ink,
    fontSize: 15,
  },
  noteInput: { minHeight: 56, textAlignVertical: 'top' },
  floorChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.one },
  floorChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
  },
  floorChipOn: { backgroundColor: T.brassTint, borderColor: T.brass },
  floorChipText: { color: T.inkSoft, fontSize: 13 },
  floorChipTextOn: { color: T.brassDeep, fontWeight: '600' },
  formActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  removeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.three,
    alignSelf: 'flex-start',
  },
  removeText: { color: T.toss, fontSize: 13 },
  collectionsLabel: { marginTop: Spacing.five },
  collectionCard: { borderColor: T.brass, backgroundColor: T.brassTint },
  collectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
