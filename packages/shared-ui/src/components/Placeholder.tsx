import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { Mark } from './Mark';

// Stands in for a missing picture: raised ink with the mark drawn in the line color.
export const Placeholder = React.memo(({ style, size = 40 }: { style?: ViewStyle; size?: number }) => (
  <View style={[styles.box, style]}>
    <Mark size={size} color={colors.inkLine} />
  </View>
));

const styles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inkRaised,
  },
});
