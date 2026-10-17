import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SpatialNavigationFocusableView } from 'react-tv-space-navigation';
import { colors } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { voiceProps } from './voiceProps';

interface FocusableProps {
  label: string;
  hint?: string;
  position?: number;
  altLabels?: string[];
  onSelect?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: ViewStyle;
  children: (focused: boolean) => React.ReactElement;
}

// Every focusable gets a short spoken name: screen readers read it and Vega voice navigation
// matches "Alexa, select ..." against it.
export function Focusable({
  label,
  hint,
  position,
  altLabels,
  onSelect,
  onFocus,
  onBlur,
  style,
  children,
}: FocusableProps) {
  const altKey = altLabels?.join('|');
  const viewProps = useMemo(
    () => ({
      accessibilityLabel: label,
      'aria-label': label,
      accessibilityHint: hint,
      ...voiceProps({ position, altLabels }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [label, hint, position, altKey],
  );
  return (
    <SpatialNavigationFocusableView
      onSelect={onSelect}
      onFocus={onFocus}
      onBlur={onBlur}
      style={style}
      viewProps={viewProps}
    >
      {({ isFocused }) => children(isFocused)}
    </SpatialNavigationFocusableView>
  );
}

interface FocusScaleProps {
  focused: boolean;
  scale?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function FocusScale({ focused, scale = 1.06, style, children }: FocusScaleProps) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [focused, progress]);

  const animatedStyle = useMemo(
    () => ({ transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }) }] }),
    [progress, scale],
  );

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

export function FocusGlow({ radius }: { radius: number }) {
  return <View pointerEvents="none" style={[styles.glow, { borderRadius: radius + scaledPixels(10) }]} />;
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: -scaledPixels(10),
    left: -scaledPixels(10),
    right: -scaledPixels(10),
    bottom: -scaledPixels(10),
    borderWidth: scaledPixels(6),
    borderColor: colors.accentGlow,
  },
});
