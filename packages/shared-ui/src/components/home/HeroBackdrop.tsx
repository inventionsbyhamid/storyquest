import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';
import { Gradient, fade } from '../Gradient';
import { useMotion } from '../Motion';

interface Layer {
  key: number;
  uri: string | null;
}

const KenBurnsLayer = React.memo(
  ({ uri, onShown }: { uri: string | null; onShown: () => void }) => {
    const opacity = useRef(new Animated.Value(0)).current;
    const zoom = useRef(new Animated.Value(0)).current;
    const source = useRef(uri ? { uri } : null).current;
    const active = useMotion();

    useEffect(() => {
      if (!active) return;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(zoom, {
            toValue: 1,
            duration: 16000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(zoom, {
            toValue: 0,
            duration: 16000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
            isInteraction: false,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }, [zoom, active]);

    const reveal = useCallback(() => {
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }).start(({ finished }) => {
        if (finished) onShown();
      });
    }, [opacity, onShown]);

    useEffect(() => {
      if (!source) reveal();
    }, [source, reveal]);

    const transform = [
      { scale: zoom.interpolate({ inputRange: [0, 1], outputRange: [1.02, 1.12] }) },
      { translateX: zoom.interpolate({ inputRange: [0, 1], outputRange: [0, -24] }) },
    ];

    return (
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        {source ? (
          <Animated.Image
            source={source}
            onLoad={reveal}
            onError={reveal}
            resizeMode="cover"
            fadeDuration={0}
            style={[StyleSheet.absoluteFill, { transform }]}
          />
        ) : (
          <View style={styles.placeholder}>
            <Gradient style={StyleSheet.absoluteFill} direction="right" stops={fade(colors.secondary, 0.05, 0.45)} />
          </View>
        )}
      </Animated.View>
    );
  },
  (prev, next) => prev.uri === next.uri,
);

const LEFT_SCRIM = [
  { offset: 0, color: colors.background, opacity: 1 },
  { offset: 0.38, color: colors.background, opacity: 0.9 },
  { offset: 0.72, color: colors.background, opacity: 0.38 },
  { offset: 1, color: colors.background, opacity: 0 },
];

const BOTTOM_SCRIM = [
  { offset: 0, color: colors.background, opacity: 0 },
  { offset: 0.4, color: colors.background, opacity: 0.6 },
  { offset: 0.72, color: colors.background, opacity: 0.96 },
  { offset: 1, color: colors.background, opacity: 1 },
];

const TOP_SCRIM = fade(colors.background, 0, 0.7);

let layerSeq = 0;

export const HeroBackdrop = React.memo(({ uri }: { uri: string | null }) => {
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: ++layerSeq, uri }]);

  useEffect(() => {
    setLayers((current) => {
      if (current[current.length - 1]?.uri === uri) return current;
      return [...current.slice(-1), { key: ++layerSeq, uri }];
    });
  }, [uri]);

  const dropOlder = useCallback((key: number) => {
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.key === key);
      return index > 0 ? current.slice(index) : current;
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {layers.map((layer) => (
        <KenBurnsLayer key={layer.key} uri={layer.uri} onShown={() => dropOlder(layer.key)} />
      ))}
      <Gradient style={styles.left} direction="right" stops={LEFT_SCRIM} />
      <Gradient style={styles.bottom} direction="down" stops={BOTTOM_SCRIM} />
      <Gradient style={styles.top} direction="up" stops={TOP_SCRIM} />
    </View>
  );
});

const styles = StyleSheet.create({
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.backgroundRaised,
  },
  left: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '68%',
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
  },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '18%',
  },
});
