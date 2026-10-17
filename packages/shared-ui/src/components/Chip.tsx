import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, radii, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Focusable, FocusGlow, FocusScale } from './Focusable';

interface ChipProps<T extends string> {
  value: T;
  label: string;
  selected: boolean;
  onToggle: (value: T) => void;
  group: string;
}

function ChipInner<T extends string>({ value, label, selected, onToggle, group }: ChipProps<T>) {
  const select = useCallback(() => onToggle(value), [onToggle, value]);
  return (
    <Focusable label={label} hint={selected ? `${group}, selected` : group} onSelect={select} style={styles.slot}>
      {(focused) => (
        <FocusScale focused={focused}>
          <View style={[styles.chip, selected && styles.selected, focused && styles.focused]}>
            {focused && <FocusGlow radius={radii.pill} />}
            {selected && (
              <Svg width={scaledPixels(26)} height={scaledPixels(26)} viewBox="0 0 24 24" style={styles.check}>
                <Path
                  d="M5 12.5l4.2 4.2L19 7"
                  stroke={focused ? colors.textOnAccent : colors.accent}
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            )}
            <Text style={[styles.label, selected && styles.labelSelected, focused && styles.labelFocused]}>
              {label}
            </Text>
          </View>
        </FocusScale>
      )}
    </Focusable>
  );
}

export const Chip = React.memo(ChipInner) as typeof ChipInner;

const styles = StyleSheet.create({
  slot: {
    marginRight: scaledPixels(20),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: scaledPixels(68),
    paddingHorizontal: scaledPixels(30),
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: scaledPixels(3),
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(255, 181, 71, 0.7)',
  },
  focused: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  check: {
    marginRight: scaledPixels(10),
  },
  label: {
    ...type.label,
    color: colors.textMuted,
  },
  labelSelected: {
    color: colors.text,
  },
  labelFocused: {
    color: colors.textOnAccent,
  },
});
