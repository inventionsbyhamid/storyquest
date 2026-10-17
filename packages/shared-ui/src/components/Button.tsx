import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radii, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Focusable, FocusGlow, FocusScale } from './Focusable';

interface ButtonProps {
  label: string;
  onSelect: () => void;
  onFocus?: () => void;
  hint?: string;
  detail?: string;
  icon?: (color: string) => React.ReactNode;
  variant?: 'primary' | 'quiet';
  dimmed?: boolean;
  block?: boolean;
  style?: ViewStyle;
}

export const Button = React.memo(
  ({
    label,
    onSelect,
    onFocus,
    hint,
    detail,
    icon,
    variant = 'quiet',
    dimmed = false,
    block = false,
    style,
  }: ButtonProps) => (
    <Focusable label={label} hint={hint ?? detail} onSelect={onSelect} onFocus={onFocus} style={style}>
      {(focused) => {
        const textColor = focused ? colors.textOnAccent : colors.text;
        return (
          <FocusScale focused={focused}>
            <View
              style={[
                styles.button,
                block && styles.block,
                variant === 'primary' && styles.primary,
                dimmed && !focused && styles.dimmed,
                focused && styles.focused,
              ]}
            >
              {focused && <FocusGlow radius={radii.pill} />}
              {icon ? <View style={styles.icon}>{icon(textColor)}</View> : null}
              <View>
                <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
                  {label}
                </Text>
                {detail ? (
                  <Text style={[styles.detail, focused && styles.detailFocused]} numberOfLines={1}>
                    {detail}
                  </Text>
                ) : null}
              </View>
            </View>
          </FocusScale>
        );
      }}
    </Focusable>
  ),
);

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: scaledPixels(76),
    paddingHorizontal: scaledPixels(40),
    paddingVertical: scaledPixels(14),
    borderRadius: radii.pill,
    backgroundColor: 'rgba(246, 241, 233, 0.1)',
    borderWidth: scaledPixels(3),
    borderColor: 'transparent',
  },
  block: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.surfaceHigh,
    borderColor: 'rgba(255, 181, 71, 0.55)',
  },
  dimmed: {
    opacity: 0.6,
  },
  focused: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  icon: {
    marginRight: scaledPixels(16),
  },
  label: {
    ...type.label,
    fontSize: scaledPixels(30),
  },
  detail: {
    ...type.meta,
    color: colors.textMuted,
    fontWeight: '500',
  },
  detailFocused: {
    color: colors.textOnAccent,
  },
});
