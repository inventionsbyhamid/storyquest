import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radii, space, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';

interface CaptionBarProps {
  caption: string | null;
  folio: string;
  madeIn: string | null;
  showToken: number;
}

const FADE_MS = 200;
const VISIBLE_MS = 4000;

// The caption plate: a solid panel at the bottom with the line of the scene and a folio.
export const CaptionBar = React.memo(({ caption, folio, madeIn, showToken }: CaptionBarProps) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showToken) {
      opacity.stopAnimation();
      opacity.setValue(0);
      return;
    }
    const animation = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }),
      Animated.delay(VISIBLE_MS),
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [showToken, opacity]);

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { opacity }]}>
      <View style={styles.plate}>
        <Text style={styles.caption} numberOfLines={2}>
          {caption ?? ''}
        </Text>
        <View style={styles.folio}>
          <Text style={styles.folioText}>{folio}</Text>
          {madeIn ? <Text style={styles.madeIn}>{madeIn}</Text> : null}
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: scaledPixels(64),
    alignItems: 'center',
  },
  plate: {
    width: scaledPixels(1320),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radii.card,
    backgroundColor: colors.scrim,
  },
  caption: {
    ...type.body,
    color: colors.paper,
    flex: 1,
  },
  folio: {
    alignItems: 'flex-end',
    marginLeft: space.xl,
  },
  folioText: {
    ...type.body,
    color: colors.paperDim,
  },
  madeIn: {
    ...type.small,
    color: colors.paperDim,
  },
});
