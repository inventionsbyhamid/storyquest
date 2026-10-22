import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useTone } from '../../theme';

type Props = { uri: string | null; visible: boolean; upcoming?: string | null };

// Covers the video surface with the exact frame the next clip starts on, so cuts never flash black.
// Without a frame yet it is the story's night. Once hidden it loads `upcoming`, the frame the
// playing clip ends on, so the cover is already decoded when the clip hands over to the next one.
export const StillFrame = React.memo(({ uri, visible, upcoming }: Props) => {
  const tone = useTone();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [faded, setFaded] = useState(!visible);
  const shown = !visible && faded && upcoming ? upcoming : uri;
  const source = useMemo(() => (shown ? { uri: shown } : null), [shown]);

  // A layout effect, so the cover is up before the player switches clips and blanks the surface.
  useLayoutEffect(() => {
    if (visible) {
      opacity.stopAnimation();
      opacity.setValue(1);
      setFaded(false);
      return;
    }
    const animation = Animated.timing(opacity, { toValue: 0, delay: 120, duration: 200, useNativeDriver: true });
    animation.start(({ finished }) => finished && setFaded(true));
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
