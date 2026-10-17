import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, space, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Focusable, FocusFrame, FocusScale } from './Focusable';
import { Icon } from './Icons';

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
          <View style={styles.chip}>
            {focused && <FocusFrame radius={radii.card} />}
            {selected && (
              <View style={styles.check}>
                <Icon name="check" size={24} />
              </View>
            )}
            <Text style={styles.label}>{label}</Text>
          </View>
        </FocusScale>
      )}
    </Focusable>
  );
}

export const Chip = React.memo(ChipInner) as typeof ChipInner;

const styles = StyleSheet.create({
  slot: {
    marginRight: space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: scaledPixels(64),
    paddingHorizontal: space.md,
    borderRadius: radii.card,
    backgroundColor: colors.inkRaised,
    borderWidth: scaledPixels(2),
    borderColor: colors.inkLine,
  },
  check: {
    marginRight: space.xs,
  },
  label: {
    ...type.body,
    color: colors.paper,
  },
});
