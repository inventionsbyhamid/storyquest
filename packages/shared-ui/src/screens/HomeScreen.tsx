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
import { audienceFact, formatPlays, moodLabel } from '../story/format';
import { messageForError } from '../story/messages';
import { colors, radii, screen, space, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { prefetchImage } from '../utils/prefetch';
import { Brand } from '../components/Brand';
import { Button } from '../components/Button';
import { PosterPlate } from '../components/home/PosterPlate';
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

const PLATE_WIDTH = scaledPixels(760);
const PLATE_HEIGHT = Math.round((PLATE_WIDTH * 9) / 16) + scaledPixels(20);

const StoryText = React.memo(({ idea, empty }: { idea: IdeaView | null; empty: boolean }) => {
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
      <SkeletonBlock pulse={pulse} style={[styles.plate, styles.skeletonPlate]} />
      <View style={styles.rowArea}>
        <Text style={styles.rowTitle}>Tonight's stories</Text>
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
    <Text style={styles.rowTitle}>Tonight's stories</Text>
    <SpatialNavigationScrollView horizontal offsetFromStart={screen.side + CARD_WIDTH + CARD_GAP} style={styles.scroll}>
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
  const plateUri = focusedIdea ? resolveMediaUrl(focusedIdea.posterUrl) : null;

  return (
    <SpatialNavigationRoot isActive={isFocused} key={load.status}>
      <MotionContext.Provider value={isFocused}>
        <View style={styles.screen}>
          <View style={styles.header}>
            <Brand />
            <WalletText />
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
                <View style={styles.heroText}>
                  <StoryText idea={focusedIdea} empty={ideas.length === 0} />
                </View>
                <PosterPlate uri={plateUri} page={!focusedIdea} style={styles.heroPlate} />
              </View>
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
  text: {
    position: 'absolute',
    top: scaledPixels(196),
    left: screen.side,
    width: scaledPixels(860),
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
    marginRight: space.xl,
  },
  plate: {
    position: 'absolute',
    top: scaledPixels(164),
    right: screen.side,
    width: PLATE_WIDTH,
    height: PLATE_HEIGHT,
  },
  hero: {
    position: 'absolute',
    top: scaledPixels(164),
    left: screen.side,
    right: screen.side,
    height: PLATE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroText: {
    flex: 1,
    marginRight: space.xxl,
  },
  heroPlate: {
    width: PLATE_WIDTH,
    height: PLATE_HEIGHT,
  },
  skeletonPlate: {
    borderRadius: radii.plate,
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
    top: scaledPixels(664),
  },
  rowTitle: {
    ...type.heading,
    color: colors.paper,
    marginLeft: screen.side,
    marginBottom: space.xs,
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
