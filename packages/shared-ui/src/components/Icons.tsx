import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme';
import { scaledPixels } from '../hooks/useScale';

export type IconName = 'pen' | 'mic' | 'play' | 'pause' | 'restart' | 'home' | 'plus' | 'check' | 'back';

// Drawn on a 24 unit grid; the stroke is kept at 2.5 design pixels whatever the size.
const PATHS: Record<IconName, string[]> = {
  pen: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  mic: ['M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3z', 'M5.5 11.5a6.5 6.5 0 0 0 13 0', 'M12 18v3'],
  play: ['M8 5.5v13l10.5-6.5z'],
  pause: ['M8 5v14', 'M16 5v14'],
  restart: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4.5v4h4'],
  home: ['M4 11l8-7 8 7', 'M6.5 9.5V20h11V9.5'],
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  back: ['M19 12H5', 'M11 6l-6 6 6 6'],
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export const Icon = React.memo(({ name, size = 28, color = colors.paper }: IconProps) => (
  <Svg width={scaledPixels(size)} height={scaledPixels(size)} viewBox="0 0 24 24" fill="none">
    {PATHS[name].map((d) => (
      <Path key={d} d={d} stroke={color} strokeWidth={(2.5 * 24) / size} strokeLinecap="round" strokeLinejoin="round" />
    ))}
  </Svg>
));

// The Spark: a plain marigold coin. Amounts are written next to it.
export const SparkCoin = React.memo(({ size = 20 }: { size?: number }) => (
  <Svg width={scaledPixels(size)} height={scaledPixels(size)} viewBox="0 0 20 20">
    <Circle cx={10} cy={10} r={10} fill={colors.marigold} />
  </Svg>
));
