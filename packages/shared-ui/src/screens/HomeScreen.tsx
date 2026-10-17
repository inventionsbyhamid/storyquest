import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import {
  DefaultFocus,
  SpatialNavigationRoot,
  SpatialNavigationScrollView,
  SpatialNavigationView,
} from 'react-tv-space-navigation';
import type { IdeaView, TodayResponse } from '@storyquest/contracts';
import { api, isAbortError, resolveMediaUrl, toApiError } from '../api';
import { audienceLabel, formatPlays, moodLabel } from '../story/format';
import { messageForError } from '../story/messages';
import { colors, safeZones, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { prefetchImage } from '../utils/prefetch';
import { Button } from '../components/Button';
import { HeroBackdrop } from '../components/home/HeroBackdrop';
import { CARD_GAP, CARD_HEIGHT, CARD_WIDTH, IdeaCard, MakeYourOwnCard } from '../components/home/StoryCards';
import { PeopleIcon, SparkleIcon } from '../components/Icons';
import { MotionContext } from '../components/Motion';
import { Notice } from '../components/Notice';
import { Pill } from '../components/Pill';
import { SkeletonBlock, usePulse } from '../components/Skeleton';
import { Wordmark } from '../components/Wordmark';
import type { ScreenNavigation } from '../navigation/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; today: TodayResponse }
  | { status: 'error'; message: string };

const SIDE = scaledPixels(safeZones.titleSafe.horizontal);

const HeroText = React.memo(({ idea }: { idea: IdeaView | null }) => {
  if (!idea) {
    return (
      <View style={styles.heroText}>
        <Pill text="Your idea" tone="violet" icon={<SparkleIcon size={scaledPixels(22)} color="#CFC7FF" />} />
        <Text style={styles.heroTitle}>Make your own story</Text>
        <Text style={styles.heroLogline} numberOfLines={3}>
          Tell us what you feel like watching. Say it with the remote microphone or type it, and we will film the first
          scene for your family.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.heroText}>
      <View style={styles.tags}>
        <Pill text={audienceLabel(idea.audience)} tone="accent" style={styles.tag} />
        {idea.moods.map((mood) => (
          <Pill key={mood} text={moodLabel(mood)} style={styles.tag} />
        ))}
        {!idea.ready && <Pill text="Warming up" tone="violet" style={styles.tag} />}
      </View>
      <Text style={styles.heroTitle} numberOfLines={2}>
        {idea.title}
      </Text>
      <Text style={styles.heroLogline} numberOfLines={3}>
        {idea.logline}
      </Text>
      <View style={styles.plays}>
        <PeopleIcon size={scaledPixels(32)} color={colors.accent} />
        <Text style={styles.playsText}>{formatPlays(idea.plays)}</Text>
      </View>
    </View>
  );
});

const HomeSkeleton = () => {
  const pulse = usePulse();
  return (
    <>
      <View style={styles.heroText}>
        <SkeletonBlock
          pulse={pulse}
          style={[styles.skeletonLine, { width: scaledPixels(260), height: scaledPixels(36) }]}
        />
        <SkeletonBlock
          pulse={pulse}
          style={[styles.skeletonLine, { width: scaledPixels(820), height: scaledPixels(64) }]}
        />
        <SkeletonBlock
          pulse={pulse}
          style={[styles.skeletonLine, { width: scaledPixels(760), height: scaledPixels(32) }]}
        />
        <SkeletonBlock
          pulse={pulse}
          style={[styles.skeletonLine, { width: scaledPixels(600), height: scaledPixels(32) }]}
        />
      </View>
      <View style={styles.rowArea}>
        <Text style={styles.rowTitle}>Tonight's Stories</Text>
        <View style={[styles.rowContent, styles.skeletonRow]}>
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} pulse={pulse} style={styles.skeletonCard} />
          ))}
        </View>
      </View>
    </>
  );
};

interface StoryRowProps {
  ideas: IdeaView[];
  openingId: string | null;
  onFocusIndex: (index: number) => void;
  onSelectIdea: (idea: IdeaView) => void;
  onMakeYourOwn: () => void;
}

const StoryRow = React.memo(({ ideas, openingId, onFocusIndex, onSelectIdea, onMakeYourOwn }: StoryRowProps) => (
  <View style={styles.rowArea}>
    <Text style={styles.rowTitle}>Tonight's Stories</Text>
    <SpatialNavigationScrollView horizontal offsetFromStart={SIDE + CARD_WIDTH + CARD_GAP} style={styles.scroll}>
      <SpatialNavigationView direction="horizontal" style={styles.rowContent}>
        <DefaultFocus enable={ideas.length === 0}>
          <MakeYourOwnCard onFocusIndex={onFocusIndex} onSelect={onMakeYourOwn} />
        </DefaultFocus>
        {ideas.map((idea, i) => (
          <DefaultFocus key={idea.id} enable={i === 0}>
            <IdeaCard
              idea={idea}
              index={i + 1}
              opening={openingId === idea.id}
              onFocusIndex={onFocusIndex}
              onSelectIdea={onSelectIdea}
            />
          </DefaultFocus>
        ))}
      </SpatialNavigationView>
    </SpatialNavigationScrollView>
  </View>
));

