import React, { useCallback, useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { IdeaView } from '@storyquest/contracts';
import { colors, radii, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { resolveMediaUrl } from '../../api/media';
import { audienceLabel, formatPlays, moodLabel } from '../../story/format';
import { Focusable, FocusGlow, FocusScale } from '../Focusable';
import { Gradient } from '../Gradient';
import { PlusIcon, SparkleIcon } from '../Icons';
import { Pill } from '../Pill';
import { WaitingDots } from '../WaitingDots';

export const CARD_WIDTH = scaledPixels(372);
export const CARD_HEIGHT = scaledPixels(210);
export const CARD_GAP = scaledPixels(36);

interface IdeaCardProps {
  idea: IdeaView;
  index: number;
  opening: boolean;
  onFocusIndex: (index: number) => void;
  onSelectIdea: (idea: IdeaView) => void;
}

function ideaHint(idea: IdeaView): string {
  const moods = idea.moods.map(moodLabel).join(', ');
  const parts = [idea.logline, `${audienceLabel(idea.audience)} story`, moods, formatPlays(idea.plays)];
  if (!idea.ready) parts.push('Warming up');
  return parts.filter(Boolean).join('. ');
}

export const IdeaCard = React.memo(({ idea, index, opening, onFocusIndex, onSelectIdea }: IdeaCardProps) => {
  const poster = resolveMediaUrl(idea.posterUrl);
  const source = useMemo(() => (poster ? { uri: poster } : null), [poster]);
  const focus = useCallback(() => onFocusIndex(index), [index, onFocusIndex]);
  const select = useCallback(() => onSelectIdea(idea), [idea, onSelectIdea]);

  return (
    <Focusable
      label={idea.title}
      hint={ideaHint(idea)}
      position={index + 1}
      onSelect={select}
      onFocus={focus}
      style={styles.slot}
    >
      {(focused) => (
        <FocusScale focused={focused} style={styles.cardColumn}>
          <View style={[styles.card, focused && styles.cardFocused]}>
            {focused && <FocusGlow radius={radii.md} />}
            <View style={styles.clip}>
              {source ? (
                <Image source={source} style={styles.image} resizeMode="cover" fadeDuration={0} />
              ) : (
                <View style={styles.imageFallback}>
                  <SparkleIcon size={scaledPixels(56)} color={colors.secondary} />
                </View>
              )}
              <Gradient style={styles.cardShade} direction="down" stops={CARD_SHADE} />
              {!idea.ready && (
                <View style={styles.badge}>
                  <Pill text="Warming up" tone="dark" icon={<WaitingDots size={8} />} />
                </View>
              )}
              {opening && (
                <View style={styles.opening}>
                  <WaitingDots />
                </View>
              )}
            </View>
          </View>
          <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={1}>
            {idea.title}
          </Text>
        </FocusScale>
      )}
    </Focusable>
  );
});

export const MakeYourOwnCard = React.memo(
  ({ onFocusIndex, onSelect }: { onFocusIndex: (index: number) => void; onSelect: () => void }) => {
    const focus = useCallback(() => onFocusIndex(0), [onFocusIndex]);
    return (
      <Focusable
        label="Make your own"
        hint="Tell us what you feel like watching and we will film it"
        position={1}
        altLabels={MAKE_ALT_LABELS}
        onSelect={onSelect}
        onFocus={focus}
        style={styles.slot}
      >
        {(focused) => (
          <FocusScale focused={focused} style={styles.cardColumn}>
            <View style={[styles.card, styles.makeCard, focused && styles.cardFocused]}>
              {focused && <FocusGlow radius={radii.md} />}
              <View style={styles.clip}>
                <Gradient style={StyleSheet.absoluteFill} direction="right" stops={MAKE_GRADIENT} />
                <View style={styles.makeContent}>
                  <View style={[styles.plus, focused && styles.plusFocused]}>
                    <PlusIcon size={scaledPixels(44)} color={focused ? colors.textOnAccent : colors.text} />
                  </View>
                  <Text style={styles.makeText}>Your idea, filmed</Text>
                </View>
              </View>
            </View>
            <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={1}>
              Make your own
            </Text>
          </FocusScale>
        )}
      </Focusable>
    );
  },
);

const MAKE_ALT_LABELS = ['Make my own', 'Create a story', 'New story'];

const CARD_SHADE = [
  { offset: 0.55, color: colors.background, opacity: 0 },
  { offset: 1, color: colors.background, opacity: 0.55 },
];

const MAKE_GRADIENT = [
  { offset: 0, color: colors.secondary, opacity: 0.55 },
  { offset: 1, color: colors.accent, opacity: 0.25 },
];

const styles = StyleSheet.create({
  slot: {
    marginRight: CARD_GAP,
  },
  cardColumn: {
    width: CARD_WIDTH,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radii.md,
    borderWidth: scaledPixels(4),
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  cardFocused: {
    borderColor: colors.accent,
  },
  clip: {
    flex: 1,
    borderRadius: radii.md - scaledPixels(4),
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  cardShade: {
    ...StyleSheet.absoluteFillObject,
  },
  badge: {
    position: 'absolute',
    left: scaledPixels(14),
    bottom: scaledPixels(14),
  },
  opening: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...type.label,
    color: colors.textMuted,
    marginTop: scaledPixels(16),
  },
  titleFocused: {
    color: colors.text,
  },
  makeCard: {
    backgroundColor: colors.backgroundRaised,
  },
  makeContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    width: scaledPixels(84),
    height: scaledPixels(84),
    borderRadius: scaledPixels(42),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(246, 241, 233, 0.16)',
    borderWidth: scaledPixels(2),
    borderColor: 'rgba(246, 241, 233, 0.4)',
  },
  plusFocused: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  makeText: {
    ...type.meta,
    color: colors.text,
    marginTop: scaledPixels(12),
  },
});
