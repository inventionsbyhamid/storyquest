import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import {
  DefaultFocus,
  SpatialNavigationRoot,
  SpatialNavigationScrollView,
  SpatialNavigationView,
} from 'react-tv-space-navigation';
import type { IdeaView, StorySummary, TodayResponse } from '@storyquest/contracts';
import { api, isAbortError, resolveMediaUrl, toApiError } from '../api';
import { readHomeCache, saveHomeCache } from '../api/homeCache';
import { retryPatiently } from '../api/patient';
import { markHomeShown } from '../app/homeShown';
import { useAppActive } from '../hooks/useAppActive';
import { isWatchOnly } from '../platform/watchOnly';
import { audienceFact, formatPlays, moodLabel } from '../story/format';
import { messageForError, messages } from '../story/messages';
import { ToneContext, colors, radii, screen, space, toneFor, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { prefetchImage } from '../utils/prefetch';
import { sparks } from '../purchases';
import { isFilmingPaused, reportFilmingPaused } from '../budget/filming';
import { useFilmingPaused } from '../budget/useFilmingPaused';
import { Brand } from '../components/Brand';
import { Button } from '../components/Button';
import { Billboard } from '../components/home/Billboard';
import {
  CARD_GAP,
  CARD_HEIGHT,
  CARD_WIDTH,
  ContinueCard,
  IdeaCard,
  MakeYourOwnCard,
  storyProgress,
} from '../components/home/StoryCards';
import { MotionContext } from '../components/Motion';
import { Notice } from '../components/Notice';
import { SkeletonBlock, usePulse } from '../components/Skeleton';
import { WalletText } from '../components/sparks/WalletText';
import type { ScreenNavigation } from '../navigation/types';
import { warmClip } from '../utils/warmClip';

const MAX_CONTINUE = 4;
// How long Home keeps its skeleton up while it retries, before it explains what is wrong.
const OFFLINE_PATIENCE_MS = 6000;
const PATIENCE_MS = 20000;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; today: TodayResponse }
  | { status: 'error'; offline: boolean; message: string };

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
  story: StorySummary | null;
  empty: boolean;
  paused: boolean;
}

