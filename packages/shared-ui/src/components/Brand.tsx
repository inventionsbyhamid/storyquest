import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, DISPLAY_FONT, space } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Mark } from './Mark';

export const Brand = React.memo(() => (
  <View style={styles.row} accessible accessibilityLabel="StoryQuest">
    <Mark size={44} />
    <Text style={styles.word}>StoryQuest</Text>
  </View>
));

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  word: {
    fontFamily: DISPLAY_FONT,
    fontSize: scaledPixels(40),
    lineHeight: scaledPixels(50),
    letterSpacing: -0.5,
    color: colors.paper,
    marginLeft: space.sm,
  },
});
