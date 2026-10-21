import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { ChoiceView, SceneView } from '@storyquest/contracts';
import { resolveMediaUrl } from '../../api/media';
import { formatAutoPick } from '../../story/autoPick';
import { playUiSound } from '../../utils/uiSounds';
import { formatSceneProgress } from '../../story/format';
import { formatSparks } from '../../purchases/format';
import { colors, radii, space, toneFor, type, useTone } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { Backdrop } from '../Backdrop';
import { Focusable, FocusFrame, FocusScale } from '../Focusable';
import { Icon } from '../Icons';
import { Placeholder } from '../Placeholder';
import { CostTag } from '../sparks/WalletText';

const CARD_WIDTH = scaledPixels(440);
const THUMB_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);
const RISE = scaledPixels(24);
const DOCK_HEIGHT = scaledPixels(497);
// The last frame melts into the dock over this height instead of meeting a hard line.
const DOCK_FADE = scaledPixels(200);

interface ChoiceCardProps {
  choice: ChoiceView;
  closed: boolean;
  notFilmed: boolean;
  freeSparks: number;
  onChoose: (index: number) => void;
  onFocusChoice: (index: number | null) => void;
}

function choiceHint(choice: ChoiceView, closed: boolean, notFilmed: boolean): string | undefined {
  if (closed) return 'Path closed. Pick another choice';
  if (notFilmed) return 'Not filmed yet. Pick another choice';
  const parts: string[] = [];
  if (choice.sparks > 0) parts.push(`Uses ${formatSparks(choice.sparks)}`);
  if (!choice.ready && choice.nodeId) parts.push('Still being drawn. You can pick it and wait');
  return parts.length ? parts.join('. ') : undefined;
}

const ChoiceCard = React.memo(({ choice, closed, notFilmed, freeSparks, onChoose, onFocusChoice }: ChoiceCardProps) => {
  const tone = useTone();
  const unavailable = closed || notFilmed;
  const costs = !unavailable && choice.sparks > freeSparks;
  const poster = unavailable ? null : resolveMediaUrl(choice.posterUrl);
  const source = useMemo(() => (poster ? { uri: poster } : null), [poster]);
  const select = useCallback(() => onChoose(choice.index), [choice.index, onChoose]);
  const focus = useCallback(() => onFocusChoice(choice.index), [choice.index, onFocusChoice]);
  const blur = useCallback(() => onFocusChoice(null), [onFocusChoice]);

  return (
    <Focusable
      label={choice.label}
      hint={choiceHint(choice, closed, notFilmed)}
      position={choice.index + 1}
      onSelect={select}
      onFocus={focus}
      onBlur={blur}
    >
      {(focused) => (
        <FocusScale focused={focused}>
          <View style={[styles.thumb, focused && styles.thumbFocused]}>
            {focused && <FocusFrame radius={radii.card} />}
            <View style={styles.clip}>
              <View style={[styles.fill, unavailable && styles.closed]}>
                {source ? (
                  <Image source={source} style={styles.image} resizeMode="cover" fadeDuration={0} />
                ) : (
                  <Placeholder />
                )}
              </View>
              {unavailable ? (
                <View style={[styles.status, styles.topRight, { backgroundColor: tone.night }]}>
                  <Text style={styles.statusText}>{closed ? 'Path closed' : 'Not filmed yet'}</Text>
                </View>
              ) : !choice.ready && choice.nodeId ? (
                <View style={[styles.status, styles.bottomLeft, { backgroundColor: tone.night }]}>
                  <Text style={styles.statusText}>Drawing</Text>
                </View>
              ) : null}
              {costs && (
                <View style={styles.cost}>
                  <CostTag sparks={choice.sparks} />
                </View>
              )}
            </View>
          </View>
          <View style={[styles.text, unavailable && styles.closed]}>
            <Text style={styles.label} numberOfLines={2}>
              {choice.label}
            </Text>
          </View>
        </FocusScale>
      )}
    </Focusable>
  );
});

const ELSE_ALT_LABELS = ['My own idea', 'Something different', 'Type my idea'];

interface SomethingElseProps {
  position: number;
  cost: number;
  paused: boolean;
  onSelect: () => void;
  onFocusChoice: (index: number | null) => void;
}

function somethingElseHint(cost: number, paused: boolean): string {
  if (paused) return 'Paused. New scenes are paused right now';
  return cost > 0 ? `Say it or type it. Uses ${formatSparks(cost)}` : 'Say it or type it';
}

const SomethingElseCard = React.memo(({ position, cost, paused, onSelect, onFocusChoice }: SomethingElseProps) => {
  const tone = useTone();
  return (
    <Focusable
      label="Something else"
      hint={somethingElseHint(cost, paused)}
      position={position}
      altLabels={ELSE_ALT_LABELS}
      onSelect={onSelect}
      onFocus={() => onFocusChoice(null)}
    >
      {(focused) => (
        <FocusScale focused={focused}>
          <View style={[styles.thumb, styles.elseThumb, focused && styles.thumbFocused]}>
            {focused && <FocusFrame radius={radii.card} />}
            <View style={paused && styles.closed}>
              <Icon name="pen" size={64} />
            </View>
            {paused ? (
              <View style={[styles.status, styles.topRight, { backgroundColor: tone.night }]}>
                <Text style={styles.statusText}>Paused</Text>
              </View>
            ) : cost > 0 ? (
              <View style={styles.cost}>
                <CostTag sparks={cost} />
              </View>
            ) : null}
          </View>
          <View style={[styles.text, paused && styles.closed]}>
            <Text style={styles.label} numberOfLines={1}>
              Something else
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              Say it or type it
            </Text>
          </View>
        </FocusScale>
      )}
    </Focusable>
  );
});

