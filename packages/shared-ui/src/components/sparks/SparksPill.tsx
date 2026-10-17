import React from 'react';
import { ViewStyle } from 'react-native';
import { colors } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { useSparks, walletLabel } from '../../purchases';
import { SparkleIcon } from '../Icons';
import { Pill } from '../Pill';

export const SparksPill = React.memo(({ style }: { style?: ViewStyle }) => {
  const { wallet } = useSparks();
  if (!wallet) return null;
  return (
    <Pill
      text={walletLabel(wallet)}
      tone="accent"
      icon={<SparkleIcon size={scaledPixels(24)} color={colors.accent} />}
      style={style}
    />
  );
});

export const CostBadge = React.memo(({ sparks }: { sparks: number }) => (
  <Pill text={String(sparks)} tone="dark" icon={<SparkleIcon size={scaledPixels(22)} color={colors.accent} />} />
));
