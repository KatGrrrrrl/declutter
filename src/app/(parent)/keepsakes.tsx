/**
 * Keepsakes — the parent's shelf of kept items. Large warm cards: photo, serif
 * title, room, tags, story presence, value, and (owner-only) the heir chip
 * with its visibility state. Tap a card to open the item.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, VISIBILITY_META, formatDuration } from '@/components/parent/bits';
import { Heading, Muted, PhotoBox, Row, Screen, Tag, Title } from '@/components/ui';
import { Fonts, Spacing, T } from '@/constants/theme';
import { useKeepsakes, useMessageCount, useStore } from '@/lib/store';

import type { Item } from '@/lib/store';

/** "2 notes from the family" — own component so the count hook runs per card. */
function FamilyNotes({ itemId }: { itemId: string }) {
  const count = useMessageCount(itemId);
  if (count === 0) return null;
  return (
    <Row style={styles.notesRow}>
      <Ionicons name="chatbubble-outline" size={14} color={T.inkSoft} />
      <Text style={styles.notesText}>
        {count} {count === 1 ? 'note' : 'notes'} from the family
      </Text>
    </Row>
  );
}

export default function KeepsakesScreen() {
  const router = useRouter();
  const keepsakes = useKeepsakes();
  const people = useStore((s) => s.people);

  const heirName = (item: Item) =>
    people.find((p) => p.id === item.heirPersonId)?.displayName;

  return (
    <Screen>
      <Text style={styles.eyebrow}>
        Kept · {keepsakes.length} {keepsakes.length === 1 ? 'item' : 'items'}
      </Text>
      <Title style={styles.title}>Keepsakes</Title>
      <Muted style={styles.sub}>
        Tap any piece to add its story or say who it&rsquo;s for.
      </Muted>

      {keepsakes.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="heart-outline" size={46} color={T.inkFaint} />
          <Text style={styles.emptyTitle}>Nothing kept yet</Text>
          <Muted style={styles.emptySub}>
            When you choose &ldquo;Keep&rdquo; on the Decide screen, those
            pieces gather here.
          </Muted>
        </View>
      ) : (
        <View style={styles.list}>
          {keepsakes.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() =>
                router.push({ pathname: '/item/[id]', params: { id: item.id } })
              }
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <PhotoBox
                title={item.title}
                photoUri={item.photoUri}
                remotePath={item.remotePhotoPath}
                height={150}
                radius={0}
              />
              <View style={styles.cardBody}>
                <Heading style={styles.cardTitle}>{item.title}</Heading>
                <Row style={styles.metaRow}>
                  <Muted style={styles.room}>{item.room}</Muted>
                  {item.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Row>

                {item.story ? (
                  <Row style={styles.storyRow}>
                    <Ionicons name="play" size={15} color={T.brassDeep} />
                    <Text style={styles.storyText}>
                      {item.story.durationSec
                        ? `${formatDuration(item.story.durationSec)} story`
                        : 'The story is here'}
                    </Text>
                  </Row>
                ) : (
                  <Row style={styles.storyRow}>
                    <Ionicons name="mic-outline" size={16} color={T.brassDeep} />
                    <Text style={styles.storyPrompt}>Add the story</Text>
                  </Row>
                )}

                <FamilyNotes itemId={item.id} />

                <Row style={styles.footRow}>
                  {item.heirPersonId && heirName(item) ? (
                    <Row style={styles.heirChip}>
                      <Avatar name={heirName(item)!} size={22} />
                      <Text style={styles.heirName}>{heirName(item)}</Text>
                      <Ionicons
                        name={VISIBILITY_META[item.heirVisibility].icon}
                        size={14}
                        color={T.inkFaint}
                      />
                    </Row>
                  ) : (
                    <Muted style={styles.unassigned}>No one chosen yet</Muted>
                  )}
                  <View style={styles.spacer} />
                  {item.isSentimental ? (
                    <Ionicons name="heart" size={16} color={T.toss} />
                  ) : null}
                  {item.marketValue != null ? (
                    <Text style={styles.value}>
                      ${item.marketValue.toLocaleString()}
                    </Text>
                  ) : null}
                </Row>
              </View>
            </Pressable>
          ))}
        </View>
      )}
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
  card: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 18,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  cardBody: { padding: Spacing.three },
  cardTitle: { fontSize: 20 },
  metaRow: { marginTop: 6, flexWrap: 'wrap', gap: Spacing.two },
  room: { fontSize: 14 },

  storyRow: { marginTop: 10, gap: 7 },
  storyText: { fontSize: 15, fontWeight: '600', color: T.brassDeep },
  storyPrompt: {
    fontSize: 15,
    fontWeight: '600',
    color: T.brassDeep,
    fontStyle: 'italic',
  },

  notesRow: { marginTop: 8, gap: 7 },
  notesText: { fontSize: 13.5, fontWeight: '600', color: T.inkSoft },

  footRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.lineSoft,
    gap: Spacing.two,
  },
  heirChip: { gap: 6 },
  heirName: { fontSize: 14, fontWeight: '600', color: T.brassDeep },
  unassigned: { fontSize: 14 },
  spacer: { flex: 1 },
  value: {
    fontFamily: Fonts?.serif,
    fontSize: 17,
    fontWeight: '600',
    color: T.ink,
  },

  empty: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.five,
  },
  emptyTitle: {
    fontFamily: Fonts?.serif,
    fontSize: 21,
    fontWeight: '600',
    color: T.heading,
  },
  emptySub: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
