import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { EdgeFade } from '../EdgeFade';
import { Icon } from '../Icons';
import { Mark } from '../Mark';

export const BILLBOARD_WIDTH = scaledPixels(1200);
export const BILLBOARD_HEIGHT = Math.round((BILLBOARD_WIDTH * 9) / 16);

interface Scene {
  key: number;
  uri: string | null;
  page: boolean;
  night: string;
}

const FADE_MS = 350;
let sceneSeq = 0;

// One full screen layer: the story's night, its poster in the top right, and soft edges where
// the poster meets the night. Color and picture change together, so there is never a seam.
const SceneLayer = React.memo(
  ({ uri, page, night, instant, onShown }: Omit<Scene, 'key'> & { instant: boolean; onShown: () => void }) => {
    const opacity = useRef(new Animated.Value(instant ? 1 : 0)).current;
    const source = useRef(uri ? { uri } : null).current;
    const revealed = useRef(instant);

    const reveal = useCallback(() => {
      if (revealed.current) return;
      revealed.current = true;
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) onShown();
      });
    }, [opacity, onShown]);

    useEffect(() => {
      if (!source) reveal();
    }, [source, reveal]);

    return (
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: night, opacity }]}>
        <View style={styles.picture}>
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
              <Icon name="pen" size={120} color={colors.paperDim} />
            </View>
          ) : (
            <View style={styles.page}>
              <Mark size={120} color={colors.surfaceLine} />
            </View>
          )}
          <EdgeFade color={night} from="left" style={styles.leftFade} />
          <EdgeFade color={night} from="bottom" style={styles.bottomFade} />
        </View>
      </Animated.View>
    );
  },
  (prev, next) => prev.uri === next.uri && prev.page === next.page && prev.night === next.night,
);

interface BillboardProps {
  uri: string | null;
  // A blank page with a pen, for "Make your own".
  page?: boolean;
  night: string;
}

// The home backdrop, like a streaming app's hero: the focused story's poster runs off the top
// and right edges and melts into that story's night. Changes cross fade.
export const Billboard = React.memo(({ uri, page = false, night }: BillboardProps) => {
  const [scenes, setScenes] = useState<Scene[]>(() => [{ key: ++sceneSeq, uri, page, night }]);
  const initialKey = useRef(scenes[0]!.key).current;

  useEffect(() => {
    setScenes((current) => {
      const top = current[current.length - 1];
      if (top && top.uri === uri && top.page === page && top.night === night) return current;
      return [...current.slice(-1), { key: ++sceneSeq, uri, page, night }];
    });
  }, [uri, page, night]);

  const dropOlder = useCallback((key: number) => {
    setScenes((current) => {
      const index = current.findIndex((scene) => scene.key === key);
      return index > 0 ? current.slice(index) : current;
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {scenes.map((scene) => (
        <SceneLayer
          key={scene.key}
          uri={scene.uri}
          page={scene.page}
          night={scene.night}
          instant={scene.key === initialKey && !scene.uri}
          onShown={() => dropOlder(scene.key)}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  picture: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: BILLBOARD_WIDTH,
    height: BILLBOARD_HEIGHT,
    overflow: 'hidden',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  leftFade: {
    top: 0,
    bottom: 0,
    left: 0,
    width: '42%',
  },
  bottomFade: {
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
  },
});
