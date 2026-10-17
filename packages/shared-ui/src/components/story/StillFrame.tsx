import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { colors } from '../../theme';
import { Gradient } from '../Gradient';

const GLOW = [
  { offset: 0, color: colors.secondary, opacity: 0.28 },
  { offset: 1, color: colors.background, opacity: 0 },
];

// Covers the video surface with the exact frame the next clip starts on, so cuts never flash black.
// Without a frame yet it shows a soft backdrop instead.
export const StillFrame = React.memo(({ uri, visible }: { uri: string | null; visible: boolean }) => {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const source = useMemo(() => (uri ? { uri } : null), [uri]);

  useEffect(() => {
    if (visible) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    const animation = Animated.timing(opacity, { toValue: 0, delay: 140, duration: 320, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [visible, opacity]);

  if (!source) {
    return (
      <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity }]}>
        <Gradient style={StyleSheet.absoluteFill} direction="down" stops={GLOW} />
      </Animated.View>
    );
  }
  return (
    <Animated.Image
      source={source}
      resizeMode="cover"
      fadeDuration={0}
      style={[StyleSheet.absoluteFill, { opacity }]}
    />
  );
});

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
  },
});
