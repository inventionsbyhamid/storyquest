import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';

export function usePulse(min = 0.35, max = 0.85, duration = 900): Animated.Value {
  const value = useRef(new Animated.Value(min)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: max, duration, useNativeDriver: true, isInteraction: false }),
        Animated.timing(value, { toValue: min, duration, useNativeDriver: true, isInteraction: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, min, max, duration]);
  return value;
}

export function SkeletonBlock({ pulse, style }: { pulse: Animated.Value; style: StyleProp<ViewStyle> }) {
  return <Animated.View style={[{ backgroundColor: colors.surfaceHigh, opacity: pulse }, style]} />;
}
