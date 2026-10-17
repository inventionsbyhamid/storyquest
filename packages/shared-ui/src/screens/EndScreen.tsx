import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { FinishResponse, MovieStatus } from '@storyquest/contracts';
import { api, isAbortError, toApiError } from '../api';
import { sleep } from '../api/sleep';
import { formatEndingsDiscovered, formatFamiliesPlayed, formatRarestChoice } from '../story/format';
import { messageForError, messages } from '../story/messages';
import { colors, radii, screen, space, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { useBackHandler } from '../hooks/useBackHandler';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { ShareCode } from '../components/ShareCode';
import { SkeletonBlock, usePulse } from '../components/Skeleton';
import type { ScreenNavigation, ScreenRoute } from '../navigation/types';

type FinishState =
  | { status: 'loading' }
  | { status: 'ready'; result: FinishResponse }
  | { status: 'error'; message: string };

const MOVIE_POLL_MS = 4000;
const MOVIE_POLL_LIMIT_MS = 4 * 60 * 1000;

const QrPlaceholder = () => {
  const pulse = usePulse();
  return <SkeletonBlock pulse={pulse} style={styles.qrSkeleton} />;
};

const asSentence = (line: string) => (/[.!?]$/.test(line) ? line : `${line}.`);

function movieNote(status: MovieStatus): string | null {
  if (status === 'failed') return messages.movieFailed;
  if (status === 'pending') return messages.movieAlmostReady;
  return null;
}

export default function EndScreen() {
  const route = useRoute<ScreenRoute<'End'>>();
  const navigation = useNavigation<ScreenNavigation<'End'>>();
  const { storyId, title, stillUrl } = route.params;
  const isFocused = useIsFocused();
  const [finish, setFinish] = useState<FinishState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [movie, setMovie] = useState<{ status: MovieStatus; url: string | null }>({ status: 'pending', url: null });
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFinish({ status: 'loading' });
    api
      .finish(storyId, { signal: controller.signal })
      .then((result) => {
        setFinish({ status: 'ready', result });
        setMovie({ status: result.movieStatus, url: result.movieUrl });
      })
      .catch((error) => {
        if (!isAbortError(error)) setFinish({ status: 'error', message: messageForError(toApiError(error).code) });
      });
    return () => controller.abort();
  }, [storyId, attempt]);

  const slug = finish.status === 'ready' ? finish.result.shareSlug : null;
  useEffect(() => {
    if (!slug || movie.status !== 'pending') return;
    const controller = new AbortController();
    const startedAt = Date.now();
    (async () => {
      while (Date.now() - startedAt < MOVIE_POLL_LIMIT_MS) {
        await sleep(MOVIE_POLL_MS, controller.signal);
        try {
          const share = await api.getShare(slug, { signal: controller.signal, retries: 0 });
          if (share.movieStatus !== 'pending') {
            setMovie({ status: share.movieStatus, url: share.movieUrl });
            return;
          }
        } catch (error) {
          if (isAbortError(error)) return;
        }
      }
    })().catch(() => undefined);
    return () => controller.abort();
  }, [slug, movie.status]);

  const goHome = useCallback(() => navigation.popToTop(), [navigation]);
  const newStory = useCallback(() => navigation.replace('Create'), [navigation]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const watchMovie = useCallback(() => {
    if (movie.status === 'ready' && movie.url) {
      navigation.navigate('Movie', { url: movie.url, title, posterUrl: stillUrl });
      return;
    }
    setNotice({ id: Date.now(), text: movie.status === 'failed' ? messages.movieFailed : messages.movieAlmostReady });
  }, [movie, navigation, title, stillUrl]);

  useBackHandler(goHome, isFocused);

  const stats =
    finish.status === 'ready'
      ? [
          formatRarestChoice(finish.result.stats.rarestChoice),
          formatEndingsDiscovered(finish.result.stats.endingsDiscovered),
          formatFamiliesPlayed(finish.result.stats.familiesPlayed),
        ].filter((line): line is string => !!line)
      : [];

  const note = finish.status === 'ready' ? movieNote(movie.status) : null;

  return (
    <SpatialNavigationRoot isActive={isFocused} key={finish.status}>
      <View style={styles.screen}>
        <View style={styles.column}>
          <Text style={styles.end}>The end</Text>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>

          {finish.status === 'loading' && <Text style={styles.stat}>Saving your story.</Text>}
          {finish.status === 'error' && <Text style={styles.stat}>{finish.message}</Text>}
          {stats.map((line) => (
            <Text key={line} style={styles.stat}>
              {asSentence(line)}
            </Text>
          ))}

          <SpatialNavigationView direction="horizontal" style={styles.actions}>
            {finish.status === 'error' ? (
              <DefaultFocus>
                <Button label="Try again" primary icon="restart" onSelect={retry} style={styles.action} />
              </DefaultFocus>
            ) : (
              <DefaultFocus>
                <Button
                  label="Watch it as one movie"
                  hint={note ?? undefined}
                  primary
                  icon="play"
                  onSelect={watchMovie}
                  style={styles.action}
                />
              </DefaultFocus>
            )}
            <Button label="New story" icon="plus" onSelect={newStory} style={styles.action} />
            <Button label="Home" icon="home" onSelect={goHome} style={styles.action} />
          </SpatialNavigationView>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>

        <View style={styles.share}>
          {finish.status === 'ready' ? (
            <ShareCode url={finish.result.shareUrl} />
          ) : finish.status === 'loading' ? (
            <QrPlaceholder />
          ) : null}
        </View>

        {notice && <Notice id={notice.id} text={notice.text} onDismiss={dismissNotice} raised />}
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  column: {
    position: 'absolute',
    left: screen.side,
    top: scaledPixels(272),
    width: scaledPixels(1040),
  },
  end: {
    ...type.display,
    color: colors.paper,
  },
  title: {
    ...type.title,
    color: colors.paper,
    marginTop: space.xs,
    marginBottom: space.lg,
  },
  stat: {
    ...type.body,
    color: colors.paper,
    marginTop: space.xs,
  },
  actions: {
    marginTop: space.xl,
    alignItems: 'center',
  },
  action: {
    marginRight: space.md,
  },
  note: {
    ...type.small,
    color: colors.paperDim,
    marginTop: space.sm,
  },
  share: {
    position: 'absolute',
    right: screen.side,
    top: scaledPixels(292),
    alignItems: 'center',
  },
  qrSkeleton: {
    width: scaledPixels(348),
    height: scaledPixels(348),
    borderRadius: radii.card,
  },
});
