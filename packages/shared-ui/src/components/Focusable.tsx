import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SpatialNavigationFocusableView } from 'react-tv-space-navigation';
import { playFocusSound, playUiSound } from '../utils/uiSounds';
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
  const focus = useCallback(() => {
    playFocusSound();
    onFocus?.();
  }, [onFocus]);
  const select = useCallback(() => {
    if (!onSelect) return;
    playUiSound('select');
    onSelect();
  }, [onSelect]);
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
      onSelect={select}
      onFocus={focus}
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
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const FOCUS_SCALE = 1.04;
const FOCUS_MS = 150;

export function FocusScale({ focused, style, children }: FocusScaleProps) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: FOCUS_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [focused, progress]);

  const animatedStyle = useMemo(
    () => ({ transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, FOCUS_SCALE] }) }] }),
    [progress],
  );

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// The focus frame: 4px of marigold drawn 4px outside the element. No shadow, no glow.
export function FocusFrame({ radius }: { radius: number }) {
  return <View pointerEvents="none" style={[styles.frame, { borderRadius: radius + OUTSET }]} />;
}

const OUTSET = scaledPixels(8);

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    top: -OUTSET,
    left: -OUTSET,
    right: -OUTSET,
    bottom: -OUTSET,
    borderWidth: scaledPixels(4),
    borderColor: colors.marigold,
  },
});
