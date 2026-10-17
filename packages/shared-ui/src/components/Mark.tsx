import React from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { colors } from '../theme';
import { scaledPixels } from '../hooks/useScale';

// The forked Q from assets/brand/mark.svg.
export const Mark = React.memo(({ size = 44, color = colors.marigold }: { size?: number; color?: string }) => (
  <Svg width={scaledPixels(size)} height={scaledPixels(size)} viewBox="0 0 120 120">
    <G fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={50} cy={50} r={34} strokeWidth={12} />
      <Path d="M58 62 C66 70 72 76 80 82" strokeWidth={12} />
      <Path d="M80 82 C88 86 96 86 106 80" strokeWidth={8} />
      <Path d="M80 82 C84 90 84 98 80 108" strokeWidth={8} />
    </G>
    <Circle cx={107} cy={79} r={7} fill={color} />
    <Circle cx={79.5} cy={109} r={7} fill={color} />
  </Svg>
));
