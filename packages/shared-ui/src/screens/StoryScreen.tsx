import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import type { ChooseRequest } from '@storyquest/contracts';
import { api, areChoicesSettled, isAbortError, toApiError, waitForNode } from '../api';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import ClipPlayer from '../components/player/ClipPlayer';
import type { MediaCommand } from '../components/player/types';
import { CaptionBar } from '../components/story/CaptionBar';
import { ChoiceOverlay } from '../components/story/ChoiceOverlay';
import { CustomChoiceSheet, PausedBadge, PauseMenu, StoryErrorPanel } from '../components/story/Panels';
import { StillFrame } from '../components/story/StillFrame';
import { WaitingCard } from '../components/story/WaitingCard';
import { Notice } from '../components/Notice';
import { useAppActive } from '../hooks/useAppActive';
import { useBackHandler, useRemoteKey } from '../hooks/useBackHandler';
import { formatMadeIn, formatSceneProgress } from '../story/format';
import { messageForError } from '../story/messages';
import { startRequestFor } from '../story/origin';
import {
  createStoryState,
  isPlayerPaused,
  isStillVisible,
  shouldWatchChoices,
  storyReducer,
  waitingLabel,
} from '../story/storyMachine';
import { colors } from '../theme';
import { prefetchImage } from '../utils/prefetch';
import type { ScreenNavigation, ScreenRoute } from '../navigation/types';

const TOGGLE_DEBOUNCE_MS = 600;

