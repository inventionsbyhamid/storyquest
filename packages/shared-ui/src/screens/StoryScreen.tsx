import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import type { Audience, ChooseRequest, ReportReason } from '@storyquest/contracts';
import { api, areChoicesSettled, isAbortError, toApiError, waitForNode } from '../api';
import { sleep } from '../api/sleep';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import ClipPlayer from '../components/player/ClipPlayer';
import type { MediaCommand } from '../components/player/types';
import { CaptionBar } from '../components/story/CaptionBar';
import { ChoiceOverlay } from '../components/story/ChoiceOverlay';
import {
  CustomChoiceSheet,
  PathEndPanel,
  PausedBadge,
  PauseMenu,
  ReportSheet,
  StoryErrorPanel,
} from '../components/story/Panels';
import { GrownUpsGate } from '../components/GrownUpsGate';
import { SparksSheet } from '../components/sparks/SparksSheet';
import { StillFrame } from '../components/story/StillFrame';
import { WaitingCard } from '../components/story/WaitingCard';
import { Notice } from '../components/Notice';
import { useAppActive } from '../hooks/useAppActive';
import { useBackHandler, useRemoteKey } from '../hooks/useBackHandler';
import { useLatest } from '../hooks/useLatest';
import { canAfford, costLabel, sparks, useSparks } from '../purchases';
import { AUTO_PICK_SECONDS, autoPickCandidates, pickAtRandom } from '../story/autoPick';
import { createSerialQueue, sendChoice } from '../story/choiceSync';
import { formatFolio, formatMadeIn } from '../story/format';
import { isFilmingPaused } from '../budget/filming';
import { useFilmingPaused } from '../budget/useFilmingPaused';
import { confirmGrownUps, needsGrownUpsGate } from '../gate/grownUps';
import { messageForError, messages } from '../story/messages';
import { startRequestFor } from '../story/origin';
import { markReported, reportedNodeIds } from '../story/reports';
import {
  closedChoices,
  createStoryState,
  notFilmedChoices,
  isPathEnd,
  isPlayerPaused,
  isPrivatePath,
  isStillVisible,
  shouldWatchChoices,
  storyReducer,
  waitingLabel,
} from '../story/storyMachine';
import { ToneContext, colors, toneFor } from '../theme';
import { createClipCache } from '../utils/clipCache';
import { prefetchImage } from '../utils/prefetch';
import { endChoiceTiming, logTiming, markChoice } from '../utils/timing';
import { playUiSound } from '../utils/uiSounds';
import type { ScreenNavigation, ScreenRoute } from '../navigation/types';

const TOGGLE_DEBOUNCE_MS = 600;
const SYNC_FLUSH_MS = 3000;
const FOCUS_PREFETCH_MS = 1200;
const LOCAL_START_TIMEOUT_MS = 4000;

