import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radii, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';

type Tone = 'neutral' | 'accent' | 'violet' | 'dark';

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: 'rgba(246, 241, 233, 0.1)', fg: colors.text, border: 'rgba(246, 241, 233, 0.16)' },
  accent: { bg: colors.accentSoft, fg: colors.accent, border: 'rgba(255, 181, 71, 0.4)' },
  violet: { bg: colors.secondarySoft, fg: '#CFC7FF', border: 'rgba(140, 123, 255, 0.45)' },
  dark: { bg: 'rgba(11, 13, 26, 0.78)', fg: colors.text, border: 'rgba(246, 241, 233, 0.18)' },
};

export const Pill = React.memo(
  ({
    text,
    tone = 'neutral',
    icon,
    style,
  }: {
    text: string;
    tone?: Tone;
    icon?: React.ReactNode;
    style?: ViewStyle;
  }) => {
    const palette = TONES[tone];
    return (
      <View style={[styles.pill, { backgroundColor: palette.bg, borderColor: palette.border }, style]}>
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <Text style={[styles.text, { color: palette.fg }]} numberOfLines={1}>
          {text}
        </Text>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: scaledPixels(18),
    paddingVertical: scaledPixels(6),
    borderRadius: radii.pill,
    borderWidth: scaledPixels(2),
  },
  icon: {
    marginRight: scaledPixels(8),
  },
  text: {
    ...type.meta,
  },
});
