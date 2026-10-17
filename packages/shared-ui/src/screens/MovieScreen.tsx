import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import ClipPlayer from '../components/player/ClipPlayer';
import type { MediaCommand } from '../components/player/types';
import { CaptionBar } from '../components/story/CaptionBar';
import { PausedBadge } from '../components/story/Panels';
import { StillFrame } from '../components/story/StillFrame';
import { WaitingCard } from '../components/story/WaitingCard';
import { Notice } from '../components/Notice';
import { useAppActive } from '../hooks/useAppActive';
import { useBackHandler, useRemoteKey } from '../hooks/useBackHandler';
import { messages } from '../story/messages';
import { colors } from '../theme';
import type { ScreenNavigation, ScreenRoute } from '../navigation/types';

const noop = () => undefined;

export default function MovieScreen() {
  const route = useRoute<ScreenRoute<'Movie'>>();
  const navigation = useNavigation<ScreenNavigation<'Movie'>>();
  const { url, title, posterUrl } = route.params;
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [captionToken, setCaptionToken] = useState(0);
  const [failed, setFailed] = useState(false);
  const lastToggleAt = useRef(0);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const toggle = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleAt.current < 600) return;
    lastToggleAt.current = now;
    setPaused((value) => !value);
  }, []);

  const onMediaCommand = useCallback(
    (command: MediaCommand) => {
      if (command === 'toggle') toggle();
      else setPaused(command === 'pause');
    },
    [toggle],
  );

  const onPlaying = useCallback(() => {
    setStarted(true);
    setCaptionToken(Date.now());
  }, []);

  const onError = useCallback(() => setFailed(true), []);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => navigation.goBack(), 2500);
    return () => clearTimeout(timer);
  }, [failed, navigation]);

  useBackHandler(goBack, isFocused);
  useRemoteKey((key) => {
    if (key === SupportedKeys.PlayPause) toggle();
    else if (key === SupportedKeys.Enter) setCaptionToken(Date.now());
  }, isFocused);

  return (
    <View style={styles.screen}>
      <ClipPlayer
        source={url}
        paused={paused || !isFocused || !appActive}
        style={StyleSheet.absoluteFill}
        onPlaying={onPlaying}
        onEnded={goBack}
        onError={onError}
        onMediaCommand={onMediaCommand}
      />
      <StillFrame uri={posterUrl} visible={!started} />
      <CaptionBar caption={title} folio="Your movie" madeIn={null} showToken={captionToken} />
      {!started && !failed && <WaitingCard label="Loading your movie" detail={title} delayMs={600} />}
      {started && paused && <PausedBadge />}
      {failed && <Notice id={1} text={messages.movieFailed} onDismiss={noop} raised />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
  },
});