export default function StoryScreen() {
  const route = useRoute<ScreenRoute<'Story'>>();
  const navigation = useNavigation<ScreenNavigation<'Story'>>();
  const { origin, posterUrl } = route.params;
  const isFocused = useIsFocused();
  const appActive = useAppActive();

  const [session, setSession] = useState<{ storyId: string; title: string; audience: Audience | null }>({
    storyId: route.params.storyId,
    title: route.params.title,
    audience: route.params.audience ?? origin.audience ?? null,
  });
  const [state, dispatch] = useReducer(
    storyReducer,
    { nodeId: route.params.nodeId, posterUrl, hiddenNodes: reportedNodeIds(), filmingPaused: isFilmingPaused() },
    createStoryState,
  );
  const [gateOpen, setGateOpen] = useState(false);
  const filmingPaused = useFilmingPaused();
  useEffect(() => {
    dispatch({ type: 'FILMING_PAUSED', paused: filmingPaused });
  }, [filmingPaused]);
  const [report, setReport] = useState<{ sending: boolean; error: string | null }>({ sending: false, error: null });
  const probedChildren = useRef(new Set<string>());
  const [captionToken, setCaptionToken] = useState(0);
  const [restarting, setRestarting] = useState(false);
  const restartingRef = useRef(false);
  const lastToggleAt = useRef(0);
  const [lifetime] = useState(() => new AbortController());
  const [syncQueue] = useState(createSerialQueue);
  const [clipCache] = useState(createClipCache);
  const [streamOnly, setStreamOnly] = useState(false);
  const sentSyncs = useRef(new Set<number>());
  const childFetches = useRef(new Set<string>());
  const latestState = useLatest(state);
  const { wallet } = useSparks();
  const latestWallet = useLatest(wallet);
  const prefetchedChoices = useRef(new Set<string>());
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { phase, scene } = state;
  const pathEnded = isPathEnd(state);
  const inPlayback = phase === 'playing' || phase === 'ending';
  const paused = isPlayerPaused(state) || !isFocused || !appActive;
  // While a clip plays the panels take its poster's night; otherwise the night of the frame left on screen.
  const night = (scene && (inPlayback ? scene.tone : scene.endTone)) ?? route.params.tone;
  const tone = useMemo(() => toneFor(night), [night]);

  useEffect(
    () => () => {
      lifetime.abort();
      clipCache.clear();
    },
    [lifetime, clipCache],
  );

  const clipUrl = scene?.clipUrl ?? null;
  // Chosen once per scene, so a download finishing mid clip never reloads the player.
  const playSource = useMemo(
    () => (clipUrl ? (streamOnly ? clipUrl : clipCache.resolve(clipUrl)) : null),
    [clipUrl, streamOnly, clipCache],
  );
  const latestSource = useLatest({ playSource, clipUrl });
  const toClipUrl = useCallback(
    (source: string) =>
      source === latestSource.current.playSource ? (latestSource.current.clipUrl ?? source) : source,
    [latestSource],
  );

  useEffect(() => {
    if (scene)
      logTiming('scene became current', `${scene.id}${playSource && playSource !== scene.clipUrl ? ' local' : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id]);

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
    const paid =
      body.kind === 'custom' ||
      (state.scene.choices.find((choice) => choice.index === state.pendingChoice)?.sparks ?? 0) > 0;
    const controller = new AbortController();
    syncQueue
      .run(() => api.choose(session.storyId, body, { signal: controller.signal }))
      .then((result) => {
        dispatch({ type: 'CHOICE_ACCEPTED', seq, nextNodeId: result.nextNodeId });
        if (paid) sparks.refreshWallet();
      })
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

  // Choices the app already played: tell the server in order, quietly.
  useEffect(() => {
    const storyId = session.storyId;
    for (const sync of state.syncs) {
      if (sentSyncs.current.has(sync.id)) continue;
      sentSyncs.current.add(sync.id);
      const request: ChooseRequest = { kind: 'preset', fromNodeId: sync.fromNodeId, index: sync.index };
      syncQueue
        .run(() => sendChoice(api, storyId, request, sync.nodeId))
        .then(() => {
          logTiming('choice saved', sync.nodeId);
          dispatch({ type: 'SYNC_DONE', id: sync.id });
        })
        .catch((error) => {
          console.warn('[Story] choice not saved', error);
          dispatch({ type: 'SYNC_FAILED', id: sync.id });
        });
    }
  }, [state.syncs, session.storyId, syncQueue]);

  useEffect(() => {
    if (!scene) return;
    prefetchImage(scene.lastFrameUrl);
    scene.choices.forEach((choice) => prefetchImage(choice.posterUrl));
  }, [scene]);

  // Fetch each ready child scene ahead of time so picking it can start the clip at once.
  useEffect(() => {
    if (!scene || scene.isEnding) return;
    for (const choice of scene.choices) {
      const id = choice.nodeId;
      if (!choice.ready || !id || state.childScenes[id] || childFetches.current.has(id)) continue;
      childFetches.current.add(id);
      api
        .getNode(id, { signal: lifetime.signal, retries: 1 })
        .then((child) => {
          dispatch({ type: 'CHILD_SCENE', scene: child });
          prefetchImage(child.lastFrameUrl);
          prefetchImage(child.posterUrl);
        })
        .catch(() => undefined)
        .finally(() => childFetches.current.delete(id));
    }
  }, [scene, state.childScenes, lifetime]);

  // A choice that stays unready may lead to a scene that failed or was taken down: ask once, and close it if so.
  useEffect(() => {
    if (!scene || scene.isEnding) return;
    for (const choice of scene.choices) {
      const id = choice.nodeId;
      if (choice.ready || !id || probedChildren.current.has(id)) continue;
      probedChildren.current.add(id);
      api
        .getNode(id, { signal: lifetime.signal })
        .then((child) => dispatch({ type: 'CHILD_SCENE', scene: child }))
        .catch(() => undefined);
    }
  }, [scene, lifetime]);

  // Download the candidate clips once the current one is playing, so they do not fight for bandwidth.
  useEffect(() => {
    if (!state.clipStarted && phase !== 'choosing') return;
    Object.values(state.childScenes).forEach((child) => clipCache.prefetch(child.clipUrl));
  }, [state.childScenes, state.clipStarted, phase, clipCache]);

  // If a downloaded clip does not start, stream it rather than leave the family on a still.
  const localPending = !!playSource && playSource !== clipUrl && inPlayback && !state.clipStarted && !paused;
  useEffect(() => {
    if (!localPending || !playSource) return;
    const timer = setTimeout(() => onClipError(playSource, 'local clip did not start'), LOCAL_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPending, playSource]);

  useEffect(() => {
    if (inPlayback && state.clipStarted) setCaptionToken(Date.now());
    else if (!inPlayback) setCaptionToken(0);
  }, [scene?.id, state.clipStarted, inPlayback]);

  useEffect(() => {
    if (phase !== 'finished') return;
    let cancelled = false;
    // The end screen asks the server to finish the story, so let pending choices land first.
    Promise.race([syncQueue.idle(), sleep(SYNC_FLUSH_MS)]).then(() => {
      if (!cancelled) {
        navigation.replace('End', {
          storyId: session.storyId,
          title: session.title,
          stillUrl: state.still,
          tone: scene?.endTone ?? scene?.tone ?? route.params.tone,
          origin,
        });
      }
    });
    return () => {
      cancelled = true;
    };
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
      setSession({ storyId: story.id, title: story.title, audience: story.audience });
      dispatch({ type: 'RESET', nodeId: story.currentNodeId, posterUrl });
    } catch (error) {
      dispatch({ type: 'NOTICE', text: messageForError(toApiError(error).code, 'start') });
    } finally {
      restartingRef.current = false;
      setRestarting(false);
    }
  }, [origin, posterUrl, navigation]);

  const retry = useCallback(() => {
    if (state.error?.code === 'path_closed') exitHome();
    else if (state.error?.code === 'node_failed') startOver();
    else dispatch({ type: 'RETRY' });
  }, [state.error, startOver, exitHome]);

  useBackHandler(() => {
    if (gateOpen) setGateOpen(false);
    else if (phase === 'error') exitHome();
    else dispatch({ type: 'BACK' });
  }, isFocused);

  useRemoteKey((key) => {
    // Any press while the choices are up means someone is choosing, so the app stops counting down.
    if (latestState.current.phase === 'choosing') stopAutoPick();
    if (key === SupportedKeys.PlayPause) togglePause();
    else if (key === SupportedKeys.Enter && inPlayback && !state.menuOpen) setCaptionToken(Date.now());
  }, isFocused);

  const onPlaying = useCallback(
    (source: string) => {
      logTiming('playing event', clipCache.isLocal(source) ? 'local' : 'stream');
      const elapsed = endChoiceTiming();
      if (elapsed !== null) console.info('[Story] choice to playing ms', elapsed);
      dispatch({ type: 'CLIP_PLAYING', clipUrl: toClipUrl(source) });
    },
    [clipCache, toClipUrl],
  );
  const onEnded = useCallback(
    (source: string) => dispatch({ type: 'CLIP_ENDED', clipUrl: toClipUrl(source) }),
    [toClipUrl],
  );
  const onClipError = useCallback(
    (source: string, message: string) => {
      if (clipCache.isLocal(source)) {
        logTiming('local clip failed, streaming instead', message);
        clipCache.disableLocalPlayback();
        setStreamOnly(true);
        return;
      }
      console.warn('[Story] clip failed', source, message);
      dispatch({ type: 'CLIP_FAILED', clipUrl: toClipUrl(source) });
    },
    [clipCache, toClipUrl],
  );
  const choose = useCallback(
    (index: number) => {
      const current = latestState.current;
      const choice = current.scene?.choices.find((item) => item.index === index);
      // Closed and unfilmed paths only explain themselves; the reducer shows the notice.
      if (closedChoices(current).includes(index) || notFilmedChoices(current).includes(index)) {
        dispatch({ type: 'CHOOSE', index });
        return;
      }
      if (choice && choice.sparks > 0 && !canAfford(latestWallet.current, choice.sparks)) {
        dispatch({ type: 'NEED_SPARKS', prompt: { kind: 'choice', index } });
        return;
      }
      const nodeId = choice?.nodeId;
      markChoice(`${index}${nodeId && current.childScenes[nodeId] ? ' scene cached' : ' waiting'}`);
      dispatch({ type: 'CHOOSE', index });
    },
    [latestState, latestWallet],
  );
  const proceedCustom = useCallback(() => {
    const current = latestWallet.current;
    if (!canAfford(current, current?.sceneCost ?? 1)) {
      dispatch({ type: 'NEED_SPARKS', prompt: { kind: 'openCustom' } });
      return;
    }
    dispatch({ type: 'OPEN_CUSTOM' });
  }, [latestWallet]);
  const openCustom = useCallback(() => {
    if (latestState.current.filmingPaused) dispatch({ type: 'OPEN_CUSTOM' });
    else if (needsGrownUpsGate(session.audience)) setGateOpen(true);
    else proceedCustom();
  }, [latestState, session.audience, proceedCustom]);
  const passGate = useCallback(() => {
    confirmGrownUps();
    setGateOpen(false);
    proceedCustom();
  }, [proceedCustom]);
  const cancelGate = useCallback(() => setGateOpen(false), []);
  useEffect(() => {
    if (phase !== 'choosing') setGateOpen(false);
  }, [phase]);
  const changeCustom = useCallback((text: string) => dispatch({ type: 'CUSTOM_TEXT', text }), []);
  const submitCustom = useCallback(() => {
    const current = latestWallet.current;
    if (!canAfford(current, current?.sceneCost ?? 1)) {
      dispatch({ type: 'NEED_SPARKS', prompt: { kind: 'custom' } });
      return;
    }
    markChoice('custom');
    dispatch({ type: 'SUBMIT_CUSTOM' });
  }, [latestWallet]);

  // After buying Sparks, carry on with exactly what the family was doing.
  const closeSparks = useCallback(() => dispatch({ type: 'SPARKS_DISMISSED' }), []);
  const sparksDone = useCallback(() => {
    const prompt = latestState.current.sparksPrompt;
    dispatch({ type: 'SPARKS_DISMISSED' });
    if (prompt?.kind === 'choice') choose(prompt.index);
    else if (prompt?.kind === 'custom') submitCustom();
    else if (prompt?.kind === 'openCustom') proceedCustom();
  }, [latestState, choose, submitCustom, proceedCustom]);

  // On private paths nothing is filmed ahead, so prepare the choice a family lingers on.
  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );
  const onFocusChoice = useCallback(
    (index: number | null) => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
      focusTimer.current = null;
      if (index === null) return;
      focusTimer.current = setTimeout(() => {
        focusTimer.current = null;
        const current = latestState.current;
        const currentScene = current.scene;
        if (!currentScene || current.phase !== 'choosing' || current.filmingPaused || !isPrivatePath(currentScene)) {
          return;
        }
        const choice = currentScene.choices.find((item) => item.index === index);
        if (!choice || choice.ready || closedChoices(current).includes(index)) return;
        if (!canAfford(latestWallet.current, choice.sparks)) return;
        const key = `${currentScene.id}:${index}`;
        if (prefetchedChoices.current.has(key)) return;
        prefetchedChoices.current.add(key);
        logTiming('preparing focused choice', String(index));
        api
          .prefetchChild(currentScene.id, { index }, { signal: lifetime.signal })
          .then((parent) => dispatch({ type: 'NODE_UPDATE', scene: parent }))
          .catch((error) => {
            if (!isAbortError(error)) prefetchedChoices.current.delete(key);
          });
      }, FOCUS_PREFETCH_MS);
    },
    [latestState, latestWallet, lifetime],
  );
  // When nobody presses anything, the story carries on along a filmed, free path.
  const [autoPickLeft, setAutoPickLeft] = useState<number | null>(null);
  const [autoPickOffFor, setAutoPickOffFor] = useState<string | null>(null);
  const stopAutoPick = useCallback(() => {
    const id = latestState.current.scene?.id;
    if (id) setAutoPickOffFor(id);
  }, [latestState]);
  const canAutoPick =
    !!scene &&
    phase === 'choosing' &&
    !pathEnded &&
    !state.menuOpen &&
    !gateOpen &&
    isFocused &&
    appActive &&
    autoPickOffFor !== scene.id &&
    autoPickCandidates(state).length > 0;
  useEffect(() => {
    if (!canAutoPick) {
      setAutoPickLeft(null);
      return;
    }
    let left = AUTO_PICK_SECONDS;
    setAutoPickLeft(left);
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setAutoPickLeft(left);
        if (left <= 3) playUiSound('tick');
        return;
      }
      clearInterval(timer);
      setAutoPickLeft(null);
      stopAutoPick();
      const index = pickAtRandom(autoPickCandidates(latestState.current));
      if (index !== null) choose(index);
    }, 1000);
    return () => clearInterval(timer);
  }, [canAutoPick, scene?.id, choose, latestState, stopAutoPick]);

  const cancelCustom = useCallback(() => dispatch({ type: 'CANCEL_CUSTOM' }), []);
  const resume = useCallback(() => dispatch({ type: 'CLOSE_MENU' }), []);

  const openReport = useCallback(() => {
    setReport({ sending: false, error: null });
    dispatch({ type: 'OPEN_REPORT' });
  }, []);
  const cancelReport = useCallback(() => dispatch({ type: 'CLOSE_REPORT' }), []);
  const reporting = useRef(false);
  const sendReport = useCallback(
    async (reason: ReportReason) => {
      const nodeId = latestState.current.reportNodeId;
      if (!nodeId || reporting.current) return;
      reporting.current = true;
      setReport({ sending: true, error: null });
      try {
        await api.reportNode(nodeId, { reason, storyId: session.storyId }, { signal: lifetime.signal });
        markReported(nodeId);
        probedChildren.current.clear();
        setReport({ sending: false, error: null });
        dispatch({ type: 'SCENE_REPORTED', nodeId });
      } catch (error) {
        if (!isAbortError(error)) setReport({ sending: false, error: messages.reportFailed });
      } finally {
        reporting.current = false;
      }
    },
    [latestState, session.storyId, lifetime],
  );
  const dismissNotice = useCallback((id: number) => dispatch({ type: 'DISMISS_NOTICE', id }), []);

  const waiting = waitingLabel(state);
  const layersActive = isFocused && !state.menuOpen && !state.sparksPrompt && !gateOpen;
  const canReport = !!scene && phase !== 'loadingScene' && phase !== 'error' && phase !== 'finished';
  const customCost = wallet?.sceneCost ?? 1;

  return (
    <ToneContext.Provider value={tone}>
      <View style={styles.screen}>
        <ClipPlayer
          source={playSource}
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
            folio={formatFolio(scene.sceneNumber, scene.totalScenes)}
            madeIn={formatMadeIn(scene.generationMs)}
            showToken={captionToken}
          />
        )}

        {pathEnded && !state.menuOpen && (
          <PathEndPanel active={isFocused} restarting={restarting} onStartOver={startOver} onExit={exitHome} />
        )}

        {scene && phase === 'choosing' && !pathEnded && !scene.continues && (
          <ChoiceOverlay
            scene={scene}
            closedChoices={closedChoices(state)}
            notFilmedChoices={notFilmedChoices(state)}
            customPaused={state.filmingPaused}
            customCost={customCost}
            freeSparks={wallet?.freeSparks ?? 0}
            active={layersActive && phase === 'choosing'}
            autoPickSeconds={autoPickLeft}
            onChoose={choose}
            onSomethingElse={openCustom}
            onFocusChoice={onFocusChoice}
          />
        )}

        {phase === 'customInput' && (
          <CustomChoiceSheet
            active={layersActive}
            text={state.customText}
            error={state.customError}
            costText={costLabel(wallet, customCost)}
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
                  ? 'This takes a few seconds.'
                  : null
            }
            delayMs={phase === 'waitingNext' && state.waitKind === 'preset' ? 600 : 400}
          />
        )}

        {inPlayback && state.userPaused && !state.menuOpen && <PausedBadge />}

        {state.notice && <Notice id={state.notice.id} text={state.notice.text} onDismiss={dismissNotice} />}

        {phase === 'error' && state.error && (
          <StoryErrorPanel
            message={state.error.message}
            active={isFocused}
            onRetry={retry}
            actionLabel={state.error.code === 'path_closed' ? 'Home' : undefined}
            actionIcon={state.error.code === 'path_closed' ? 'home' : undefined}
          />
        )}

        {gateOpen && phase === 'choosing' && !state.menuOpen && (
          <GrownUpsGate active={isFocused && !state.sparksPrompt} onPass={passGate} onCancel={cancelGate} />
        )}

        {state.sparksPrompt && !state.menuOpen && (
          <SparksSheet active={isFocused} onDone={sparksDone} onClose={closeSparks} />
        )}

        {state.menuOpen && !state.reportNodeId && (
          <PauseMenu
            title={session.title}
            active={isFocused}
            restarting={restarting}
            onResume={resume}
            onStartOver={startOver}
            onExit={exitHome}
            onReport={canReport ? openReport : undefined}
          />
        )}

        {state.menuOpen && state.reportNodeId && (
          <ReportSheet
            active={isFocused}
            sending={report.sending}
            error={report.error}
            onPick={sendReport}
            onCancel={cancelReport}
          />
        )}
      </View>
    </ToneContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ink,
  },
});
