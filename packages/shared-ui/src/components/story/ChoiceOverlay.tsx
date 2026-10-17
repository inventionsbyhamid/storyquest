import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { ChoiceView, SceneView } from '@storyquest/contracts';
import { resolveMediaUrl } from '../../api/media';
import { formatSceneProgress } from '../../story/format';
import { colors, radii, safeZones, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { Focusable, FocusGlow, FocusScale } from '../Focusable';
import { Gradient } from '../Gradient';
import { MicIcon, PencilIcon, SparkleIcon } from '../Icons';
import { Pill } from '../Pill';
import { WaitingDots } from '../WaitingDots';

const CARD_WIDTH = scaledPixels(500);
const THUMB_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);

const SCRIM = [
  { offset: 0, color: colors.background, opacity: 0 },
  { offset: 0.35, color: colors.background, opacity: 0.55 },
  { offset: 0.7, color: colors.background, opacity: 0.88 },
  { offset: 1, color: colors.background, opacity: 0.96 },
];

const PLACEHOLDER = [
  { offset: 0, color: colors.secondary, opacity: 0.5 },
  { offset: 1, color: colors.background, opacity: 0.9 },
];

interface ChoiceCardProps {
  choice: ChoiceView;
  closed: boolean;
  onChoose: (index: number) => void;
}

function choiceHint(choice: ChoiceView, closed: boolean): string | undefined {
  if (closed) return 'This path is closed';
  return choice.ready ? undefined : 'Still being drawn. You can pick it and wait';
}

const ChoiceCard = React.memo(({ choice, closed, onChoose }: ChoiceCardProps) => {
  const poster = resolveMediaUrl(choice.posterUrl);
  const source = useMemo(() => (poster ? { uri: poster } : null), [poster]);
  const select = useCallback(() => onChoose(choice.index), [choice.index, onChoose]);

  return (
    <Focusable
      label={choice.label}
      hint={choiceHint(choice, closed)}
      position={choice.index + 1}
      onSelect={select}
      style={styles.slot}
    >
      {(focused) => (
        <FocusScale focused={focused} style={[styles.card, closed && styles.closed]}>
          <View style={[styles.thumb, focused && styles.thumbFocused]}>
            {focused && <FocusGlow radius={radii.lg} />}
            <View style={styles.thumbClip}>
              {source ? (
                <Image source={source} style={styles.image} resizeMode="cover" fadeDuration={0} />
              ) : (
                <View style={styles.placeholder}>
                  <Gradient style={StyleSheet.absoluteFill} direction="down" stops={PLACEHOLDER} />
                  <SparkleIcon size={scaledPixels(72)} color="rgba(246, 241, 233, 0.75)" />
                </View>
              )}
              {closed ? (
                <View style={styles.badge}>
                  <Pill text="Path closed" tone="dark" />
                </View>
              ) : !choice.ready ? (
                <View style={styles.badge}>
                  <Pill text="Drawing" tone="dark" icon={<WaitingDots size={8} />} />
                </View>
              ) : null}
            </View>
          </View>
          <Text style={[styles.label, focused && styles.labelFocused]} numberOfLines={2}>
            {choice.label}
          </Text>
        </FocusScale>
      )}
    </Focusable>
  );
});

const ELSE_ALT_LABELS = ['My own idea', 'Something different', 'Type my idea'];

const SomethingElseCard = React.memo(({ position, onSelect }: { position: number; onSelect: () => void }) => (
  <Focusable
    label="Something else"
    hint="Say or type your own idea"
    position={position}
    altLabels={ELSE_ALT_LABELS}
    onSelect={onSelect}
    style={styles.slot}
  >
    {(focused) => (
      <FocusScale focused={focused} style={styles.card}>
        <View style={[styles.thumb, styles.elseThumb, focused && styles.thumbFocused]}>
          {focused && <FocusGlow radius={radii.lg} />}
          <View style={[styles.elseIcon, focused && styles.elseIconFocused]}>
            <PencilIcon size={scaledPixels(56)} color={focused ? colors.textOnAccent : colors.text} />
          </View>
          <View style={styles.elseHint}>
            <MicIcon size={scaledPixels(26)} color={colors.textMuted} />
            <Text style={styles.elseHintText}>Say or type your own idea</Text>
          </View>
        </View>
        <Text style={[styles.label, focused && styles.labelFocused]} numberOfLines={2}>
          Something else
        </Text>
      </FocusScale>
    )}
  </Focusable>
));

