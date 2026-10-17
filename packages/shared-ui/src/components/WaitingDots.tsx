import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { useMotion } from './Motion';

const DOTS = 3;

// Three solid dots whose opacity pulses in turn. Never a spinner.
export const WaitingDots = React.memo(({ color = colors.paper, size = 12 }: { color?: string; size?: number }) => {
  const progress = useRef(new Animated.Value(0)).current;
  const active = useMotion();

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, active]);

  const dotStyles = useMemo(
    () =>
      Array.from({ length: DOTS }, (_, i) => {
        const start = i / (DOTS + 1);
        const peak = start + 0.2;
        const end = start + 0.4;
        return {
          opacity: progress.interpolate({ inputRange: [0, start, peak, end, 1], outputRange: [0.3, 0.3, 1, 0.3, 0.3] }),
        };
      }),
    [progress],
  );

  const dot = {
    width: scaledPixels(size),
    height: scaledPixels(size),
    borderRadius: scaledPixels(size / 2),
    backgroundColor: color,
  };

  return (
    <View style={styles.row}>
      {dotStyles.map((style, i) => (
        <Animated.View key={i} style={[dot, styles.dot, style]} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    marginHorizontal: scaledPixels(5),
  },
});
