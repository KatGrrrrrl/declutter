/**
 * Collection picker — one bottom sheet shared by capture (pin a collection for
 * the whole session), the inventory bulk bar (file several items at once), and
 * the item screen (file one item). Lists the household's collections with item
 * counts, offers "New collection" inline, and — when the caller allows it — a
 * "No collection" row to un-file.
 *
 * Any member may create collections and file items into them (like rooms);
 * decisions stay with the deciders regardless of grouping.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Heading, Muted } from '@/components/ui';
import { Spacing, T } from '@/constants/theme';
import { useCollections, useStore } from '@/lib/store';

export function CollectionPicker({
  visible,
  onClose,
  onPick,
  currentId,
  allowNone,
  title = 'Which collection?',
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with the chosen collection id, or undefined for "No collection". */
  onPick: (collectionId: string | undefined) => void;
  /** Highlighted as the current choice, when there is one. */
  currentId?: string;
  /** Show the "No collection" row (un-file). */
  allowNone?: boolean;
  title?: string;
}) {
  const collections = useCollections();
  const items = useStore((s) => s.items);
  const addCollection = useStore((s) => s.addCollection);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const countFor = (id: string) =>
    items.filter((i) => i.collectionId === id && !i.archived).length;

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = addCollection(trimmed);
    setName('');
    setCreating(false);
    onPick(id);
  };

  const close = () => {
    setCreating(false);
    setName('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Heading style={styles.title}>{title}</Heading>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {allowNone && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onPick(undefined)}
                style={[styles.row, !currentId && styles.rowOn]}
              >
                <Ionicons name="remove-circle-outline" size={18} color={T.inkSoft} />
                <Text style={styles.rowText}>No collection</Text>
              </Pressable>
            )}
            {collections.map((c) => {
              const n = countFor(c.id);
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: c.id === currentId }}
                  onPress={() => onPick(c.id)}
                  style={[styles.row, c.id === currentId && styles.rowOn]}
                >
                  <Ionicons name="albums-outline" size={18} color={T.brassDeep} />
                  <Text style={styles.rowText} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={styles.rowCount}>
                    {n} item{n === 1 ? '' : 's'}
                  </Text>
                </Pressable>
              );
            })}
            {collections.length === 0 && !creating && (
              <Muted style={styles.empty}>
                No collections yet — a collection groups things that belong together, like a
                coin collection or the wine cellar.
              </Muted>
            )}
          </ScrollView>

          {creating ? (
            <View style={styles.createRow}>
              <TextInput
                style={styles.createInput}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Coin collection"
                placeholderTextColor={T.inkFaint}
                aria-label="Name the new collection"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={create}
              />
              <Pressable
                accessibilityRole="button"
                onPress={create}
                style={[styles.createBtn, !name.trim() && styles.createBtnOff]}
                disabled={!name.trim()}
              >
                <Text style={styles.createBtnText}>Create</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setCreating(true)}
              style={styles.newRow}
            >
              <Ionicons name="add-circle-outline" size={18} color={T.brassDeep} />
              <Text style={styles.newRowText}>New collection…</Text>
            </Pressable>
          )}

          <Pressable accessibilityRole="button" onPress={close} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,16,12,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    maxHeight: '75%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  title: { marginBottom: Spacing.two },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
  },
  rowOn: { backgroundColor: T.brassTint },
  rowText: { flex: 1, fontSize: 15.5, fontWeight: '600', color: T.ink },
  rowCount: { fontSize: 12.5, fontWeight: '600', color: T.inkFaint },
  empty: { paddingVertical: Spacing.three, fontSize: 13.5, lineHeight: 19 },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    paddingHorizontal: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: T.lineSoft,
    marginTop: Spacing.two,
  },
  newRowText: { fontSize: 15.5, fontWeight: '700', color: T.brassDeep },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  createInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: T.brass,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: T.ink,
  },
  createBtn: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: T.ink,
    paddingHorizontal: Spacing.three,
  },
  createBtnOff: { opacity: 0.4 },
  createBtnText: { color: T.surface, fontSize: 14.5, fontWeight: '700' },
  cancel: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: Spacing.two },
  cancelText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
});
