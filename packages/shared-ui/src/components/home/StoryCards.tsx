import React, { useCallback, useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { IdeaView } from '@storyquest/contracts';
import { colors, radii, space, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { resolveMediaUrl } from '../../api/media';
import { audienceFact, formatPlays, moodLabel } from '../../story/format';
import { Focusable, FocusFrame, FocusScale } from '../Focusable';
import { Icon } from '../Icons';
import { Placeholder } from '../Placeholder';
import { WaitingDots } from '../WaitingDots';

export const CARD_WIDTH = scaledPixels(340);
export const CARD_HEIGHT = Math.round((CARD_WIDTH * 9) / 16);
export const CARD_GAP = scaledPixels(32);

interface IdeaCardProps {
  idea: IdeaView;
  index: number;
  opening: boolean;
  onFocusIndex: (index: number) => void;
  onSelectIdea: (idea: IdeaView) => void;
}

function ideaHint(idea: IdeaView): string {
  const parts = [idea.logline, ...idea.moods.map(moodLabel), audienceFact(idea.audience), formatPlays(idea.plays)];
  if (!idea.ready) parts.push('Getting ready');
  return parts.join('. ');
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
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>Getting ready</Text>
                  </View>
                )}
                {opening && (
                  <View style={styles.opening}>
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

interface MakeYourOwnCardProps {
  paused: boolean;
  onFocusIndex: (index: number) => void;
  onSelect: () => void;
}

export const MakeYourOwnCard = React.memo(({ paused, onFocusIndex, onSelect }: MakeYourOwnCardProps) => {
  const focus = useCallback(() => onFocusIndex(0), [onFocusIndex]);
  return (
    <Focusable
      label="Make your own"
      hint={paused ? 'Paused. New stories are paused right now' : 'Describe a story and we will film the first scene'}
      position={1}
      altLabels={MAKE_ALT_LABELS}
      onSelect={onSelect}
      onFocus={focus}
      style={styles.slot}
    >
      {(focused) => (
        <View style={styles.column}>
          <FocusScale focused={focused}>
            <View style={[styles.card, styles.makeCard]}>
              {focused && <FocusFrame radius={radii.card} />}
              <Icon name="pen" size={48} color={paused ? colors.paperDim : colors.paper} />
              {paused && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>Paused</Text>
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
    borderColor: colors.inkLine,
    backgroundColor: colors.inkRaised,
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
    backgroundColor: colors.ink,
  },
  tagText: {
    ...type.small,
    color: colors.paperDim,
  },
  opening: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
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
    borderColor: colors.ink,
  },
  makeCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
