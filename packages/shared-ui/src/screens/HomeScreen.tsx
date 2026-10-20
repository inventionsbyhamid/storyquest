import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import {
  DefaultFocus,
  SpatialNavigationRoot,
  SpatialNavigationScrollView,
  SpatialNavigationView,
} from 'react-tv-space-navigation';
import type { IdeaView, TodayResponse } from '@storyquest/contracts';
import { api, isAbortError, resolveMediaUrl, toApiError } from '../api';
import { audienceFact, formatPlays, moodLabel } from '../story/format';
import { messageForError } from '../story/messages';
import { ToneContext, colors, radii, screen, space, toneFor, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { prefetchImage } from '../utils/prefetch';
import { isFilmingPaused, reportFilmingPaused } from '../budget/filming';
import { useFilmingPaused } from '../budget/useFilmingPaused';
import { Brand } from '../components/Brand';
import { Button } from '../components/Button';
import { Billboard } from '../components/home/Billboard';
import { CARD_GAP, CARD_HEIGHT, CARD_WIDTH, IdeaCard, MakeYourOwnCard } from '../components/home/StoryCards';
import { MotionContext } from '../components/Motion';
import { Notice } from '../components/Notice';
import { SkeletonBlock, usePulse } from '../components/Skeleton';
import { WalletText } from '../components/sparks/WalletText';
import type { ScreenNavigation } from '../navigation/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; today: TodayResponse }
  | { status: 'error'; message: string };

// The hero text settles in when the focused story changes.
const FadeIn = ({ children }: { children: React.ReactNode }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
};

interface StoryTextProps {
  idea: IdeaView | null;
  empty: boolean;
  paused: boolean;
}

const StoryText = React.memo(({ idea, empty, paused }: StoryTextProps) => {
  if (!idea && paused) {
    return (
      <View>
        <Text style={styles.title} numberOfLines={2}>
          {empty ? 'No stories tonight yet' : 'Make your own'}
        </Text>
        <Text style={styles.logline} numberOfLines={2}>
          {empty ? messageForError('internal', 'today') : messageForError('budget_exhausted', 'start')}
        </Text>
      </View>
    );
  }
  if (!idea) {
    return (
      <View>
        <Text style={styles.title} numberOfLines={2}>
          {empty ? 'No stories tonight yet' : 'Make your own'}
        </Text>
        <Text style={styles.logline} numberOfLines={2}>
          {empty
            ? "Make your own story while tonight's stories are being made."
            : 'Describe a story with the remote microphone or the keyboard, and we film the first scene.'}
        </Text>
      </View>
    );
  }
  const facts = [...idea.moods.map(moodLabel), audienceFact(idea.audience), formatPlays(idea.plays)];
  if (!idea.ready) facts.push('Getting ready');
  return (
    <View>
      <Text style={styles.title} numberOfLines={2}>
        {idea.title}
      </Text>
      <Text style={styles.logline} numberOfLines={2}>
        {idea.logline}
      </Text>
      <View style={styles.facts}>
        {facts.map((fact) => (
          <Text key={fact} style={styles.fact}>
            {fact}
          </Text>
        ))}
      </View>
    </View>
  );
});

const HomeSkeleton = () => {
  const pulse = usePulse();
  return (
    <>
      <View style={styles.text}>
        <SkeletonBlock pulse={pulse} style={[styles.line, { width: scaledPixels(640), height: scaledPixels(76) }]} />
        <SkeletonBlock pulse={pulse} style={[styles.line, { width: scaledPixels(720), height: scaledPixels(30) }]} />
        <SkeletonBlock pulse={pulse} style={[styles.line, { width: scaledPixels(520), height: scaledPixels(30) }]} />
      </View>
      <SkeletonBlock pulse={pulse} style={styles.skeletonBillboard} />
      <View style={styles.rowArea}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>Tonight's stories</Text>
        </View>
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
  paused: boolean;
}

const StoryRow = React.memo(
  ({ ideas, openingId, onFocusIndex, onSelectIdea, onMakeYourOwn, paused }: StoryRowProps) => (
    <View style={styles.rowArea}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>Tonight's stories</Text>
        <WalletText />
      </View>
      <SpatialNavigationScrollView
        horizontal
        offsetFromStart={screen.side + CARD_WIDTH + CARD_GAP}
        style={styles.scroll}
      >
        <SpatialNavigationView direction="horizontal" style={styles.rowContent}>
          <DefaultFocus enable={ideas.length === 0}>
            <MakeYourOwnCard paused={paused} onFocusIndex={onFocusIndex} onSelect={onMakeYourOwn} />
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
  ),
);

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
        reportFilmingPaused(today.filmingPaused);
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
  const filmingPaused = useFilmingPaused();
  const makeYourOwn = useCallback(() => {
    if (isFilmingPaused()) setNotice({ id: Date.now(), text: messageForError('budget_exhausted', 'start') });
    else navigation.navigate('Create');
  }, [navigation]);

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
          tone: idea.tone ?? null,
          origin: { ideaId: idea.id },
          audience: story.audience,
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
  const billboardUri = focusedIdea ? resolveMediaUrl(focusedIdea.posterUrl) : null;
  const tone = useMemo(() => toneFor(focusedIdea?.tone), [focusedIdea?.tone]);

  return (
    <SpatialNavigationRoot isActive={isFocused} key={load.status}>
      <MotionContext.Provider value={isFocused}>
        <ToneContext.Provider value={tone}>
          <View style={styles.screen}>
            {load.status === 'ready' && <Billboard uri={billboardUri} page={!focusedIdea} night={tone.night} />}
            <View style={styles.header}>
              <Brand />
              {load.status !== 'ready' && <WalletText />}
            </View>

            {load.status === 'loading' && <HomeSkeleton />}

            {load.status === 'error' && (
              <View style={[styles.text, styles.errorText]}>
                <Text style={styles.title} numberOfLines={1}>
                  The stories did not load
                </Text>
                <Text style={styles.logline}>{load.message}</Text>
                <DefaultFocus>
                  <Button label="Try again" primary onSelect={retry} style={styles.retry} />
                </DefaultFocus>
              </View>
            )}

            {load.status === 'ready' && (
              <>
                <View style={styles.hero}>
                  <FadeIn key={focusedIdea?.id ?? 'make'}>
                    <StoryText idea={focusedIdea} empty={ideas.length === 0} paused={filmingPaused} />
                  </FadeIn>
                </View>
                <StoryRow
                  ideas={ideas}
                  openingId={openingId}
                  onFocusIndex={setFocusedIndex}
                  onSelectIdea={openIdea}
                  onMakeYourOwn={makeYourOwn}
                  paused={filmingPaused}
                />
              </>
            )}

            {notice && <Notice id={notice.id} text={notice.text} onDismiss={dismissNotice} raised />}
          </View>
        </ToneContext.Provider>
      </MotionContext.Provider>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
    overflow: 'hidden',
  },
  header: {
    position: 'absolute',
    top: screen.top,
    left: screen.side,
    right: screen.side,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skeletonBillboard: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: scaledPixels(1040),
    height: scaledPixels(585),
    borderBottomLeftRadius: radii.plate,
  },
  text: {
    position: 'absolute',
    top: scaledPixels(240),
    left: screen.side,
    width: scaledPixels(720),
  },
  hero: {
    position: 'absolute',
    top: scaledPixels(150),
    left: screen.side,
    width: scaledPixels(720),
    height: scaledPixels(440),
    justifyContent: 'flex-end',
  },
  title: {
    ...type.display,
    color: colors.paper,
  },
  logline: {
    ...type.body,
    color: colors.paper,
    marginTop: space.md,
  },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.md,
  },
  fact: {
    ...type.body,
    color: colors.paperDim,
    marginRight: space.lg,
  },
  errorText: {
    width: scaledPixels(1400),
  },
  retry: {
    marginTop: space.xl,
  },
  rowArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: scaledPixels(636),
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: screen.side,
    marginBottom: space.xs,
  },
  rowTitle: {
    ...type.heading,
    color: colors.paper,
  },
  scroll: {
    flexGrow: 0,
  },
  rowContent: {
    paddingLeft: screen.side,
    paddingRight: screen.side,
    paddingVertical: space.md,
  },
  skeletonRow: {
    flexDirection: 'row',
  },
  skeletonCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radii.card,
    marginRight: CARD_GAP,
  },
  line: {
    borderRadius: radii.image,
    marginBottom: space.md,
  },
});
