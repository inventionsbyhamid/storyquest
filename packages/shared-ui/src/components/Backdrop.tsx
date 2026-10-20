import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { EdgeFade } from './EdgeFade';

interface Layer {
  key: number;
  color: string;
}

let layerSeq = 0;

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface LayerProps {
  color: string;
  alpha: number;
  fadeTop: number;
  instant: boolean;
  duration: number;
  onShown: () => void;
}

const ColorLayer = React.memo(({ color, alpha, fadeTop, instant, duration, onShown }: LayerProps) => {
  const opacity = useRef(new Animated.Value(instant ? 1 : 0)).current;
  useEffect(() => {
    if (instant) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => {
      if (finished) onShown();
    });
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      {fadeTop > 0 && (
        <EdgeFade color={color} from="bottom" opacity={alpha} style={[styles.fade, { height: fadeTop }]} />
      )}
      <View style={[styles.fill, { top: fadeTop, backgroundColor: rgba(color, alpha) }]} />
    </Animated.View>
  );
});

interface BackdropProps {
  // A #RRGGBB night.
  color: string;
  alpha?: number;
  // A soft edge of this height at the top, where the panel meets a picture.
  fadeTop?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

// A night color that fades into the next one when it changes.
export const Backdrop = React.memo(({ color, alpha = 1, fadeTop = 0, duration = 450, style }: BackdropProps) => {
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: ++layerSeq, color }]);
  const initialKey = useRef(layers[0]!.key).current;

  useEffect(() => {
    setLayers((current) => {
      const top = current[current.length - 1];
      if (top && top.color === color) return current;
      return [...current.slice(-2), { key: ++layerSeq, color }];
    });
  }, [color]);

  const dropBelow = useCallback((key: number) => {
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.key === key);
      return index > 0 ? current.slice(index) : current;
    });
  }, []);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {layers.map((layer) => (
        <ColorLayer
          key={layer.key}
          color={layer.color}
          alpha={alpha}
          fadeTop={fadeTop}
          instant={layer.key === initialKey}
          duration={duration}
          onShown={() => dropBelow(layer.key)}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  fade: {
    top: 0,
    left: 0,
    right: 0,
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