const StoryText = React.memo(({ idea, story, empty, paused }: StoryTextProps) => {
  if (story) {
    return (
      <View>
        <Text style={styles.title} numberOfLines={2}>
          {story.title}
        </Text>
        <Text style={styles.logline} numberOfLines={2}>
          {story.status === 'finished'
            ? 'Your family finished this story. Watch it again as one movie, or share it.'
            : 'Pick up your story where you left it.'}
        </Text>
        <View style={styles.facts}>
          <Text style={styles.fact}>Continue watching</Text>
          <Text style={styles.fact}>{storyProgress(story)}</Text>
        </View>
      </View>
    );
  }
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
  stories: StorySummary[];
  openingId: string | null;
  onFocusIndex: (index: number) => void;
  onSelectIdea: (idea: IdeaView) => void;
  onSelectStory: (story: StorySummary) => void;
  onMakeYourOwn: () => void;
  paused: boolean;
}

// The family's own stories come first, then Make your own, then tonight's stories.
// Focus indexes: stories are negative (-1 is the first), 0 is Make your own, ideas start at 1.
const StoryRow = React.memo(
  ({ ideas, stories, openingId, onFocusIndex, onSelectIdea, onSelectStory, onMakeYourOwn, paused }: StoryRowProps) => (
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
          {stories.map((story, i) => (
            <DefaultFocus key={story.id} enable={i === 0}>
              <ContinueCard
                story={story}
                index={-(i + 1)}
                position={i + 1}
                onFocusIndex={onFocusIndex}
                onSelectStory={onSelectStory}
              />
            </DefaultFocus>
          ))}
          <DefaultFocus enable={ideas.length === 0 && stories.length === 0}>
            <MakeYourOwnCard
              paused={paused}
              position={stories.length + 1}
              onFocusIndex={onFocusIndex}
              onSelect={onMakeYourOwn}
            />
          </DefaultFocus>
          {ideas.map((idea, i) => (
            <DefaultFocus key={idea.id} enable={i === 0 && stories.length === 0}>
              <IdeaCard
                idea={idea}
                index={i + 1}
                position={stories.length + i + 2}
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
  const [stories, setStories] = useState<StorySummary[]>([]);
  const opening = useRef(false);
  const appActive = useAppActive();
  const loadRef = useRef(load);
  loadRef.current = load;
  const storiesRef = useRef(stories);
  storiesRef.current = stories;

  const show = useCallback((today: TodayResponse) => {
    reportFilmingPaused(today.filmingPaused);
    today.ideas.forEach((idea) => prefetchImage(resolveMediaUrl(idea.posterUrl)));
    setLoad({ status: 'ready', today });
  }, []);

  // The last Home this TV saw shows straight away and the fresh one replaces it when it arrives.
  useEffect(() => {
    let live = true;
    readHomeCache().then((saved) => {
      if (!live || !saved || loadRef.current.status === 'ready') return;
      setStories(saved.stories);
      show(saved.today);
    });
    return () => {
      live = false;
    };
  }, [show]);

  // Loads on first visit, on retry and when the TV wakes up, and keeps trying until it works,
  // since a TV that just woke up can take a while to get back online.
  useEffect(() => {
    if (!isFocused || !appActive) return;
    const controller = new AbortController();
    const started = Date.now();
    // Both lists arrive together so the first focus lands on the family's latest story.
    // Unfinished stories come first, then recently finished ones; Home works without them.
    const loadBoth = () =>
      Promise.all([
        api.getToday({ signal: controller.signal, retries: 0 }),
        api
          .listStories({ signal: controller.signal, retries: 0 })
          .then((list) => [
            ...list.filter((s) => s.status === 'active'),
            ...list.filter((s) => s.status === 'finished'),
          ])
          .catch(() => null),
      ]);
    const explain = (error: unknown) => {
      const code = toApiError(error).code;
      const offline = code === 'network' && !isWatchOnly();
      const message = messageForError(code, 'today');
      const current = loadRef.current;
      if (current.status === 'ready') return;
      if (current.status === 'error' && current.offline === offline && current.message === message) return;
      setLoad({ status: 'error', offline, message });
    };
    retryPatiently(loadBoth, {
      signal: controller.signal,
      onFailure: (error) => {
        const patience = error.code === 'network' ? OFFLINE_PATIENCE_MS : PATIENCE_MS;
        if (Date.now() - started >= patience) explain(error);
      },
    })
      .then(([today, own]) => {
        const kept = own ? own.slice(0, MAX_CONTINUE) : storiesRef.current;
        setStories(kept);
        show(today);
        saveHomeCache({ today, stories: kept });
        // The wallet gave up if the TV was offline at launch.
        if (!sparks.getSnapshot().wallet) sparks.refreshWallet();
      })
      .catch((error) => {
        if (!isAbortError(error)) explain(error);
      });
    return () => controller.abort();
  }, [attempt, isFocused, appActive, show]);

  useEffect(() => {
    if (load.status !== 'loading') markHomeShown();
  }, [load.status]);

  const retry = useCallback(() => {
    if (loadRef.current.status === 'error') setLoad({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
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

  const openStory = useCallback(
    (story: StorySummary) => {
      const origin = { ideaId: story.ideaId };
      if (story.status === 'finished') {
        navigation.navigate('End', {
          storyId: story.id,
          title: story.title,
          stillUrl: story.posterUrl,
          tone: story.tone ?? null,
          origin,
        });
        return;
      }
      navigation.navigate('Story', {
        storyId: story.id,
        title: story.title,
        nodeId: story.currentNodeId,
        posterUrl: story.posterUrl,
        tone: story.tone ?? null,
        origin,
        audience: story.audience,
      });
    },
    [navigation],
  );

  const ideas = load.status === 'ready' ? load.today.ideas : [];
  const focusedIdea = focusedIndex > 0 ? (ideas[focusedIndex - 1] ?? null) : null;
  // A story left in focus is probably the one the family will open, so its first clip starts loading.
  const focusedTrailer = focusedIdea?.trailerUrl ?? null;
  useEffect(() => {
    if (!focusedTrailer) return;
    const timer = setTimeout(() => warmClip(focusedTrailer), 800);
    return () => clearTimeout(timer);
  }, [focusedTrailer]);
  const focusedStory = focusedIndex < 0 ? (stories[-focusedIndex - 1] ?? null) : null;
  const billboardUri = focusedStory
    ? focusedStory.posterUrl
    : focusedIdea
      ? resolveMediaUrl(focusedIdea.posterUrl)
      : null;
  const focusedTone = focusedStory ? focusedStory.tone : focusedIdea?.tone;
  const tone = useMemo(() => toneFor(focusedTone), [focusedTone]);

  return (
    // A newly started story moves to the front of Continue watching, so focus starts there again.
    <SpatialNavigationRoot isActive={isFocused} key={`${load.status}:${stories[0]?.id ?? ''}`}>
      <MotionContext.Provider value={isFocused}>
        <ToneContext.Provider value={tone}>
          <View style={styles.screen}>
            {load.status === 'ready' && (
              <Billboard uri={billboardUri} page={!focusedIdea && !focusedStory} night={tone.night} />
            )}
            <View style={styles.header}>
              <Brand />
              {load.status !== 'ready' && <WalletText />}
            </View>

            {load.status === 'loading' && <HomeSkeleton />}

            {load.status === 'error' && (
              <View style={[styles.text, styles.errorText]}>
                <Text style={styles.title} numberOfLines={2}>
                  {load.offline ? messages.offline : 'The stories did not load'}
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
                  <FadeIn key={focusedStory?.id ?? focusedIdea?.id ?? 'make'}>
                    <StoryText
                      idea={focusedIdea}
                      story={focusedStory}
                      empty={ideas.length === 0}
                      paused={filmingPaused}
                    />
                  </FadeIn>
                </View>
                <StoryRow
                  ideas={ideas}
                  stories={stories}
                  openingId={openingId}
                  onFocusIndex={setFocusedIndex}
                  onSelectIdea={openIdea}
                  onSelectStory={openStory}
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
