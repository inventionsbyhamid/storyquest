import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { HOLD_MS, createHoldState, holdProgress, holdReducer } from '../gate/holdGate';
import type { HoldEvent } from '../gate/holdGate';
import { colors, radii, space, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Button } from './Button';
import { Focusable, FocusFrame } from './Focusable';

const INSTRUCTION = 'Press and hold Select for 3 seconds to continue';
const TRACK_WIDTH = scaledPixels(672);

type Stage = 'idle' | 'holding' | 'full';

interface GrownUpsGateProps {
  active: boolean;
  onPass: () => void;
  onCancel: () => void;
}

// A calm check before anyone types a new idea: Select has to be held down, which small
// children rarely do on purpose.
export function GrownUpsGate({ active, onPass, onCancel }: GrownUpsGateProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(0)).current;
  const hold = useRef(createHoldState(Date.now()));
  const targetFocused = useRef(false);
  const fullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;

  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  const send = useCallback(
    (event: HoldEvent) => {
      const before = hold.current;
      const next = holdReducer(before, event);
      if (next === before) return;
      hold.current = next;
      if (fullTimer.current) clearTimeout(fullTimer.current);
      fullTimer.current = null;
      fill.stopAnimation();
      if (next.passed) {
        onPassRef.current();
        return;
      }
      if (next.startedAt !== null) {
        const remaining = HOLD_MS * (1 - holdProgress(next, Date.now()));
        setStage('holding');
        Animated.timing(fill, {
          toValue: 1,
          duration: remaining,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start();
        fullTimer.current = setTimeout(() => setStage('full'), remaining);
      } else {
        setStage('idle');
        Animated.timing(fill, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      }
    },
    [fill],
  );

  useEffect(() => {
    if (!active) {
      send({ type: 'cancel' });
      return;
    }
    const onDown = (key: SupportedKeys) => {
      if (key === SupportedKeys.Enter && targetFocused.current) send({ type: 'down', at: Date.now() });
    };
    const onUp = (key: SupportedKeys) => {
      if (key === SupportedKeys.Enter) send({ type: 'up', at: Date.now() });
    };
    RemoteControlManager.addKeydownListener(onDown);
    RemoteControlManager.addKeyupListener(onUp);
    return () => {
      RemoteControlManager.removeKeydownListener(onDown);
      RemoteControlManager.removeKeyupListener(onUp);
    };
  }, [active, send]);

  useEffect(
    () => () => {
      if (fullTimer.current) clearTimeout(fullTimer.current);
    },
    [],
  );

  const focusTarget = useCallback(() => {
    targetFocused.current = true;
  }, []);
  const blurTarget = useCallback(() => {
    targetFocused.current = false;
    send({ type: 'cancel' });
  }, [send]);

  const fillStyle = {
    transform: [{ translateX: fill.interpolate({ inputRange: [0, 1], outputRange: [-TRACK_WIDTH, 0] }) }],
  };

  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View style={[styles.cover, { opacity }]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Grown ups only</Text>
          <Text style={styles.body}>{INSTRUCTION}</Text>
          <SpatialNavigationView direction="vertical">
            <DefaultFocus>
              <Focusable label={INSTRUCTION} onFocus={focusTarget} onBlur={blurTarget} style={styles.targetSlot}>
                {(focused) => (
                  <View style={styles.target}>
                    {focused && <FocusFrame radius={radii.card} />}
                    <View style={styles.track}>
                      <Animated.View style={[styles.fill, fillStyle]} />
                    </View>
                    <Text style={styles.status}>
                      {stage === 'full' ? 'Let go to continue' : stage === 'holding' ? 'Keep holding' : 'Hold Select'}
                    </Text>
                  </View>
                )}
              </Focusable>
            </DefaultFocus>
            <Button label="Cancel" onSelect={onCancel} style={styles.cancel} />
          </SpatialNavigationView>
        </View>
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  sheet: {
    width: scaledPixels(816),
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
    borderRadius: radii.card,
    backgroundColor: colors.inkRaised,
  },
  title: {
    ...type.title,
    color: colors.paper,
  },
  body: {
    ...type.body,
    color: colors.paper,
    marginTop: space.sm,
  },
  targetSlot: {
    marginTop: space.lg,
  },
  target: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radii.card,
    backgroundColor: colors.ink,
  },
  track: {
    width: TRACK_WIDTH,
    height: scaledPixels(16),
    borderRadius: radii.round,
    overflow: 'hidden',
    backgroundColor: colors.inkLine,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.marigold,
  },
  status: {
    ...type.small,
    color: colors.paperDim,
    marginTop: space.sm,
  },
  cancel: {
    marginTop: space.lg,
  },
});
