/**
 * Decide — the parent's hero screen. One item at a time, swiped or tapped:
 * right/Keep, left/Donate, down/Let go. Gentle progress, a brief Undo after
 * every decision, and a "Tell me about this one" path into the item detail.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  SwipeCard,
  SwipeCardHandle,
  SwipeDecision,
} from '@/components/parent/swipe-card';
import { DECISION_META, Muted, PhotoBox, Row, Screen, Title } from '@/components/ui';
import { Fonts, Spacing, T } from '@/constants/theme';
import { selectQueue, useStore } from '@/lib/store';

const UNDO_MS = 6000;

function successHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export default function DecideScreen() {
  const router = useRouter();
  const queue = useStore(selectQueue);
  const decide = useStore((s) => s.decide);
  const undoDecision = useStore((s) => s.undoDecision);

  const cardRef = useRef<SwipeCardHandle>(null);
  const busyRef = useRef(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sessionDone, setSessionDone] = useState(0);
  const [lastDecided, setLastDecided] = useState<{
    id: string;
    title: string;
    decision: SwipeDecision;
  } | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    []
  );

  const current = queue[0];
  const next = queue[1];

  const handleCommit = (id: string, decision: SwipeDecision) => {
    busyRef.current = false;
    const item = queue.find((i) => i.id === id);
    decide(id, decision);
    setSessionDone((n) => n + 1);
    setLastDecided({ id, title: item?.title ?? 'that one', decision });
    successHaptic();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setLastDecided(null), UNDO_MS);
  };

  const pressDecision = (decision: SwipeDecision) => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    cardRef.current?.fling(decision);
  };

  const handleUndo = () => {
    if (!lastDecided) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoDecision(lastDecided.id);
    setSessionDone((n) => Math.max(0, n - 1));
    setLastDecided(null);
    busyRef.current = false;
  };

  // Gentle progress: dots fill as today's pile shrinks.
  const total = queue.length + sessionDone;
  const dotsOn = total === 0 ? 5 : Math.round((sessionDone / total) * 5);

  return (
    <Screen scroll={false}>
      <Row style={styles.headRow}>
        <Title style={styles.title}>Decide</Title>
        {current ? (
          <Text style={styles.togo}>
            <Text style={styles.togoNum}>{queue.length}</Text> to go
          </Text>
        ) : null}
      </Row>
      <Row style={styles.dotsRow}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.dot, i < dotsOn && styles.dotOn]} />
        ))}
      </Row>

      <View style={styles.deck}>
        {next ? (
          <View style={[styles.nextCard]} pointerEvents="none">
            <PhotoBox title={next.title} photoUri={next.photoUri} height={170} />
          </View>
        ) : null}

        {current ? (
          <SwipeCard
            key={current.id}
            ref={cardRef}
            item={current}
            onCommit={handleCommit}
          />
        ) : (
          <View style={styles.allCaught}>
            <Ionicons name="checkmark-circle-outline" size={58} color={T.keep} />
            <Text style={styles.allCaughtTitle}>All decided. Beautiful.</Text>
            <Muted style={styles.allCaughtSub}>
              Anything new your family adds will wait for you right here — in
              your own time.
            </Muted>
          </View>
        )}

        {lastDecided ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Undo — ${lastDecided.title}`}
            onPress={handleUndo}
            style={({ pressed }) => [styles.undoChip, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-undo-outline" size={17} color={T.brassDeep} />
            <Text style={styles.undoText} numberOfLines={1}>
              Undo · {DECISION_META[lastDecided.decision].label.toLowerCase()}{' '}
              &ldquo;{lastDecided.title}&rdquo;
            </Text>
          </Pressable>
        ) : null}
      </View>

      {current ? (
        <>
          <View style={styles.actions}>
            <View style={styles.actCol}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Let go"
                onPress={() => pressDecision('toss')}
                style={({ pressed }) => [styles.act, pressed && styles.actPressed]}
              >
                <Ionicons name="trash-outline" size={26} color={T.toss} />
              </Pressable>
              <Text style={styles.actLbl}>Let go</Text>
            </View>
            <View style={styles.actCol}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Donate"
                onPress={() => pressDecision('donate')}
                style={({ pressed }) => [styles.act, pressed && styles.actPressed]}
              >
                <Ionicons name="heart-outline" size={26} color={T.donate} />
              </Pressable>
              <Text style={styles.actLbl}>Donate</Text>
            </View>
            <View style={styles.actCol}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Keep"
                onPress={() => pressDecision('keep')}
                style={({ pressed }) => [
                  styles.act,
                  styles.actKeep,
                  pressed && styles.actPressed,
                ]}
              >
                <Ionicons name="checkmark" size={32} color="#FFFFFF" />
              </Pressable>
              <Text style={[styles.actLbl, { color: T.keep }]}>Keep</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/item/[id]', params: { id: current.id } })
            }
            style={({ pressed }) => [styles.tellBar, pressed && styles.pressed]}
          >
            <Ionicons name="mic-outline" size={19} color={T.brassDeep} />
            <Text style={styles.tellText}>Tell me about this one</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.footerSpacer} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { justifyContent: 'space-between', alignItems: 'baseline' },
  title: { marginBottom: 0 },
  togo: { fontSize: 15, color: T.inkSoft, fontWeight: '600' },
  togoNum: { color: T.ink, fontWeight: '700' },
  dotsRow: { gap: 7, marginTop: Spacing.two, marginBottom: Spacing.two },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: T.line,
  },
  dotOn: { backgroundColor: T.brass },

  deck: {
    flex: 1,
    marginTop: Spacing.two,
    minHeight: 320,
  },
  nextCard: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    bottom: -6,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.lineSoft,
    borderRadius: 24,
    padding: 14,
    opacity: 0.55,
    transform: [{ scale: 0.97 }],
  },

  allCaught: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: Spacing.five,
  },
  allCaughtTitle: {
    fontFamily: Fonts?.serif,
    fontSize: 24,
    fontWeight: '600',
    color: T.heading,
    textAlign: 'center',
  },
  allCaughtSub: { fontSize: 15, lineHeight: 22, textAlign: 'center' },

  undoChip: {
    position: 'absolute',
    top: -2,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: T.brassTint,
    borderWidth: 1,
    borderColor: T.brass,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    maxWidth: '92%',
    zIndex: 20,
  },
  undoText: { fontSize: 15, fontWeight: '600', color: T.brassDeep },

  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingTop: Spacing.four,
  },
  actCol: { alignItems: 'center', gap: 5 },
  act: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#332614',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  actKeep: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: T.keep,
    borderColor: T.keep,
  },
  actPressed: { transform: [{ scale: 0.94 }] },
  actLbl: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: T.inkFaint,
  },

  tellBar: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: T.brass,
    borderRadius: 16,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  tellText: { fontSize: 15, fontWeight: '600', color: T.brassDeep },
  footerSpacer: { height: Spacing.three },
  pressed: { opacity: 0.7 },
});
