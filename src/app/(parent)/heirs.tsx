/**
 * Heirs — who gets what. One card per person with the items set aside for
 * them and each item's visibility state. Owner-only by design; a quiet note
 * reminds the parent that nothing is shared until they choose.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar, VISIBILITY_META } from '@/components/parent/bits';
import { Btn, Card, Muted, Row, Screen, Title, Well } from '@/components/ui';
import { Fonts, Spacing, T } from '@/constants/theme';
import { useStore } from '@/lib/store';

export default function HeirsScreen() {
  const router = useRouter();
  const people = useStore((s) => s.people);
  const items = useStore((s) => s.items);
  const addPerson = useStore((s) => s.addPerson);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');

  const assignedTotal = items.filter((i) => i.heirPersonId).length;

  const handleAdd = () => {
    const displayName = name.trim();
    if (!displayName) return;
    addPerson({ displayName, relationship: relationship.trim() || 'family' });
    setName('');
    setRelationship('');
    setShowForm(false);
  };

  return (
    <Screen>
      <Text style={styles.eyebrow}>Who gets what</Text>
      <Title style={styles.title}>Heirs</Title>
      <Muted style={styles.sub}>
        Only you can see these until you choose to share.
      </Muted>

      <View style={styles.list}>
        {people.map((person) => {
          const theirs = items.filter((i) => i.heirPersonId === person.id);
          return (
            <Card key={person.id} style={styles.personCard}>
              <Row style={styles.personRow}>
                <Avatar name={person.displayName} size={48} />
                <View style={styles.personMain}>
                  <Text style={styles.personName}>{person.displayName}</Text>
                  <Muted style={styles.personRel}>{person.relationship}</Muted>
                </View>
                <View style={styles.count}>
                  <Text style={styles.countNum}>{theirs.length}</Text>
                  <Text style={styles.countLbl}>
                    {theirs.length === 1 ? 'item' : 'items'}
                  </Text>
                </View>
              </Row>

              {theirs.length > 0 ? (
                <View style={styles.itemList}>
                  {theirs.map((item) => {
                    const vis = VISIBILITY_META[item.heirVisibility];
                    return (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={item.title}
                        onPress={() =>
                          router.push({
                            pathname: '/item/[id]',
                            params: { id: item.id },
                          })
                        }
                        style={({ pressed }) => [
                          styles.itemRow,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.itemTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Row style={styles.visChip}>
                          <Ionicons name={vis.icon} size={14} color={T.inkFaint} />
                          <Muted style={styles.visText}>{vis.label}</Muted>
                        </Row>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Muted style={styles.nothingYet}>
                  Nothing set aside for {person.displayName} yet.
                </Muted>
              )}
            </Card>
          );
        })}
      </View>

      {showForm ? (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>Add someone</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Their name"
            placeholderTextColor={T.inkFaint}
            style={styles.input}
            autoFocus
          />
          <TextInput
            value={relationship}
            onChangeText={setRelationship}
            placeholder="Relationship — daughter, neighbor, old friend…"
            placeholderTextColor={T.inkFaint}
            style={styles.input}
          />
          <Row style={styles.formBtns}>
            <View style={styles.flex}>
              <Btn label="Never mind" kind="quiet" onPress={() => setShowForm(false)} />
            </View>
            <View style={styles.flex}>
              <Btn label="Add" kind="brass" onPress={handleAdd} disabled={!name.trim()} />
            </View>
          </Row>
        </Card>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowForm(true)}
          style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={22} color={T.brassDeep} />
          <Text style={styles.addText}>Add someone</Text>
        </Pressable>
      )}

      <Well style={styles.note}>
        <Ionicons name="eye-outline" size={18} color={T.brass} style={styles.noteIcon} />
        <Text style={styles.noteText}>
          {assignedTotal} {assignedTotal === 1 ? 'item is' : 'items are'} set
          aside, all <Text style={styles.noteStrong}>private to you</Text>.
          Reveal to family now, after you&rsquo;re gone, or never — your call,
          per item.
        </Text>
      </Well>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    marginTop: Spacing.three,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: T.brassDeep,
  },
  title: { marginTop: 4, marginBottom: 0 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 4, marginBottom: Spacing.three },

  list: { gap: Spacing.three },
  personCard: { padding: Spacing.three },
  personRow: { gap: 13 },
  personMain: { flex: 1, minWidth: 0 },
  personName: { fontSize: 17, fontWeight: '700', color: T.ink },
  personRel: { fontSize: 14, marginTop: 1, textTransform: 'capitalize' },
  count: { alignItems: 'flex-end' },
  countNum: {
    fontFamily: Fonts?.serif,
    fontSize: 24,
    fontWeight: '700',
    color: T.brassDeep,
  },
  countLbl: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: T.inkFaint,
  },

  itemList: {
    marginTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: T.lineSoft,
  },
  itemRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.lineSoft,
  },
  itemTitle: { flex: 1, fontSize: 15, color: T.ink },
  visChip: { gap: 5 },
  visText: { fontSize: 13 },
  nothingYet: { marginTop: Spacing.two, fontSize: 14, fontStyle: 'italic' },

  addRow: {
    marginTop: Spacing.three,
    minHeight: 56,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: T.brass,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addText: { fontSize: 16, fontWeight: '600', color: T.brassDeep },

  formCard: { marginTop: Spacing.three, gap: Spacing.two },
  formTitle: {
    fontFamily: Fonts?.serif,
    fontSize: 19,
    fontWeight: '600',
    color: T.heading,
    marginBottom: 2,
  },
  input: {
    minHeight: 52,
    backgroundColor: T.sunken,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    color: T.ink,
  },
  formBtns: { marginTop: Spacing.one, gap: Spacing.two },
  flex: { flex: 1 },

  note: {
    marginTop: Spacing.four,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  noteIcon: { marginTop: 2 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 21, color: T.inkSoft },
  noteStrong: { color: T.ink, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
