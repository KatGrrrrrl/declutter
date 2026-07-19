/**
 * SwipeCard — the draggable card at the heart of the Decide deck.
 *
 * The card follows the finger via react-native-gesture-handler's Gesture.Pan
 * driving reanimated shared values. Release past a threshold flings the card
 * off-screen and commits the decision:
 *   right = keep · left = donate · down = let go ("toss").
 * While dragging, a tinted verdict label (Keep / Donate / Let go) fades in
 * with drag distance. The explicit buttons on the Decide screen trigger the
 * same fling through the imperative `fling()` handle.
 */

import { Ref, useImperativeHandle, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { DECISION_META, PhotoBox } from '@/components/ui';
import { Fonts, T } from '@/constants/theme';

import type { Decision, Item } from '@/lib/store';

export type SwipeDecision = Exclude<Decision, 'undecided'>;

export interface SwipeCardHandle {
  fling: (decision: SwipeDecision) => void;
}

const THRESHOLD = 90;
const FLING_MS = 300;

export function SwipeCard({
  item,
  onCommit,
  ref,
}: {
  item: Item;
  onCommit: (id: string, decision: SwipeDecision) => void;
  ref?: Ref<SwipeCardHandle>;
}) {
  // Opt out of React Compiler memoization: this component mutates reanimated
  // shared values from gesture worklets, which the compiler's immutability
  // model doesn't understand (a known Reanimated + compiler false positive).
  'use no memo';

  const { width, height } = useWindowDimensions();
  // Fresh shared values per card: the Decide screen remounts this component
  // (key={item.id}) whenever the queue advances or an undo brings one back,
  // so each card starts centered.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const [cardH, setCardH] = useState(0);

  const commit = (decision: SwipeDecision) => onCommit(item.id, decision);

  // Button path: animate the card off-screen for the visual, but commit on a
  // plain JS timer rather than Reanimated's withTiming completion callback —
  // that callback is unreliable on web, and the tap-a-button flow is the
  // elder-friendly primary interaction, so it must always land. The swipe
  // (gesture) path below keeps its own animation-driven commit.
  const fling = (decision: SwipeDecision) => {
    const offX = width * 1.3;
    if (decision === 'keep') {
      ty.value = withTiming(40, { duration: FLING_MS });
      tx.value = withTiming(offX, { duration: FLING_MS });
    } else if (decision === 'donate') {
      ty.value = withTiming(40, { duration: FLING_MS });
      tx.value = withTiming(-offX, { duration: FLING_MS });
    } else {
      ty.value = withTiming(height, { duration: FLING_MS });
    }
    setTimeout(() => commit(decision), FLING_MS);
  };

  useImperativeHandle(ref, () => ({ fling }));

  // Shared-value writes inside gesture worklets are Reanimated's intended
  // API; the compiler-powered immutability lint can't model them yet.
  /* eslint-disable react-hooks/immutability */
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = Math.max(-36, e.translationY);
    })
    .onEnd(() => {
      const x = tx.value;
      const y = ty.value;
      const offX = width * 1.3;
      if (x > THRESHOLD) {
        ty.value = withTiming(y + 40, { duration: FLING_MS });
        tx.value = withTiming(offX, { duration: FLING_MS }, (finished) => {
          if (finished) runOnJS(commit)('keep');
        });
      } else if (x < -THRESHOLD) {
        ty.value = withTiming(y + 40, { duration: FLING_MS });
        tx.value = withTiming(-offX, { duration: FLING_MS }, (finished) => {
          if (finished) runOnJS(commit)('donate');
        });
      } else if (y > THRESHOLD) {
        ty.value = withTiming(height, { duration: FLING_MS }, (finished) => {
          if (finished) runOnJS(commit)('toss');
        });
      } else {
        tx.value = withSpring(0, { damping: 18, stiffness: 220 });
        ty.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });
  /* eslint-enable react-hooks/immutability */

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${tx.value / 20}deg` },
    ],
  }));

  const keepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [24, THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const donateStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-tx.value, [24, THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const tossStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(ty.value, [24, THRESHOLD], [0, 1], Extrapolation.CLAMP) *
      interpolate(Math.abs(tx.value), [0, 60], [1, 0], Extrapolation.CLAMP),
  }));

  const photoHeight = Math.max(170, cardH - 122);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.card, cardStyle]}
        onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
      >
        <PhotoBox title={item.title} photoUri={item.photoUri} height={photoHeight} />
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.sub}>
            {item.room} · added by {item.addedBy}
          </Text>
        </View>

        {/* verdict overlays — fade in with drag distance */}
        <Animated.View
          style={[styles.verdict, styles.verdictKeep, keepStyle]}
          pointerEvents="none"
        >
          <Text style={[styles.verdictText, { color: DECISION_META.keep.color }]}>
            {DECISION_META.keep.label}
          </Text>
        </Animated.View>
        <Animated.View
          style={[styles.verdict, styles.verdictDonate, donateStyle]}
          pointerEvents="none"
        >
          <Text style={[styles.verdictText, { color: DECISION_META.donate.color }]}>
            {DECISION_META.donate.label}
          </Text>
        </Animated.View>
        <Animated.View
          style={[styles.verdict, styles.verdictToss, tossStyle]}
          pointerEvents="none"
        >
          <Text style={[styles.verdictText, { color: DECISION_META.toss.color }]}>
            {DECISION_META.toss.label}
          </Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 24,
    padding: 14,
    shadowColor: '#332614',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  meta: {
    paddingTop: 14,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  title: {
    fontFamily: Fonts?.serif,
    fontSize: 23,
    fontWeight: '600',
    color: T.heading,
    textAlign: 'center',
  },
  sub: {
    marginTop: 5,
    fontSize: 15,
    color: T.inkSoft,
  },
  verdict: {
    position: 'absolute',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 2.5,
    backgroundColor: T.surface,
  },
  verdictKeep: {
    top: 26,
    right: 22,
    borderColor: T.keep,
    backgroundColor: T.keepTint,
    transform: [{ rotate: '10deg' }],
  },
  verdictDonate: {
    top: 26,
    left: 22,
    borderColor: T.donate,
    backgroundColor: T.donateTint,
    transform: [{ rotate: '-10deg' }],
  },
  verdictToss: {
    bottom: 110,
    alignSelf: 'center',
    borderColor: T.toss,
    backgroundColor: T.tossTint,
  },
  verdictText: {
    fontFamily: Fonts?.serif,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