interface ChoiceOverlayProps {
  scene: SceneView;
  closedChoices: number[];
  active: boolean;
  onChoose: (index: number) => void;
  onSomethingElse: () => void;
}

export function ChoiceOverlay({ scene, closedChoices, active, onChoose, onSomethingElse }: ChoiceOverlayProps) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enter]);

  const firstOpen = scene.choices.find((choice) => !closedChoices.includes(choice.index))?.index ?? -1;

  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View style={[styles.overlay, { opacity: enter }]}>
        <Gradient style={StyleSheet.absoluteFill} direction="down" stops={SCRIM} />
        <Animated.View
          style={[
            styles.content,
            {
              transform: [
                { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [scaledPixels(48), 0] }) },
              ],
            },
          ]}
        >
          <Text style={styles.eyebrow}>{formatSceneProgress(scene.sceneNumber, scene.totalScenes)}</Text>
          <Text style={styles.heading}>What happens next?</Text>
          <SpatialNavigationView direction="horizontal" style={styles.row}>
            {scene.choices.map((choice) => (
              <DefaultFocus key={choice.index} enable={choice.index === firstOpen}>
                <ChoiceCard choice={choice} closed={closedChoices.includes(choice.index)} onChoose={onChoose} />
              </DefaultFocus>
            ))}
            <DefaultFocus enable={firstOpen === -1}>
              <SomethingElseCard position={scene.choices.length + 1} onSelect={onSomethingElse} />
            </DefaultFocus>
          </SpatialNavigationView>
        </Animated.View>
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '78%',
    justifyContent: 'flex-end',
  },
  content: {
    alignItems: 'center',
    paddingBottom: scaledPixels(safeZones.titleSafe.vertical + 6),
  },
  eyebrow: {
    ...type.meta,
    color: colors.accent,
    letterSpacing: scaledPixels(2),
    textTransform: 'uppercase',
  },
  heading: {
    ...type.title,
    color: colors.text,
    marginTop: scaledPixels(6),
    marginBottom: scaledPixels(36),
  },
  row: {
    justifyContent: 'center',
  },
  slot: {
    marginHorizontal: scaledPixels(22),
  },
  card: {
    width: CARD_WIDTH,
  },
  closed: {
    opacity: 0.45,
  },
  thumb: {
    width: CARD_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: radii.lg,
    borderWidth: scaledPixels(4),
    borderColor: 'rgba(246, 241, 233, 0.18)',
    backgroundColor: colors.surface,
  },
  thumbFocused: {
    borderColor: colors.accent,
  },
  thumbClip: {
    flex: 1,
    borderRadius: radii.lg - scaledPixels(4),
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  badge: {
    position: 'absolute',
    left: scaledPixels(16),
    top: scaledPixels(16),
  },
  label: {
    ...type.heading,
    fontSize: scaledPixels(36),
    lineHeight: scaledPixels(44),
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: scaledPixels(18),
  },
  labelFocused: {
    color: colors.text,
  },
  elseThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(140, 123, 255, 0.22)',
    borderColor: 'rgba(140, 123, 255, 0.55)',
  },
  elseIcon: {
    width: scaledPixels(112),
    height: scaledPixels(112),
    borderRadius: scaledPixels(56),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(246, 241, 233, 0.14)',
  },
  elseIconFocused: {
    backgroundColor: colors.accent,
  },
  elseHint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaledPixels(18),
  },
  elseHintText: {
    ...type.meta,
    color: colors.textMuted,
    marginLeft: scaledPixels(8),
  },
});
