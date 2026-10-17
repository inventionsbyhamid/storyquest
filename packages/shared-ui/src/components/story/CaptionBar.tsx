import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radii, safeZones, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';

interface CaptionBarProps {
  caption: string | null;
  progress: string;
  madeIn: string | null;
  showToken: number;
}

const VISIBLE_MS = 5000;

export const CaptionBar = React.memo(({ caption, progress, madeIn, showToken }: CaptionBarProps) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showToken) {
      opacity.stopAnimation();
      opacity.setValue(0);
      return;
    }
    const animation = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.delay(VISIBLE_MS),
      Animated.timing(opacity, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [showToken, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          opacity,
          transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [scaledPixels(16), 0] }) }],
        },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.metaRow}>
          <Text style={styles.progress}>{progress}</Text>
          {madeIn ? <Text style={styles.madeIn}>{madeIn}</Text> : null}
        </View>
        {caption ? (
          <Text style={styles.caption} numberOfLines={2}>
            {caption}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: scaledPixels(safeZones.titleSafe.vertical + 24),
    alignItems: 'center',
  },
  bar: {
    maxWidth: scaledPixels(1440),
    paddingHorizontal: scaledPixels(40),
    paddingVertical: scaledPixels(20),
    borderRadius: radii.lg,
    backgroundColor: 'rgba(11, 13, 26, 0.66)',
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progress: {
    ...type.meta,
    color: colors.accent,
    letterSpacing: scaledPixels(1),
  },
  madeIn: {
    ...type.meta,
    fontWeight: '500',
    color: colors.textFaint,
    marginLeft: scaledPixels(18),
  },
  caption: {
    ...type.bodyLarge,
    fontSize: scaledPixels(36),
    lineHeight: scaledPixels(46),
    color: colors.text,
    textAlign: 'center',
    marginTop: scaledPixels(6),
  },
});
