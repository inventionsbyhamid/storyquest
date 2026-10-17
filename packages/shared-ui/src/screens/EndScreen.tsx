import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { FinishResponse, MovieStatus } from '@storyquest/contracts';
import { api, isAbortError, toApiError } from '../api';
import { sleep } from '../api/sleep';
import { formatEndingsDiscovered, formatFamiliesPlayed, formatRarestChoice } from '../story/format';
import { messageForError, messages } from '../story/messages';
import { colors, radii, safeZones, type } from '../theme';
import { scaledPixels } from '../hooks/useScale';
import { useBackHandler } from '../hooks/useBackHandler';
import { Button } from '../components/Button';
import { Gradient } from '../components/Gradient';
import { PlayIcon, SparkleIcon } from '../components/Icons';
import { Notice } from '../components/Notice';
import { ShareCode } from '../components/ShareCode';
import { SkeletonBlock, usePulse } from '../components/Skeleton';
import type { ScreenNavigation, ScreenRoute } from '../navigation/types';

type FinishState =
  | { status: 'loading' }
  | { status: 'ready'; result: FinishResponse }
  | { status: 'error'; message: string };

const SIDE = scaledPixels(safeZones.titleSafe.horizontal);
const MOVIE_POLL_MS = 4000;
const MOVIE_POLL_LIMIT_MS = 4 * 60 * 1000;

const SCRIM = [
  { offset: 0, color: colors.background, opacity: 0.97 },
  { offset: 0.55, color: colors.background, opacity: 0.84 },
  { offset: 1, color: colors.background, opacity: 0.45 },
];

const QrPlaceholder = () => {
  const pulse = usePulse();
  return <SkeletonBlock pulse={pulse} style={styles.qrSkeleton} />;
};

function movieDetail(status: MovieStatus): string {
  if (status === 'ready') return 'All your scenes in a row';
  if (status === 'failed') return 'Not available this time';
  return messages.movieAlmostReady;
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
  const stillSource = useMemo(() => (stillUrl ? { uri: stillUrl } : null), [stillUrl]);

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

  return (
    <SpatialNavigationRoot isActive={isFocused} key={finish.status}>
      <View style={styles.screen}>
        {stillSource && (
          <Image source={stillSource} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
        )}
        <Gradient style={StyleSheet.absoluteFill} direction="right" stops={SCRIM} />

        <View style={styles.column}>
          <View style={styles.eyebrowRow}>
            <SparkleIcon size={scaledPixels(30)} color={colors.accent} />
            <Text style={styles.eyebrow}>The End</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>

          {finish.status === 'loading' && <Text style={styles.stat}>Wrapping up your story</Text>}
          {finish.status === 'error' && <Text style={styles.error}>{finish.message}</Text>}
          {stats.map((line) => (
            <View key={line} style={styles.statRow}>
              <View style={styles.statDot} />
              <Text style={styles.stat}>{line}</Text>
            </View>
          ))}

          <SpatialNavigationView direction="horizontal" style={styles.actions}>
            {finish.status === 'error' ? (
              <DefaultFocus>
                <Button label="Try again" variant="primary" onSelect={retry} style={styles.action} />
              </DefaultFocus>
            ) : (
              <DefaultFocus>
                <Button
                  label="Watch it as one movie"
                  detail={movieDetail(movie.status)}
                  variant="primary"
                  dimmed={movie.status !== 'ready'}
                  onSelect={watchMovie}
                  icon={(color) => <PlayIcon size={scaledPixels(30)} color={color} />}
                  style={styles.action}
                />
              </DefaultFocus>
            )}
            <Button label="New story" onSelect={newStory} style={styles.action} />
            <Button label="Home" onSelect={goHome} style={styles.action} />
          </SpatialNavigationView>
        </View>

        <View style={styles.share}>
          {finish.status === 'ready' ? <ShareCode url={finish.result.shareUrl} /> : <QrPlaceholder />}
        </View>

        {notice && <Notice id={notice.id} text={notice.text} onDismiss={dismissNotice} />}
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  column: {
    position: 'absolute',
    left: SIDE,
    top: scaledPixels(236),
    width: scaledPixels(1060),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyebrow: {
    ...type.label,
    color: colors.accent,
    letterSpacing: scaledPixels(3),
    textTransform: 'uppercase',
    marginLeft: scaledPixels(12),
  },
  title: {
    ...type.display,
    color: colors.text,
    marginTop: scaledPixels(14),
    marginBottom: scaledPixels(28),
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaledPixels(14),
  },
  statDot: {
    width: scaledPixels(12),
    height: scaledPixels(12),
    borderRadius: scaledPixels(6),
    backgroundColor: colors.accent,
    marginRight: scaledPixels(18),
  },
  stat: {
    ...type.bodyLarge,
    color: colors.text,
    flexShrink: 1,
  },
  error: {
    ...type.bodyLarge,
    color: colors.danger,
  },
  actions: {
    marginTop: scaledPixels(64),
    alignItems: 'center',
  },
  action: {
    marginRight: scaledPixels(28),
  },
  share: {
    position: 'absolute',
    right: SIDE + scaledPixels(20),
    top: scaledPixels(250),
    alignItems: 'center',
  },
  qrSkeleton: {
    width: scaledPixels(352),
    height: scaledPixels(352),
    borderRadius: radii.lg,
  },
});
