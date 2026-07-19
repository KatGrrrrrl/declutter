/**
 * ItemChat — the per-item family discussion thread. The whole household sees
 * the same conversation; anyone can chime in. Messages come exclusively from
 * the store's useItemMessages hook (reference-stable — never inline a
 * s.messages.filter selector) and are posted via addMessage, which stamps the
 * current user as the author.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/child/shared';
import { Label, Muted } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { useItemMessages, useStore } from '@/lib/store';

/**
 * "2m ago" / "3h ago" / "2d ago" — tiny on purpose, no date library.
 * Anything under a minute reads "just now"; anything over ~4 weeks falls back
 * to the locale date so old threads still make sense.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const sec = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 28) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ItemChat({ itemId }: { itemId: string }) {
  const messages = useItemMessages(itemId);
  const addMessage = useStore((s) => s.addMessage);
  const userName = useStore((s) => s.userName);

  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    addMessage(itemId, text);
    setDraft('');
  };

  return (
    <View>
      <Label>Family chat</Label>

      {messages.length === 0 ? (
        <Muted style={styles.empty}>
          No one&rsquo;s said anything yet — start the conversation.
        </Muted>
      ) : (
        <View style={styles.thread}>
          {messages.map((m) => {
            const mine = m.author === userName;
            return (
              <View key={m.id} style={styles.msgRow}>
                <Avatar name={m.author} size={30} color={mine ? T.brass : T.heading} />
                <View style={styles.msgMain}>
                  <View style={styles.msgMeta}>
                    <Text style={styles.author}>{mine ? 'You' : m.author}</Text>
                    <Text style={styles.time}>{relativeTime(m.createdAt)}</Text>
                  </View>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                    <Text style={styles.msgText}>{m.text}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Say something about this piece…"
          placeholderTextColor={T.inkFaint}
          style={styles.input}
          returnKeyType="send"
          onSubmitEditing={send}
          submitBehavior="submit"
          accessibilityLabel="Write a family chat message"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          onPress={send}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendBtn,
            !canSend && styles.sendBtnDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="paper-plane" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 15, lineHeight: 22, fontStyle: 'italic' },

  thread: { gap: Spacing.three },
  msgRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  msgMain: { flex: 1, minWidth: 0 },
  msgMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    marginBottom: 4,
  },
  author: {
    fontFamily: Fonts?.serif,
    fontSize: 15,
    fontWeight: '600',
    color: T.heading,
  },
  time: { fontSize: 12, color: T.inkFaint },
  bubble: {
    borderRadius: Radius.control,
    borderTopLeftRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  bubbleMine: {
    backgroundColor: T.brassTint,
    borderWidth: 1,
    borderColor: '#EADFC5',
  },
  bubbleOther: { backgroundColor: T.sunken },
  msgText: { fontSize: 15, lineHeight: 21, color: T.ink },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  input: {
    flex: 1,
    minHeight: 52,
    backgroundColor: T.sunken,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 15,
    color: T.ink,
  },
  sendBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.brass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