export default function HomeScreen() {
  const navigation = useNavigation<ScreenNavigation<'Home'>>();
  const isFocused = useIsFocused();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(1);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const opening = useRef(false);
  const hasIdeas = load.status === 'ready';

  // Loads on first visit and on retry; refreshes quietly whenever the family comes back home.
  useEffect(() => {
    if (!isFocused) return;
    const controller = new AbortController();
    const quiet = hasIdeas;
    if (!quiet) setLoad({ status: 'loading' });
    api
      .getToday({ signal: controller.signal })
      .then((today) => {
        today.ideas.forEach((idea) => prefetchImage(resolveMediaUrl(idea.posterUrl)));
        setLoad({ status: 'ready', today });
      })
      .catch((error) => {
        if (isAbortError(error) || quiet) return;
        setLoad({ status: 'error', message: messageForError(toApiError(error).code, 'today') });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, isFocused]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const makeYourOwn = useCallback(() => navigation.navigate('Create'), [navigation]);

  const openIdea = useCallback(
    async (idea: IdeaView) => {
      if (opening.current) return;
      opening.current = true;
      setOpeningId(idea.id);
      try {
        const story = await api.startStory({ kind: 'idea', ideaId: idea.id });
        navigation.navigate('Story', {
          storyId: story.id,
          title: story.title,
          nodeId: story.currentNodeId,
          posterUrl: resolveMediaUrl(idea.posterUrl),
          origin: { ideaId: idea.id },
        });
      } catch (error) {
        setNotice({ id: Date.now(), text: messageForError(toApiError(error).code, 'start') });
      } finally {
        opening.current = false;
        setOpeningId(null);
      }
    },
    [navigation],
  );

  const ideas = load.status === 'ready' ? load.today.ideas : [];
  const focusedIdea = focusedIndex > 0 ? (ideas[focusedIndex - 1] ?? null) : null;
  const heroPoster = focusedIdea ? resolveMediaUrl(focusedIdea.posterUrl) : null;

  return (
    <SpatialNavigationRoot isActive={isFocused} key={load.status}>
      <MotionContext.Provider value={isFocused}>
        <View style={styles.screen}>
          <HeroBackdrop uri={load.status === 'ready' ? heroPoster : null} />
          <View style={styles.header}>
            <Wordmark />
          </View>

          {load.status === 'loading' && <HomeSkeleton />}

          {load.status === 'error' && (
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>Tonight's stories are hiding</Text>
              <Text style={styles.heroLogline}>{load.message}</Text>
              <DefaultFocus>
                <Button label="Try again" variant="primary" onSelect={retry} style={styles.retry} />
              </DefaultFocus>
            </View>
          )}

          {load.status === 'ready' && (
            <>
              <HeroText idea={focusedIdea} />
              <StoryRow
                ideas={ideas}
                openingId={openingId}
                onFocusIndex={setFocusedIndex}
                onSelectIdea={openIdea}
                onMakeYourOwn={makeYourOwn}
              />
            </>
          )}

          {notice && <Notice id={notice.id} text={notice.text} onDismiss={dismissNotice} />}
        </View>
      </MotionContext.Provider>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  header: {
    position: 'absolute',
    top: scaledPixels(safeZones.titleSafe.vertical),
    left: SIDE,
  },
  heroText: {
    position: 'absolute',
    top: scaledPixels(176),
    left: SIDE,
    width: scaledPixels(940),
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    marginRight: scaledPixels(12),
    marginBottom: scaledPixels(8),
  },
  heroTitle: {
    ...type.hero,
    color: colors.text,
    marginTop: scaledPixels(18),
  },
  heroLogline: {
    ...type.bodyLarge,
    color: colors.textMuted,
    marginTop: scaledPixels(18),
  },
  plays: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaledPixels(24),
  },
  playsText: {
    ...type.body,
    color: colors.text,
    marginLeft: scaledPixels(12),
  },
  retry: {
    marginTop: scaledPixels(36),
  },
  rowArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: scaledPixels(safeZones.titleSafe.vertical + 6),
  },
  rowTitle: {
    ...type.heading,
    color: colors.text,
    marginLeft: SIDE,
    marginBottom: scaledPixels(22),
  },
  scroll: {
    flexGrow: 0,
  },
  rowContent: {
    paddingLeft: SIDE,
    paddingRight: SIDE,
    paddingVertical: scaledPixels(18),
  },
  skeletonRow: {
    flexDirection: 'row',
  },
  skeletonCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: scaledPixels(20),
    marginRight: CARD_GAP,
    marginBottom: scaledPixels(56),
  },
  skeletonLine: {
    borderRadius: scaledPixels(12),
    marginBottom: scaledPixels(20),
  },
});
