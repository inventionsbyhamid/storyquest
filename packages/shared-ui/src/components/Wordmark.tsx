import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { SparkleIcon } from './Icons';

export const Wordmark = React.memo(({ size = 34 }: { size?: number }) => (
  <View style={styles.row} accessible accessibilityLabel="StoryQuest">
    <SparkleIcon size={scaledPixels(size * 1.1)} color={colors.accent} />
    <Text style={[styles.text, { fontSize: scaledPixels(size), lineHeight: scaledPixels(size * 1.2) }]}>
      Story<Text style={styles.accent}>Quest</Text>
    </Text>
  </View>
));

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    marginLeft: scaledPixels(10),
    color: colors.text,
    fontWeight: '800',
    letterSpacing: scaledPixels(1),
  },
  accent: {
    color: colors.accent,
  },
});
