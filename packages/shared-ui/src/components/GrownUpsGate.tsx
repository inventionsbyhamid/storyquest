import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import { createGateState, gateReducer, makeQuestion, questionText } from '../gate/question';
import type { GateAction } from '../gate/question';
import { colors, radii, space, type, useTone } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Button } from './Button';
import { Focusable, FocusFrame, FocusScale } from './Focusable';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

interface GrownUpsGateProps {
  active: boolean;
  onPass: () => void;
  onCancel: () => void;
}

// A times table question before anyone types a new idea. Remotes cannot report a long press
// everywhere, so the check is made of plain presses.
export function GrownUpsGate({ active, onPass, onCancel }: GrownUpsGateProps) {
  const tone = useTone();
  const opacity = useRef(new Animated.Value(0)).current;
  const [state, setState] = useState(() => createGateState(makeQuestion()));
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;

  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  useEffect(() => {
    if (state.passed) onPassRef.current();
  }, [state.passed]);

  const send = useCallback((action: GateAction) => setState((current) => gateReducer(current, action)), []);
  const press = useCallback((digit: number) => send({ type: 'digit', digit, next: makeQuestion() }), [send]);
  const erase = useCallback(() => send({ type: 'erase' }), [send]);

  const question = questionText(state.question);
  const slots = String(state.question.answer).length;

  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View style={[styles.cover, { backgroundColor: tone.scrim, opacity }]}>
        <View style={[styles.sheet, { backgroundColor: tone.raised }]}>
          <Text style={styles.title}>Grown ups only</Text>
          <Text style={styles.question} accessibilityLiveRegion="polite">
            {question}
          </Text>
          <View style={styles.entry}>
            {Array.from({ length: slots }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.slot,
                  { backgroundColor: tone.night, borderColor: tone.line },
                  i === state.entry.length && styles.slotNext,
                ]}
              >
                <Text style={styles.slotText}>{state.entry[i] ?? ''}</Text>
              </View>
            ))}
            <Text style={styles.note}>{state.missed ? 'That is not right. Try this one.' : 'Enter the answer'}</Text>
          </View>
          <SpatialNavigationView direction="vertical">
            <SpatialNavigationView direction="horizontal" style={styles.keys}>
              {DIGITS.map((digit) =>
                digit === 1 ? (
                  <DefaultFocus key={digit}>
                    <DigitKey digit={digit} onPress={press} />
                  </DefaultFocus>
                ) : (
                  <DigitKey key={digit} digit={digit} onPress={press} />
                ),
              )}
            </SpatialNavigationView>
            <SpatialNavigationView direction="horizontal" style={styles.actions}>
              <Button label="Erase" onSelect={erase} />
              <Button label="Cancel" onSelect={onCancel} plain style={styles.cancel} />
            </SpatialNavigationView>
          </SpatialNavigationView>
        </View>
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

const DigitKey = React.memo(({ digit, onPress }: { digit: number; onPress: (digit: number) => void }) => {
  const tone = useTone();
  return (
    <Focusable label={String(digit)} onSelect={() => onPress(digit)} style={styles.keySlot}>
      {(focused) => (
        <FocusScale focused={focused}>
          <View style={[styles.key, { backgroundColor: tone.night }]}>
            {focused && <FocusFrame radius={radii.card} />}
            <Text style={styles.keyText}>{digit}</Text>
          </View>
        </FocusScale>
      )}
    </Focusable>
  );
});

const KEY = scaledPixels(80);

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  sheet: {
    width: scaledPixels(1040),
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
    borderRadius: radii.card,
  },
  title: {
    ...type.title,
    color: colors.paper,
  },
  question: {
    ...type.heading,
    color: colors.paper,
    marginTop: space.md,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
  },
  slot: {
    width: KEY,
    height: scaledPixels(96),
    marginRight: space.sm,
    borderRadius: radii.card,
    borderWidth: scaledPixels(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNext: {
    borderColor: colors.paperDim,
  },
  slotText: {
    ...type.title,
    color: colors.paper,
  },
  note: {
    ...type.body,
    color: colors.paperDim,
    marginLeft: space.md,
  },
  keys: {
    flexDirection: 'row',
    marginTop: space.lg,
  },
  keySlot: {
    marginRight: scaledPixels(12),
  },
  key: {
    width: KEY,
    height: scaledPixels(88),
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    ...type.heading,
    color: colors.paper,
  },
  actions: {
    flexDirection: 'row',
    marginTop: space.lg,
  },
  cancel: {
    marginLeft: space.sm,
  },
});
