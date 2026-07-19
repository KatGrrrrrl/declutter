/**
 * DonateTo — where a donated item is headed: a charity ("Goodwill") or a
 * person ("cousin Jane"). Renders nothing unless the item is decided as
 * donate. The destination is part of the decision, so only deciders edit it
 * (canEdit); contributors see the chip read-only.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Btn, Muted, Well } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';

import type { Item } from '@/lib/store';

type Kind = NonNullable<Item['donateToKind']>;

const QUICK_CHARITIES = [
  'Goodwill',
  'Salvation Army',
  'Habitat ReStore',
  'Local library',
  'Church/temple',
] as const;

const KIND_META = {
  charity: { label: 'Charity', icon: 'heart', iconOutline: 'heart-outline' },
  person: { label: 'A person', icon: 'person', iconOutline: 'person-outline' },
} as const satisfies Record<Kind, { label: string; icon: string; iconOutline: string }>;

export function DonateTo({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const updateItem = useStore((s) => s.updateItem);

  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<Kind>(item.donateToKind ?? 'charity');
  const [name, setName] = useState(item.donateTo ?? '');

  if (item.decision !== 'donate') return null;

  const openEditor = () => {
    if (!canEdit) return;
    setKind(item.donateToKind ?? 'charity');
    setName(item.donateTo ?? '');
    setEditing(true);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateItem(item.id, { donateTo: trimmed, donateToKind: kind });
    setEditing(false);
  };

  if (editing && canEdit) {
    return (
      <Well style={styles.editor}>
        <Muted style={styles.editorTitle}>Where should this go?</Muted>

        {/* kind toggle */}
        <View style={styles.kindRow}>
          {(Object.keys(KIND_META) as Kind[]).map((k) => {
            const selected = kind === k;
            return (
              <Pressable
                key={k}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setKind(k)}
                style={({ pressed }) => [
                  styles.kindBtn,
                  selected && styles.kindBtnOn,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={selected ? KIND_META[k].icon : KIND_META[k].iconOutline}
                  size={16}
                  color={selected ? T.donate : T.inkSoft}
                />
                <Text style={[styles.kindText, selected && styles.kindTextOn]}>
                  {KIND_META[k].label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={kind === 'charity' ? 'Charity name' : 'Who is it for? e.g. cousin Jane'}
          placeholderTextColor={T.inkFaint}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel="Donation destination name"
        />

        {kind === 'charity' ? (
          <View style={styles.quickRow}>
            {QUICK_CHARITIES.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                onPress={() => setName(c)}
                style={({ pressed }) => [
                  styles.quickChip,
                  name === c && styles.quickChipOn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.quickText, name === c && styles.quickTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <View style={styles.actionGrow}>
            <Btn label="Save destination" kind="primary" onPress={save} disabled={!name.trim()} />
          </View>
          <Btn label="Cancel" kind="quiet" onPress={() => setEditing(false)} />
        </View>
      </Well>
    );
  }

  if (!item.donateTo) {
    if (!canEdit) {
      return <Muted style={styles.unsetNote}>No destination chosen yet.</Muted>;
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose where this donation goes"
        onPress={openEditor}
        style={({ pressed }) => [styles.prompt, pressed && styles.pressed]}
      >
        <Ionicons name="navigate-outline" size={16} color={T.donate} />
        <Text style={styles.promptText}>No destination yet — choose where this goes</Text>
      </Pressable>
    );
  }

  const icon = item.donateToKind === 'person' ? 'person' : 'heart';
  return (
    <Pressable
      accessibilityRole={canEdit ? 'button' : undefined}
      accessibilityLabel={`Donation destination: ${item.donateTo}`}
      onPress={canEdit ? openEditor : undefined}
      disabled={!canEdit}
      style={({ pressed }) => [styles.chip, canEdit && pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={15} color={T.donate} />
      <Text style={styles.chipText}>→ {item.donateTo}</Text>
      {canEdit ? <Ionicons name="pencil-outline" size={13} color={T.donate} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 34,
    backgroundColor: T.donateTint,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
    marginTop: Spacing.two,
  },
  chipText: { fontSize: 13.5, fontWeight: '700', color: T.donate },

  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    minHeight: 40,
    borderWidth: 1,
    borderColor: T.donate,
    borderStyle: 'dashed',
    borderRadius: Radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: Spacing.two,
  },
  promptText: { fontSize: 13.5, fontWeight: '600', color: T.donate },
  unsetNote: { fontSize: 13, fontStyle: 'italic', marginTop: Spacing.two },

  editor: { marginTop: Spacing.two, gap: Spacing.two },
  editorTitle: { fontSize: 13, fontWeight: '600' },
  kindRow: { flexDirection: 'row', gap: Spacing.two },
  kindBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: Radius.control,
    backgroundColor: T.surface,
  },
  kindBtnOn: { borderColor: T.donate, backgroundColor: T.donateTint },
  kindText: { fontSize: 14, fontWeight: '600', color: T.inkSoft },
  kindTextOn: { color: T.donate },
  input: {
    minHeight: 48,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 15,
    color: T.ink,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  quickChip: {
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  quickChipOn: { borderColor: T.donate, backgroundColor: T.donateTint },
  quickText: { fontSize: 12.5, fontWeight: '600', color: T.inkSoft },
  quickTextOn: { color: T.donate },
  actionRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'stretch' },
  actionGrow: { flex: 1 },
});
