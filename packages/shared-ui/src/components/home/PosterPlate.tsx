import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radii } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { Icon } from '../Icons';
import { Placeholder } from '../Placeholder';

interface Layer {
  key: number;
  uri: string | null;
  page: boolean;
}

const FADE_MS = 200;
let layerSeq = 0;

const Layer = React.memo(
  ({ uri, page, onShown }: { uri: string | null; page: boolean; onShown: () => void }) => {
    const opacity = useRef(new Animated.Value(0)).current;
    const source = useRef(uri ? { uri } : null).current;

    const reveal = useCallback(() => {
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) onShown();
      });
    }, [opacity, onShown]);

    useEffect(() => {
      if (!source) reveal();
    }, [source, reveal]);

    return (
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        {source ? (
          <Animated.Image
            source={source}
            onLoad={reveal}
            onError={reveal}
            resizeMode="cover"
            fadeDuration={0}
            style={StyleSheet.absoluteFill}
          />
        ) : page ? (
          <View style={styles.page}>
            <Icon name="pen" size={88} color={colors.ink} />
          </View>
        ) : (
          <Placeholder size={72} />
        )}
      </Animated.View>
    );
  },
  (prev, next) => prev.uri === next.uri && prev.page === next.page,
);

interface PosterPlateProps {
  uri: string | null;
  // A blank page with a pen, for "Make your own".
  page?: boolean;
  style?: ViewStyle;
}

// The focused story's poster, framed in paper like a plate in a book. Changes cross fade.
export const PosterPlate = React.memo(({ uri, page = false, style }: PosterPlateProps) => {
  const [layers, setLayers] = useState<Layer[]>(() => [{ key: ++layerSeq, uri, page }]);

  useEffect(() => {
    setLayers((current) => {
      const top = current[current.length - 1];
      if (top && top.uri === uri && top.page === page) return current;
      return [...current.slice(-1), { key: ++layerSeq, uri, page }];
    });
  }, [uri, page]);

  const dropOlder = useCallback((key: number) => {
    setLayers((current) => {
      const index = current.findIndex((layer) => layer.key === key);
      return index > 0 ? current.slice(index) : current;
    });
  }, []);

  return (
    <View style={[styles.frame, style]} pointerEvents="none">
      <View style={styles.picture}>
        {layers.map((layer) => (
          <Layer key={layer.key} uri={layer.uri} page={layer.page} onShown={() => dropOlder(layer.key)} />
        ))}
      </View>
    </View>
  );
});

const FRAME = scaledPixels(10);

const styles = StyleSheet.create({
  frame: {
    padding: FRAME,
    borderRadius: radii.plate,
    backgroundColor: colors.paper,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  picture: {
    flex: 1,
    borderRadius: radii.plate - FRAME,
    overflow: 'hidden',
    backgroundColor: colors.paper,
  },
});
