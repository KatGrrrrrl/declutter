/**
 * Collection detail — the home of one named set ("Coin collection"). Shows the
 * member items as a photo grid, the set's counts (and value, deciders only),
 * rename/note editing, "Add items" (jumps into capture with the collection
 * pinned), and delete — which un-groups the items, never deletes them.
 *
 * Any member may create/rename/delete collections and file items (like rooms);
 * decisions stay with the deciders.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MiniChip } from '@/components/child/shared';
import { Btn, DECISION_META, Heading, Label, Muted, PhotoBox, Row, Screen, Title } from '@/components/ui';
import { Fonts, Spacing, T } from '@/constants/theme';
import { useCanDecide, useCollection, useCollectionItems, useStore } from '@/lib/store';

export default function CollectionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const collection = useCollection(id);
  const items = useCollectionItems(id ?? '');
  const role = useStore((s) => s.role);
  const updateCollection = useStore((s) => s.updateCollection);
  const removeCollection = useStore((s) => s.removeCollection);
  const canDecide = useCanDecide();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!collection) {
    return (
      <Screen>
        <Title>Collection</Title>
        <Muted style={styles.gone}>
          This collection isn&rsquo;t here any more — its items are still in the inventory.
        </Muted>
        <Btn label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const undecided = items.filter((i) => i.decision === 'undecided').length;
  const kept = items.filter((i) => i.decision === 'keep').length;
  const donate = items.filter((i) => i.decision === 'donate').length;
  const value = items.reduce((sum, i) => sum + (i.marketValue ?? 0), 0);
  const valued = items.filter((i) => i.marketValue != null).length;

  const startEdit = () => {
    setEditName(collection.name);
    setEditNote(collection.note ?? '');
    setEditing(true);
  };

  const saveEdit = () => {
    updateCollection(collection.id, {
      name: editName.trim() || collection.name,
      note: editNote.trim(),
    });
    setEditing(false);
  };

  const addItems = () => {
    // One capture screen, two tab groups — land in the viewer's own.
    router.push({
      pathname: role === 'owner' ? '/(parent)/capture' : '/(child)/capture',
      params: { collectionId: collection.id },
    });
  };

  const doDelete = () => {
    removeCollection(collection.id);
    router.back();
  };

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        style={styles.back}
      >
        <Ionicons name="arrow-back" size={20} color={T.ink} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      {editing ? (
        <View style={styles.editBox}>
          <Label style={styles.editLabel}>Collection name</Label>
          <TextInput
            style={styles.editInput}
            value={editName}
            onChangeText={setEditName}
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={saveEdit}
          />
          <Label>A note, if it helps</Label>
          <TextInput
            style={[styles.editInput, styles.editNote]}
            value={editNote}
            onChangeText={setEditNote}
            placeholder="e.g. Dad's coins — the folder with the papers is in the study"
            placeholderTextColor={T.inkFaint}
            multiline
          />
          <Row style={styles.editActions}>
            <View style={styles.flexOne}>
              <Btn label="Save" onPress={saveEdit} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing(false)}
              style={styles.editCancel}
            >
              <Text style={styles.editCancelText}>Cancel</Text>
            </Pressable>
          </Row>
        </View>
      ) : (
        <>
          <Label>
            {items.length} item{items.length === 1 ? '' : 's'}
            {canDecide && valued > 0 ? ` · $${value.toLocaleString()} documented` : ''}
          </Label>
          <Row style={styles.titleRow}>
            <Title style={styles.flexOne}>{collection.name}</Title>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rename this collection"
              onPress={startEdit}
              style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            >
              <Ionicons name="pencil-outline" size={17} color={T.inkSoft} />
            </Pressable>
          </Row>
          {collection.note ? <Muted style={styles.note}>{collection.note}</Muted> : null}
        </>
      )}

      <Row style={styles.chips}>
        {undecided > 0 && <MiniChip label={`${undecided} undecided`} />}
        {kept > 0 && <MiniChip label={`${kept} kept`} color={T.keep} tint={T.keepTint} />}
        {donate > 0 && <MiniChip label={`${donate} donate`} color={T.donate} tint={T.donateTint} />}
        {items.length === 0 && <MiniChip label="Nothing filed yet" color={T.inkFaint} />}
      </Row>

      <Btn label="Add items to this collection" big onPress={addItems} />

      <View style={styles.grid}>
        {items.map((it) => (
          <Pressable
            key={it.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${it.title}`}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: it.id } })}
            style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
          >
            <PhotoBox
              title={it.title}
              photoUri={it.photoUri}
              remotePath={it.remotePhotoPath}
              height={110}
              radius={12}
            />
            <Heading style={styles.cellTitle} numberOfLines={1}>
              {it.title}
            </Heading>
            <Muted style={styles.cellSub} numberOfLines={1}>
              {it.decision === 'undecided' ? 'Undecided' : DECISION_META[it.decision].label}
              {it.marketValue != null && canDecide ? ` · $${it.marketValue.toLocaleString()}` : ''}
            </Muted>
          </Pressable>
        ))}
      </View>
      {items.length === 0 && (
        <Muted style={styles.empty}>
          Tap &ldquo;Add items&rdquo; and photograph the whole set in one sweep — every shot
          files itself in here.
        </Muted>
      )}

      {/* delete — un-groups, never deletes items */}
      {confirmDelete ? (
        <View style={styles.dangerBox}>
          <Heading style={styles.dangerHeading}>Delete this collection?</Heading>
          <Muted style={styles.dangerSub}>
            The {items.length === 1 ? 'item stays' : `${items.length} items stay`} in your
            inventory — only the grouping goes.
          </Muted>
          <Row style={styles.editActions}>
            <Pressable
              accessibilityRole="button"
              onPress={doDelete}
              style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
            >
              <Text style={styles.deleteBtnText}>Delete collection</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmDelete(false)}
              style={styles.editCancel}
            >
              <Text style={styles.editCancelText}>Keep it</Text>
            </Pressable>
          </Row>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirmDelete(true)}
          style={styles.deleteLink}
        >
          <Text style={styles.deleteLinkText}>Delete collection…</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  pressed: { opacity: 0.7 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  backText: { fontSize: 15, fontWeight: '600', color: T.ink },
  gone: { marginVertical: Spacing.three },
  titleRow: { alignItems: 'center', gap: Spacing.two },
  editBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { marginTop: 4, fontSize: 14, lineHeight: 20 },
  chips: { flexWrap: 'wrap', gap: 6, marginTop: Spacing.two, marginBottom: Spacing.three },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  cell: { flexBasis: '46%', flexGrow: 1, maxWidth: '48%' },
  cellTitle: { fontSize: 14.5, marginTop: 6 },
  cellSub: { fontSize: 12 },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.four,
    fontSize: 14,
    lineHeight: 20,
  },

  editBox: {
    borderWidth: 1,
    borderColor: T.brass,
    borderRadius: 14,
    backgroundColor: T.surface,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
  editLabel: { marginTop: 0 },
  editInput: {
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    fontFamily: Fonts?.serif,
    fontSize: 16,
    color: T.ink,
    marginBottom: Spacing.two,
  },
  editNote: { fontFamily: undefined, fontSize: 14, minHeight: 64, textAlignVertical: 'top' },
  editActions: { alignItems: 'center', gap: Spacing.three, marginTop: Spacing.one },
  editCancel: { paddingVertical: 10, paddingHorizontal: 6 },
  editCancelText: { fontSize: 14, fontWeight: '600', color: T.inkSoft },

  dangerBox: {
    borderWidth: 1,
    borderColor: T.toss,
    borderRadius: 14,
    backgroundColor: T.tossTint,
    padding: Spacing.three,
    marginTop: Spacing.five,
  },
  dangerHeading: { fontSize: 16 },
  dangerSub: { marginTop: 4, marginBottom: Spacing.two, fontSize: 13.5, lineHeight: 19 },
  deleteLink: { minHeight: 44, justifyContent: 'center', marginTop: Spacing.five },
  deleteLinkText: { fontSize: 14, fontWeight: '600', color: T.toss },
  deleteBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.toss,
    backgroundColor: T.surface,
  },
  deleteBtnText: { fontSize: 15, fontWeight: '700', color: T.toss },
});
