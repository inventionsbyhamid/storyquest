import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, DISPLAY_FONT, space } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { Mark } from './Mark';

// In a browser the name links back to the StoryQuest website, which serves this app at /play.
const goToWebsite = () => (globalThis as unknown as { location: { assign: (url: string) => void } }).location.assign('/');

export const Brand = React.memo(() => {
  const content = (
    <>
      <Mark size={44} />
      <Text style={styles.word}>StoryQuest</Text>
    </>
  );
  if (Platform.OS === 'web') {
    return (
      <Pressable style={[styles.row, styles.link]} accessibilityRole="link" accessibilityLabel="StoryQuest website" onPress={goToWebsite}>
        {content}
      </Pressable>
    );
  }
  return (
    <View style={styles.row} accessible accessibilityLabel="StoryQuest">
      {content}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: {
    alignSelf: 'flex-start',
    cursor: 'pointer',
  } as ViewStyle,
  word: {
    fontFamily: DISPLAY_FONT,
    fontSize: scaledPixels(40),
    lineHeight: scaledPixels(50),
    letterSpacing: -0.5,
    color: colors.paper,
    marginLeft: space.sm,
  },
});
