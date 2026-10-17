import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors, radii, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { WaitingDots } from '../WaitingDots';

interface WaitingCardProps {
  label: string;
  detail?: string | null;
  delayMs?: number;
}

export const WaitingCard = React.memo(({ label, detail, delayMs = 0 }: WaitingCardProps) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: 1, delay: delayMs, duration: 360, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity, delayMs]);

  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.wrap, { opacity }]}>
      <WaitingDots size={18} />
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    top: '38%',
    minWidth: scaledPixels(560),
    maxWidth: scaledPixels(1100),
    paddingHorizontal: scaledPixels(56),
    paddingVertical: scaledPixels(36),
    borderRadius: radii.lg,
    backgroundColor: colors.scrimStrong,
    borderWidth: scaledPixels(2),
    borderColor: 'rgba(255, 181, 71, 0.35)',
    alignItems: 'center',
  },
  label: {
    ...type.heading,
    color: colors.text,
    marginTop: scaledPixels(20),
    textAlign: 'center',
  },
  detail: {
    ...type.body,
    color: colors.textMuted,
    marginTop: scaledPixels(8),
    textAlign: 'center',
  },
});
