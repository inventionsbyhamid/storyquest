import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors, radii, safeZones, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { SparkleIcon } from './Icons';

interface NoticeProps {
  id: number;
  text: string;
  onDismiss: (id: number) => void;
  durationMs?: number;
}

export const Notice = React.memo(({ id, text, onDismiss, durationMs = 4500 }: NoticeProps) => {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    enter.setValue(0);
    const animation = Animated.timing(enter, { toValue: 1, duration: 260, useNativeDriver: true });
    animation.start();
    const timer = setTimeout(() => onDismiss(id), durationMs);
    return () => {
      animation.stop();
      clearTimeout(timer);
    };
  }, [id, durationMs, enter, onDismiss]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-scaledPixels(24), 0] }) }],
        },
      ]}
    >
      <SparkleIcon size={scaledPixels(30)} color={colors.accent} />
      <Text style={styles.text}>{text}</Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: scaledPixels(safeZones.titleSafe.vertical),
    alignSelf: 'center',
    maxWidth: scaledPixels(1200),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scaledPixels(32),
    paddingVertical: scaledPixels(18),
    borderRadius: radii.pill,
    backgroundColor: colors.scrimStrong,
    borderWidth: scaledPixels(2),
    borderColor: 'rgba(255, 181, 71, 0.5)',
    zIndex: 40,
  },
  text: {
    ...type.body,
    color: colors.text,
    marginLeft: scaledPixels(14),
    flexShrink: 1,
  },
});
