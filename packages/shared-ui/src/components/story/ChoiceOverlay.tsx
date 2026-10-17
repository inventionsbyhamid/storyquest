import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { ChoiceView, SceneView } from '@storyquest/contracts';
import { resolveMediaUrl } from '../../api/media';
import { formatSceneProgress } from '../../story/format';
import { formatSparks } from '../../purchases/format';
import { colors, radii, space, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { Focusable, FocusFrame, FocusScale } from '../Focusable';
import { Icon } from '../Icons';
import { Placeholder } from '../Placeholder';
import { CostTag } from '../sparks/WalletText';

const CARD_WIDTH = scaledPixels(380);
const CARD_PADDING = scaledPixels(16);
const THUMB_WIDTH = CARD_WIDTH - CARD_PADDING * 2 - scaledPixels(4);
const THUMB_HEIGHT = Math.round((THUMB_WIDTH * 9) / 16);
const RISE = scaledPixels(24);

interface ChoiceCardProps {
  choice: ChoiceView;
  closed: boolean;
  freeSparks: number;
  onChoose: (index: number) => void;
  onFocusChoice: (index: number | null) => void;
}

function choiceHint(choice: ChoiceView, closed: boolean): string | undefined {
  if (closed) return 'This path could not be made';
  const parts: string[] = [];
  if (choice.sparks > 0) parts.push(`Uses ${formatSparks(choice.sparks)}`);
  if (!choice.ready && choice.nodeId) parts.push('Still being drawn. You can pick it and wait');
  return parts.length ? parts.join('. ') : undefined;
}

const ChoiceCard = React.memo(({ choice, closed, freeSparks, onChoose, onFocusChoice }: ChoiceCardProps) => {
  const costs = choice.sparks > freeSparks;
  const poster = resolveMediaUrl(choice.posterUrl);
  const source = useMemo(() => (poster ? { uri: poster } : null), [poster]);
  const select = useCallback(() => onChoose(choice.index), [choice.index, onChoose]);
  const focus = useCallback(() => onFocusChoice(choice.index), [choice.index, onFocusChoice]);
  const blur = useCallback(() => onFocusChoice(null), [onFocusChoice]);

  return (
    <Focusable
      label={choice.label}
      hint={choiceHint(choice, closed)}
      position={choice.index + 1}
      onSelect={select}
      onFocus={focus}
      onBlur={blur}
    >
      {(focused) => (
        <FocusScale focused={focused}>
          <View style={[styles.card, focused && styles.cardFocused, closed && styles.closed]}>
            {focused && <FocusFrame radius={radii.card} />}
            <View style={styles.thumb}>
              {source ? (
                <Image source={source} style={styles.image} resizeMode="cover" fadeDuration={0} />
              ) : (
                <Placeholder style={styles.placeholder} />
              )}
              {closed ? (
                <View style={styles.status}>
                  <Text style={styles.statusText}>Closed</Text>
                </View>
              ) : !choice.ready && choice.nodeId ? (
                <View style={styles.status}>
                  <Text style={styles.statusText}>Drawing</Text>
                </View>
              ) : null}
              {!closed && costs && (
                <View style={styles.cost}>
                  <CostTag sparks={choice.sparks} />
                </View>
              )}
            </View>
            <View style={styles.text}>
              <Text style={styles.label} numberOfLines={2}>
                {choice.label}
              </Text>
            </View>
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
  onSelect: () => void;
  onFocusChoice: (index: number | null) => void;
}

const SomethingElseCard = React.memo(({ position, cost, onSelect, onFocusChoice }: SomethingElseProps) => (
  <Focusable
    label="Something else"
    hint={cost > 0 ? `Say it or type it. Uses ${formatSparks(cost)}` : 'Say it or type it'}
    position={position}
    altLabels={ELSE_ALT_LABELS}
    onSelect={onSelect}
    onFocus={() => onFocusChoice(null)}
  >
    {(focused) => (
      <FocusScale focused={focused}>
        <View style={[styles.card, focused && styles.cardFocused]}>
          {focused && <FocusFrame radius={radii.card} />}
          <View style={[styles.thumb, styles.elseThumb]}>
            <Icon name="pen" size={56} />
            {cost > 0 && (
              <View style={styles.cost}>
                <CostTag sparks={cost} />
              </View>
            )}
          </View>
          <View style={styles.text}>
            <Text style={styles.label} numberOfLines={1}>
              Something else
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              Say it or type it
            </Text>
          </View>
        </View>
      </FocusScale>
    )}
  </Focusable>
));

interface ChoiceOverlayProps {
  scene: SceneView;
  closedChoices: number[];
  customCost: number;
  freeSparks: number;
  active: boolean;
  onChoose: (index: number) => void;
  onSomethingElse: () => void;
  onFocusChoice: (index: number | null) => void;
}

// The choice dock: the last frame stays above, a solid panel fills the bottom, and the cards
// rise in one after another. This is the only orchestrated motion in the app.
export function ChoiceOverlay({
  scene,
  closedChoices,
  customCost,
  freeSparks,
  active,
  onChoose,
  onSomethingElse,
  onFocusChoice,
}: ChoiceOverlayProps) {
  const panel = useRef(new Animated.Value(0)).current;
  const cards = useRef(Array.from({ length: 4 }, () => new Animated.Value(0))).current;

  useEffect(() => {
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

  const firstOpen = scene.choices.find((choice) => !closedChoices.includes(choice.index))?.index ?? -1;

  return (
    <SpatialNavigationRoot isActive={active}>
      <Animated.View
        style={[styles.dock, { opacity: panel }]}
        accessibilityLabel={`What happens next? ${formatSceneProgress(scene.sceneNumber, scene.totalScenes)}`}
      >
        <Text style={styles.heading}>What happens next?</Text>
        <SpatialNavigationView direction="horizontal" style={styles.row}>
          {scene.choices.map((choice, i) => (
            <Animated.View key={choice.index} style={[styles.slot, rise(cards[Math.min(i, 3)])]}>
              <DefaultFocus enable={choice.index === firstOpen}>
                <ChoiceCard
                  choice={choice}
                  closed={closedChoices.includes(choice.index)}
                  freeSparks={freeSparks}
                  onChoose={onChoose}
                  onFocusChoice={onFocusChoice}
                />
              </DefaultFocus>
            </Animated.View>
          ))}
          <Animated.View style={[styles.slot, rise(cards[Math.min(scene.choices.length, 3)])]}>
            <DefaultFocus enable={firstOpen === -1}>
              <SomethingElseCard
                position={scene.choices.length + 1}
                cost={customCost > freeSparks ? customCost : 0}
                onSelect={onSomethingElse}
                onFocusChoice={onFocusChoice}
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
    height: '46%',
    backgroundColor: colors.scrim,
    alignItems: 'center',
    paddingTop: space.md,
  },
  heading: {
    ...type.title,
    color: colors.paper,
    marginBottom: space.sm,
  },
  row: {
    justifyContent: 'center',
  },
  slot: {
    marginHorizontal: space.sm,
  },
  card: {
    width: CARD_WIDTH,
    padding: CARD_PADDING,
    borderRadius: radii.card,
    borderWidth: scaledPixels(2),
    borderColor: colors.inkLine,
    backgroundColor: colors.inkRaised,
  },
  cardFocused: {
    borderColor: colors.ink,
  },
  closed: {
    opacity: 0.5,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: radii.image,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
  elseThumb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    height: scaledPixels(80),
    marginTop: space.xs,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    backgroundColor: colors.ink,
  },
  status: {
    position: 'absolute',
    left: space.xs,
    bottom: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: scaledPixels(4),
    borderRadius: radii.image,
    backgroundColor: colors.ink,
  },
  statusText: {
    ...type.small,
    color: colors.paperDim,
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
