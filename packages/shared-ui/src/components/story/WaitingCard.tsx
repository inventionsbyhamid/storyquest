import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors, radii, space, type, useTone } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { WaitingDots } from '../WaitingDots';

interface WaitingCardProps {
  label: string;
  detail?: string | null;
  delayMs?: number;
}

export const WaitingCard = React.memo(({ label, detail, delayMs = 0 }: WaitingCardProps) => {
  const tone = useTone();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: 1, delay: delayMs, duration: 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity, delayMs]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.card, { backgroundColor: tone.scrim, opacity }]}
    >
      <WaitingDots />
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    minWidth: scaledPixels(480),
    maxWidth: scaledPixels(960),
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderRadius: radii.card,
    alignItems: 'center',
  },
  label: {
    ...type.bodyStrong,
    color: colors.paper,
    marginTop: space.sm,
    textAlign: 'center',
  },
  detail: {
    ...type.body,
    color: colors.paperDim,
    textAlign: 'center',
  },
});
