import React, { useCallback, useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { IdeaView, StorySummary } from '@storyquest/contracts';
import { colors, radii, space, type, useTone } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { resolveMediaUrl } from '../../api/media';
import { audienceFact, formatPlays, moodLabel } from '../../story/format';
import { Focusable, FocusFrame, FocusScale } from '../Focusable';
import { Icon } from '../Icons';
import { Placeholder } from '../Placeholder';
import { WaitingDots } from '../WaitingDots';
import { isWatchOnly, ON_FIRE_TV } from '../../platform/watchOnly';

export const CARD_WIDTH = scaledPixels(380);
export const CARD_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);
export const CARD_GAP = scaledPixels(32);

interface IdeaCardProps {
  idea: IdeaView;
  index: number;
  position: number;
  opening: boolean;
  onFocusIndex: (index: number) => void;
  onSelectIdea: (idea: IdeaView) => void;
}

function ideaHint(idea: IdeaView): string {
  const parts = [idea.logline, ...idea.moods.map(moodLabel), audienceFact(idea.audience), formatPlays(idea.plays)];
  if (!idea.ready) parts.push('Getting ready');
  return parts.join('. ');
}

export const IdeaCard = React.memo(({ idea, index, position, opening, onFocusIndex, onSelectIdea }: IdeaCardProps) => {
  const tone = useTone();
  const poster = resolveMediaUrl(idea.posterUrl);
  const source = useMemo(() => (poster ? { uri: poster } : null), [poster]);
  const focus = useCallback(() => onFocusIndex(index), [index, onFocusIndex]);
  const select = useCallback(() => onSelectIdea(idea), [idea, onSelectIdea]);

  return (
    <Focusable
      label={idea.title}
      hint={ideaHint(idea)}
      position={position}
      onSelect={select}
      onFocus={focus}
      style={styles.slot}
    >
      {(focused) => (
        <View style={styles.column}>
          <FocusScale focused={focused}>
            <View style={[styles.card, focused && styles.cardFocused]}>
              {focused && <FocusFrame radius={radii.card} />}
              <View style={styles.clip}>
                {source ? (
                  <Image source={source} style={styles.image} resizeMode="cover" fadeDuration={0} />
                ) : (
                  <Placeholder />
                )}
                {!idea.ready && (
                  <View style={[styles.tag, { backgroundColor: tone.night }]}>
                    <Text style={styles.tagText}>Getting ready</Text>
                  </View>
                )}
                {opening && (
                  <View style={[styles.opening, { backgroundColor: tone.scrim }]}>
                    <WaitingDots />
                  </View>
                )}
              </View>
            </View>
          </FocusScale>
          <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={1}>
            {idea.title}
          </Text>
        </View>
      )}
    </Focusable>
  );
});

export function storyProgress(story: StorySummary): string {
  return story.status === 'finished' ? 'Finished' : `Chapter ${story.chapter} of ${story.totalChapters}`;
}

interface ContinueCardProps {
  story: StorySummary;
  index: number;
  position: number;
  onFocusIndex: (index: number) => void;
  onSelectStory: (story: StorySummary) => void;
}

/** One of this TV's own stories, picked up where the family left it. */
export const ContinueCard = React.memo(({ story, index, position, onFocusIndex, onSelectStory }: ContinueCardProps) => {
  const tone = useTone();
  const source = useMemo(() => (story.posterUrl ? { uri: story.posterUrl } : null), [story.posterUrl]);
  const focus = useCallback(() => onFocusIndex(index), [index, onFocusIndex]);
  const select = useCallback(() => onSelectStory(story), [story, onSelectStory]);
  const progress = storyProgress(story);
  return (
    <Focusable
      label={`Continue ${story.title}`}
      hint={story.status === 'finished' ? 'Finished. Watch it again or share it' : progress}
      position={position}
      onSelect={select}
      onFocus={focus}
      style={styles.slot}
    >
      {(focused) => (
        <View style={styles.column}>
          <FocusScale focused={focused}>
            <View style={[styles.card, focused && styles.cardFocused]}>
              {focused && <FocusFrame radius={radii.card} />}
              <View style={styles.clip}>
                {source ? (
                  <Image source={source} style={styles.image} resizeMode="cover" fadeDuration={0} />
                ) : (
                  <Placeholder />
                )}
                <View style={[styles.tag, { backgroundColor: tone.night }]}>
                  <Text style={styles.tagText}>{progress}</Text>
                </View>
              </View>
            </View>
          </FocusScale>
          <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={1}>
            {story.title}
          </Text>
        </View>
      )}
    </Focusable>
  );
});

interface MakeYourOwnCardProps {
  paused: boolean;
  position: number;
  onFocusIndex: (index: number) => void;
  onSelect: () => void;
}

export const MakeYourOwnCard = React.memo(({ paused, position, onFocusIndex, onSelect }: MakeYourOwnCardProps) => {
  const tone = useTone();
  const focus = useCallback(() => onFocusIndex(0), [onFocusIndex]);
  return (
    <Focusable
      label="Make your own"
      hint={paused ? (isWatchOnly() ? ON_FIRE_TV : "Paused. New stories can't be filmed right now") : 'Describe a story and we will film the first scene'}
      position={position}
      altLabels={MAKE_ALT_LABELS}
      onSelect={onSelect}
      onFocus={focus}
      style={styles.slot}
    >
      {(focused) => (
        <View style={styles.column}>
          <FocusScale focused={focused}>
            <View style={[styles.card, styles.makeCard, focused && styles.cardFocused]}>
              {focused && <FocusFrame radius={radii.card} />}
              <Icon name="pen" size={48} color={paused ? colors.paperDim : colors.paper} />
              {paused && (
                <View style={[styles.tag, { backgroundColor: tone.night }]}>
                  <Text style={styles.tagText}>{isWatchOnly() ? 'On Fire TV' : 'Paused'}</Text>
                </View>
              )}
            </View>
          </FocusScale>
          <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={1}>
            Make your own
          </Text>
        </View>
      )}
    </Focusable>
  );
});

const MAKE_ALT_LABELS = ['Make my own', 'Create a story', 'New story'];

const styles = StyleSheet.create({
  slot: {
    marginRight: CARD_GAP,
  },
  column: {
    width: CARD_WIDTH,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radii.card,
    borderWidth: scaledPixels(2),
    borderColor: colors.surfaceLine,
    backgroundColor: colors.surface,
  },
  clip: {
    flex: 1,
    borderRadius: radii.card - scaledPixels(2),
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  tag: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: scaledPixels(4),
    borderRadius: radii.image,
  },
  tagText: {
    ...type.small,
    color: colors.paperDim,
  },
  opening: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...type.label,
    fontWeight: '400',
    color: colors.paperDim,
    marginTop: space.sm,
  },
  titleFocused: {
    color: colors.paper,
  },
  cardFocused: {
    borderColor: 'transparent',
  },
  makeCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
