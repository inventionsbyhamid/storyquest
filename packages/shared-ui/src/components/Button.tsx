import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radii, space, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Focusable, FocusFrame, FocusScale } from './Focusable';
import { Icon, IconName } from './Icons';

interface ButtonProps {
  label: string;
  onSelect: () => void;
  onFocus?: () => void;
  hint?: string;
  icon?: IconName;
  primary?: boolean;
  // A quiet text action with no fill, for things like reporting.
  plain?: boolean;
  block?: boolean;
  style?: ViewStyle;
}

// Primary: marigold with ink text, one per screen. Others sit on raised ink.
export const Button = React.memo(
  ({ label, onSelect, onFocus, hint, icon, primary, plain, block, style }: ButtonProps) => (
    <Focusable label={label} hint={hint} onSelect={onSelect} onFocus={onFocus} style={style}>
      {(focused) => {
        const textColor = primary ? colors.ink : plain && !focused ? colors.paperDim : colors.paper;
        return (
          <FocusScale focused={focused}>
            <View
              style={[
                styles.button,
                primary ? styles.primary : plain ? styles.plain : styles.quiet,
                block && styles.block,
              ]}
            >
              {focused && <FocusFrame radius={radii.card} />}
              {icon ? (
                <View style={styles.icon}>
                  <Icon name={icon} size={28} color={textColor} />
                </View>
              ) : null}
              <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
                {label}
              </Text>
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
    minHeight: scaledPixels(72),
    paddingHorizontal: space.lg,
    borderRadius: radii.card,
    borderWidth: scaledPixels(2),
  },
  primary: {
    backgroundColor: colors.marigold,
    borderColor: colors.marigold,
  },
  quiet: {
    backgroundColor: colors.inkRaised,
    borderColor: colors.inkLine,
  },
  plain: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  block: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  icon: {
    marginRight: space.sm,
  },
  label: {
    ...type.label,
    fontSize: scaledPixels(28),
    lineHeight: scaledPixels(36),
  },
});