interface ChoiceOverlayProps {
  scene: SceneView;
  closedChoices: number[];
  notFilmedChoices: number[];
  customPaused: boolean;
  customCost: number;
  freeSparks: number;
  active: boolean;
  /** Seconds until the app picks a filmed choice by itself, or null when it will not. */
  autoPickSeconds: number | null;
  onChoose: (index: number) => void;
  onSomethingElse: () => void;
  onFocusChoice: (index: number | null) => void;
}

// The choice dock: the last frame stays above, a solid panel fills the bottom, and the cards
// rise in one after another. This is the only orchestrated motion in the app. The panel takes
// the night of the focused choice's first picture, so moving between paths hints at their mood.
export function ChoiceOverlay({
  scene,
  closedChoices,
  notFilmedChoices,
  customPaused,
  customCost,
  freeSparks,
  active,
  autoPickSeconds,
  onChoose,
  onSomethingElse,
  onFocusChoice,
}: ChoiceOverlayProps) {
  const tone = useTone();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const focusChoice = useCallback(
    (index: number | null) => {
      setFocusedIndex(index);
      onFocusChoice(index);
    },
    [onFocusChoice],
  );
  const focused = scene.choices.find((choice) => choice.index === focusedIndex);
  const pathTone =
    focused && !closedChoices.includes(focused.index) && !notFilmedChoices.includes(focused.index)
      ? (focused.tone ?? null)
      : null;
  const dockNight = pathTone ? toneFor(pathTone).night : tone.night;
  const panel = useRef(new Animated.Value(0)).current;
  const cards = useRef(Array.from({ length: 4 }, () => new Animated.Value(0))).current;

  useEffect(() => {
    playUiSound('choices');
    const animation = Animated.parallel([
      Animated.timing(panel, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.stagger(
        60,
        cards.map((value) =>
          Animated.timing(value, {
            toValue: 1,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ),
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, [panel, cards]);

  const rise = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) }],
  });

  const firstOpen =
    scene.choices.find((choice) => !closedChoices.includes(choice.index) && !notFilmedChoices.includes(choice.index))
      ?.index ?? -1;

  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View
        style={[styles.dock, { opacity: panel }]}
        accessibilityLabel={`What happens next? ${formatSceneProgress(scene.sceneNumber, scene.totalScenes)}`}
      >
        <Backdrop color={dockNight} alpha={0.92} fadeTop={DOCK_FADE} />
        <Text style={styles.heading}>What happens next?</Text>
        {/* The line keeps its height when the countdown stops, so the cards never jump. */}
        <Text style={styles.countdown} accessibilityElementsHidden={autoPickSeconds === null}>
          {autoPickSeconds !== null ? formatAutoPick(autoPickSeconds) : ' '}
        </Text>
        <SpatialNavigationView direction="horizontal" style={styles.row}>
          {scene.choices.map((choice, i) => (
            <Animated.View key={choice.index} style={[styles.slot, rise(cards[Math.min(i, 3)])]}>
              <DefaultFocus enable={choice.index === firstOpen}>
                <ChoiceCard
                  choice={choice}
                  closed={closedChoices.includes(choice.index)}
                  notFilmed={notFilmedChoices.includes(choice.index)}
                  freeSparks={freeSparks}
                  onChoose={onChoose}
                  onFocusChoice={focusChoice}
                />
              </DefaultFocus>
            </Animated.View>
          ))}
          <Animated.View style={[styles.slot, rise(cards[Math.min(scene.choices.length, 3)])]}>
            <DefaultFocus enable={firstOpen === -1}>
              <SomethingElseCard
                position={scene.choices.length + 1}
                cost={customCost > freeSparks ? customCost : 0}
                paused={customPaused}
                onSelect={onSomethingElse}
                onFocusChoice={focusChoice}
              />
            </DefaultFocus>
          </Animated.View>
        </SpatialNavigationView>
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: DOCK_HEIGHT + DOCK_FADE,
    alignItems: 'center',
    paddingTop: DOCK_FADE + space.sm,
  },
  heading: {
    ...type.title,
    color: colors.paper,
  },
  countdown: {
    ...type.small,
    color: colors.paperDim,
    marginTop: space.xs,
    marginBottom: space.sm,
  },
  row: {
    justifyContent: 'center',
  },
  slot: {
    marginHorizontal: space.sm,
    width: CARD_WIDTH,
  },
  closed: {
    opacity: 0.5,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  thumb: {
    width: CARD_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: radii.card,
    borderWidth: scaledPixels(2),
    borderColor: colors.surfaceLine,
    backgroundColor: colors.surface,
  },
  thumbFocused: {
    borderColor: 'transparent',
  },
  clip: {
    flex: 1,
    borderRadius: radii.card - scaledPixels(2),
    overflow: 'hidden',
  },
  elseThumb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    height: scaledPixels(80),
    marginTop: space.sm,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  status: {
    position: 'absolute',
    paddingHorizontal: space.sm,
    paddingVertical: scaledPixels(4),
    borderRadius: radii.image,
  },
  statusText: {
    ...type.small,
    color: colors.paperDim,
  },
  bottomLeft: {
    left: space.xs,
    bottom: space.xs,
  },
  topRight: {
    top: space.xs,
    right: space.xs,
  },
  cost: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
  },
  label: {
    ...type.body,
    color: colors.paper,
  },
  sub: {
    ...type.small,
    color: colors.paperDim,
  },
});
