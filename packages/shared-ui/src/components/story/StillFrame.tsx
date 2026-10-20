import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useTone } from '../../theme';

// Covers the video surface with the exact frame the next clip starts on, so cuts never flash black.
// Without a frame yet it is the story's night.
export const StillFrame = React.memo(({ uri, visible }: { uri: string | null; visible: boolean }) => {
  const tone = useTone();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const source = useMemo(() => (uri ? { uri } : null), [uri]);

  useEffect(() => {
    if (visible) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    const animation = Animated.timing(opacity, { toValue: 0, delay: 120, duration: 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [visible, opacity]);

  if (!source)
    return <Animated.View pointerEvents="none" style={[styles.plain, { backgroundColor: tone.night, opacity }]} />;
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
  plain: {
    ...StyleSheet.absoluteFillObject,
  },
});
