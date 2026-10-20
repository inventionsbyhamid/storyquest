import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors, radii, screen, space, type, useTone } from '../theme';
import { scaledPixels } from '../hooks/useScale';

interface NoticeProps {
  id: number;
  text: string;
  onDismiss: (id: number) => void;
  durationMs?: number;
  // On plain night screens the scrim would vanish, so the card is raised instead.
  raised?: boolean;
}

export const Notice = React.memo(({ id, text, onDismiss, durationMs = 4500, raised }: NoticeProps) => {
  const tone = useTone();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true });
    animation.start();
    const timer = setTimeout(() => onDismiss(id), durationMs);
    return () => {
      animation.stop();
      clearTimeout(timer);
    };
  }, [id, durationMs, opacity, onDismiss]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        raised
          ? [styles.raised, { backgroundColor: tone.raised, borderColor: tone.line }]
          : { backgroundColor: tone.scrim },
        { opacity },
      ]}
    >
      <Text style={styles.text}>{text}</Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: screen.top,
    alignSelf: 'center',
    maxWidth: scaledPixels(1100),
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radii.card,
    zIndex: 40,
  },
  raised: {
    borderWidth: scaledPixels(2),
  },
  text: {
    ...type.body,
    color: colors.paper,
    textAlign: 'center',
  },
});
