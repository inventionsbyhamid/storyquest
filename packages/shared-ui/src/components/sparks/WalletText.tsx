import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radii, space, type, useTone } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { formatSparks, useSparks, walletLabel } from '../../purchases';
import { SparkCoin } from '../Icons';
import { isWatchOnly } from '../../platform/watchOnly';

// The wallet as plain text with the coin, for screen headers.
export const WalletText = React.memo(({ style }: { style?: ViewStyle }) => {
  const { wallet } = useSparks();
  if (!wallet || isWatchOnly()) return null;
  const label = walletLabel(wallet);
  return (
    <View style={[styles.row, style]} accessible accessibilityLabel={label}>
      <SparkCoin size={22} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
});

// What a card costs, on a small solid night tag. Only shown when it costs something.
export const CostTag = React.memo(({ sparks }: { sparks: number }) => {
  const tone = useTone();
  return (
    <View style={[styles.tag, { backgroundColor: tone.night }]}>
      <SparkCoin size={18} />
      <Text style={styles.tagText}>{formatSparks(sparks)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    ...type.body,
    color: colors.paper,
    marginLeft: space.xs + scaledPixels(4),
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: scaledPixels(6),
    borderRadius: radii.image,
  },
  tagText: {
    ...type.small,
    color: colors.paper,
    marginLeft: space.xs,
  },
});
