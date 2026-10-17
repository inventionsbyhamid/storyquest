import React, { useCallback, useMemo, useRef } from 'react';
import { View } from 'react-native';
import Video from 'react-native-video';
import type { OnLoadData, OnPlaybackStateChangedData, OnProgressData, OnVideoErrorData } from 'react-native-video';
import { useLatest } from '../../hooks/useLatest';
import type { ClipPlayerProps } from './types';

function ClipPlayer(props: ClipPlayerProps) {
  const { source, paused, style } = props;
  const latest = useLatest(props);
  const startedFor = useRef<string | null>(null);
  const videoSource = useMemo(() => (source ? { uri: source } : null), [source]);

  const markPlaying = useCallback(() => {
    const current = latest.current.source;
    if (!current || startedFor.current === current) return;
    startedFor.current = current;
    latest.current.onPlaying?.(current);
  }, [latest]);

  const handleLoad = useCallback(
    (_data: OnLoadData) => {
      const current = latest.current.source;
      if (current) latest.current.onReady?.(current);
    },
    [latest],
  );

  const handleProgress = useCallback(
    (data: OnProgressData) => {
      if (data.currentTime > 0.05) markPlaying();
      latest.current.onProgress?.(data.currentTime, data.seekableDuration);
    },
    [latest, markPlaying],
  );

  const handlePlaybackState = useCallback(
    (data: OnPlaybackStateChangedData) => {
      if (data.isPlaying) markPlaying();
    },
    [markPlaying],
  );

  const handleEnd = useCallback(() => {
    const current = latest.current.source;
    if (current) latest.current.onEnded?.(current);
  }, [latest]);

  const handleError = useCallback(
    (event: OnVideoErrorData) => {
      const current = latest.current.source;
      const message = event.error?.errorString ?? event.error?.localizedDescription ?? 'Playback failed';
      if (current) latest.current.onError?.(current, String(message));
    },
    [latest],
  );

  if (!videoSource) return <View style={style} />;

  return (
    <Video
      source={videoSource}
      paused={paused}
      style={style}
      resizeMode="cover"
      repeat={false}
      playInBackground={false}
      hideShutterView
      shutterColor="transparent"
      progressUpdateInterval={250}
      onLoad={handleLoad}
      onProgress={handleProgress}
      onPlaybackStateChanged={handlePlaybackState}
      onEnd={handleEnd}
      onError={handleError}
    />
  );
}

export default React.memo(ClipPlayer);
