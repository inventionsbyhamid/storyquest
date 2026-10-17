import React, { useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

type Direction = 'down' | 'up' | 'right' | 'left';

const VECTORS: Record<Direction, [string, string, string, string]> = {
  down: ['0', '0', '0', '1'],
  up: ['0', '1', '0', '0'],
  right: ['0', '0', '1', '0'],
  left: ['1', '0', '0', '0'],
};

let gradientSeq = 0;

interface GradientProps {
  stops: GradientStop[];
  direction?: Direction;
  style?: StyleProp<ViewStyle>;
}

export const Gradient = React.memo(({ stops, direction = 'down', style }: GradientProps) => {
  const id = useRef(`sqg${++gradientSeq}`).current;
  const [x1, y1, x2, y2] = VECTORS[direction];
  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
            {stops.map((stop) => (
              <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});

export function fade(color: string, from: number, to: number, start = 0, end = 1): GradientStop[] {
  return [
    { offset: start, color, opacity: from },
    { offset: start + (end - start) * 0.55, color, opacity: from + (to - from) * 0.7 },
    { offset: end, color, opacity: to },
  ];
}
