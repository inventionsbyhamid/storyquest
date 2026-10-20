import React, { useRef } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// An eased curve rather than a straight line, so the fade has no visible band where it starts.
const STOPS: Array<[number, number]> = [
  [0, 1],
  [0.19, 0.738],
  [0.34, 0.541],
  [0.47, 0.382],
  [0.565, 0.278],
  [0.65, 0.194],
  [0.73, 0.126],
  [0.802, 0.075],
  [0.861, 0.042],
  [0.91, 0.021],
  [0.952, 0.008],
  [0.982, 0.002],
  [1, 0],
];

const VECTORS = {
  left: { x1: '0', y1: '0', x2: '1', y2: '0' },
  right: { x1: '1', y1: '0', x2: '0', y2: '0' },
  top: { x1: '0', y1: '0', x2: '0', y2: '1' },
  bottom: { x1: '0', y1: '1', x2: '0', y2: '0' },
};

let fadeSeq = 0;

interface EdgeFadeProps {
  color: string;
  // The side that is fully covered; the fade clears toward the opposite side.
  from: keyof typeof VECTORS;
  opacity?: number;
  // Where it sits; absolute, so give it its edges and size.
  style: StyleProp<ViewStyle>;
}

// Lets a picture melt into the color around it, the only place gradients are used.
export const EdgeFade = React.memo(({ color, from, opacity = 1, style }: EdgeFadeProps) => {
  const id = useRef(`fade${++fadeSeq}`).current;
  return (
    <View pointerEvents="none" style={[styles.box, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} {...VECTORS[from]}>
            {STOPS.map(([offset, alpha]) => (
              <Stop key={offset} offset={offset} stopColor={color} stopOpacity={alpha * opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
  },
});