export default function StoryScreen() {
  const route = useRoute<ScreenRoute<'Story'>>();
  const navigation = useNavigation<ScreenNavigation<'Story'>>();
  const { origin, posterUrl } = route.params;
  const isFocused = useIsFocused();
  const appActive = useAppActive();

  const [session, setSession] = useState({ storyId: route.params.storyId, title: route.params.title });
  const [state, dispatch] = useReducer(storyReducer, { nodeId: route.params.nodeId, posterUrl }, createStoryState);
  const [captionToken, setCaptionToken] = useState(0);
  const [restarting, setRestarting] = useState(false);
  const restartingRef = useRef(false);
  const lastToggleAt = useRef(0);

  const { phase, scene } = state;
  const inPlayback = phase === 'playing' || phase === 'ending';

  // Wait for the scene we are heading to.
  useEffect(() => {
    const nodeId = state.pendingNodeId;
    if (!nodeId) return;
    const controller = new AbortController();
    waitForNode(api, nodeId, { signal: controller.signal })
      .then((next) => dispatch({ type: 'NODE_UPDATE', scene: next }))
      .catch((error) => {
        if (!isAbortError(error)) dispatch({ type: 'NODE_WAIT_FAILED', nodeId, code: toApiError(error).code });
      });
    return () => controller.abort();
  }, [state.pendingNodeId, state.pollSeq]);

  // Tell the server about the choice. Keyed on requestSeq so each choice is sent exactly once.
  useEffect(() => {
    if (state.phase !== 'waitingNext' || state.choiceAccepted || !state.scene) return;
    const seq = state.requestSeq;
    const body: ChooseRequest =
      state.waitKind === 'custom'
        ? { kind: 'custom', fromNodeId: state.scene.id, text: state.customText }
        : { kind: 'preset', fromNodeId: state.scene.id, index: state.pendingChoice ?? 0 };
    const controller = new AbortController();
    api
      .choose(session.storyId, body, { signal: controller.signal })
      .then((result) => dispatch({ type: 'CHOICE_ACCEPTED', seq, nextNodeId: result.nextNodeId }))
      .catch((error) => {
        if (!isAbortError(error)) dispatch({ type: 'CHOICE_FAILED', seq, code: toApiError(error).code });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.requestSeq]);

  // While a scene plays, keep asking about its children so the choice cards light up as they finish.
  const watchId = shouldWatchChoices(state) ? (scene?.id ?? null) : null;
  useEffect(() => {
    if (!watchId) return;
    const controller = new AbortController();
    waitForNode(api, watchId, {
      signal: controller.signal,
      until: areChoicesSettled,
      onUpdate: (update) => dispatch({ type: 'NODE_UPDATE', scene: update }),
      minIntervalMs: 2500,
      maxDurationMs: 5 * 60 * 1000,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [watchId]);

  useEffect(() => {
    if (!scene) return;
    prefetchImage(scene.lastFrameUrl);
    scene.choices.forEach((choice) => prefetchImage(choice.posterUrl));
  }, [scene]);

  useEffect(() => {
    if (inPlayback && state.clipStarted) setCaptionToken(Date.now());
    else if (!inPlayback) setCaptionToken(0);
  }, [scene?.id, state.clipStarted, inPlayback]);

  useEffect(() => {
    if (phase !== 'finished') return;
    navigation.replace('End', { storyId: session.storyId, title: session.title, stillUrl: state.still, origin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const togglePause = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleAt.current < TOGGLE_DEBOUNCE_MS) return;
    lastToggleAt.current = now;
    dispatch({ type: 'TOGGLE_PAUSE' });
  }, []);

  const onMediaCommand = useCallback(
    (command: MediaCommand) => {
      if (command === 'toggle') togglePause();
      else dispatch({ type: 'SET_PAUSED', paused: command === 'pause' });
    },
    [togglePause],
  );

  const exitHome = useCallback(() => navigation.popToTop(), [navigation]);

  const startOver = useCallback(async () => {
    if (restartingRef.current) return;
    const request = startRequestFor(origin);
    if (!request) {
      navigation.replace('Create');
      return;
    }
    restartingRef.current = true;
    setRestarting(true);
    try {
      const story = await api.startStory(request);
      setSession({ storyId: story.id, title: story.title });
      dispatch({ type: 'RESET', nodeId: story.currentNodeId, posterUrl });
    } catch (error) {
      dispatch({ type: 'NOTICE', text: messageForError(toApiError(error).code, 'start') });
    } finally {
      restartingRef.current = false;
      setRestarting(false);
    }
  }, [origin, posterUrl, navigation]);

  const retry = useCallback(() => {
    if (state.error?.code === 'node_failed') startOver();
    else dispatch({ type: 'RETRY' });
  }, [state.error, startOver]);

  useBackHandler(() => {
    if (phase === 'error') exitHome();
    else dispatch({ type: 'BACK' });
  }, isFocused);

  useRemoteKey((key) => {
    if (key === SupportedKeys.PlayPause) togglePause();
    else if (key === SupportedKeys.Enter && inPlayback && !state.menuOpen) setCaptionToken(Date.now());
  }, isFocused);

  const onPlaying = useCallback((clipUrl: string) => dispatch({ type: 'CLIP_PLAYING', clipUrl }), []);
  const onEnded = useCallback((clipUrl: string) => dispatch({ type: 'CLIP_ENDED', clipUrl }), []);
  const onClipError = useCallback((clipUrl: string, message: string) => {
    console.warn('[Story] clip failed', clipUrl, message);
    dispatch({ type: 'CLIP_FAILED', clipUrl });
  }, []);
  const choose = useCallback((index: number) => dispatch({ type: 'CHOOSE', index }), []);
  const openCustom = useCallback(() => dispatch({ type: 'OPEN_CUSTOM' }), []);
  const changeCustom = useCallback((text: string) => dispatch({ type: 'CUSTOM_TEXT', text }), []);
  const submitCustom = useCallback(() => dispatch({ type: 'SUBMIT_CUSTOM' }), []);
  const cancelCustom = useCallback(() => dispatch({ type: 'CANCEL_CUSTOM' }), []);
  const resume = useCallback(() => dispatch({ type: 'CLOSE_MENU' }), []);
  const dismissNotice = useCallback((id: number) => dispatch({ type: 'DISMISS_NOTICE', id }), []);

  const paused = isPlayerPaused(state) || !isFocused || !appActive;
  const waiting = waitingLabel(state);
  const layersActive = isFocused && !state.menuOpen;

  return (
    <View style={styles.screen}>
      <ClipPlayer
        source={scene?.clipUrl ?? null}
        paused={paused}
        style={StyleSheet.absoluteFill}
        onPlaying={onPlaying}
        onEnded={onEnded}
        onError={onClipError}
        onMediaCommand={onMediaCommand}
      />
      <StillFrame uri={state.still} visible={isStillVisible(state) || (!state.still && !state.clipStarted)} />

      {scene && (
        <CaptionBar
          caption={scene.caption}
          progress={formatSceneProgress(scene.sceneNumber, scene.totalScenes)}
          madeIn={formatMadeIn(scene.generationMs)}
          showToken={captionToken}
        />
      )}

      {scene && phase === 'choosing' && (
        <ChoiceOverlay
          scene={scene}
          closedChoices={state.disabledChoices}
          active={layersActive && phase === 'choosing'}
          onChoose={choose}
          onSomethingElse={openCustom}
        />
      )}

      {phase === 'customInput' && (
        <CustomChoiceSheet
          active={layersActive}
          text={state.customText}
          error={state.customError}
          onChangeText={changeCustom}
          onSubmit={submitCustom}
          onCancel={cancelCustom}
        />
      )}

      {waiting && !state.menuOpen && (
        <WaitingCard
          key={`${phase}-${state.requestSeq}`}
          label={waiting}
          detail={
            phase === 'loadingScene'
              ? session.title
              : state.waitKind === 'custom'
                ? 'We are filming your idea. This takes a few seconds.'
                : null
          }
          delayMs={phase === 'waitingNext' && state.waitKind === 'preset' ? 600 : 400}
        />
      )}

      {inPlayback && state.userPaused && !state.menuOpen && <PausedBadge />}

      {state.notice && <Notice id={state.notice.id} text={state.notice.text} onDismiss={dismissNotice} />}

      {phase === 'error' && state.error && (
        <StoryErrorPanel message={state.error.message} active={isFocused} onRetry={retry} onExit={exitHome} />
      )}

      {state.menuOpen && (
        <PauseMenu
          title={session.title}
          active={isFocused}
          restarting={restarting}
          onResume={resume}
          onStartOver={startOver}
          onExit={exitHome}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
