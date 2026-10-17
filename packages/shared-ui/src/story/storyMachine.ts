import type { ChoiceView, SceneView } from '@storyquest/contracts';
import type { ApiErrorCode } from '../api/errors';
import { CUSTOM_CHOICE_LIMITS, checkPromptText } from './format';
import { messageForError, messages } from './messages';

export type StoryPhase =
  | 'loadingScene'
  | 'playing'
  | 'ending'
  | 'choosing'
  | 'customInput'
  | 'waitingNext'
  | 'finished'
  | 'error';

export type WaitKind = 'preset' | 'custom';

export interface StoryNotice {
  id: number;
  text: string;
}

export interface StoryError {
  code: ApiErrorCode | 'node_failed';
  message: string;
}

export interface StoryState {
  phase: StoryPhase;
  scene: SceneView | null;
  pendingNodeId: string | null;
  waitKind: WaitKind | null;
  pendingChoice: number | null;
  choiceAccepted: boolean;
  stashedScene: SceneView | null;
  requestSeq: number;
  pollSeq: number;
  still: string | null;
  clipStarted: boolean;
  disabledChoices: number[];
  customText: string;
  customError: string | null;
  notice: StoryNotice | null;
  noticeSeq: number;
  error: StoryError | null;
  menuOpen: boolean;
  userPaused: boolean;
}

export type StoryEvent =
  | { type: 'NODE_UPDATE'; scene: SceneView }
  | { type: 'NODE_WAIT_FAILED'; nodeId: string; code: ApiErrorCode }
  | { type: 'CLIP_PLAYING'; clipUrl: string }
  | { type: 'CLIP_ENDED'; clipUrl: string }
  | { type: 'CLIP_FAILED'; clipUrl: string }
  | { type: 'CHOOSE'; index: number }
  | { type: 'CHOICE_ACCEPTED'; seq: number; nextNodeId: string }
  | { type: 'CHOICE_FAILED'; seq: number; code: ApiErrorCode }
  | { type: 'OPEN_CUSTOM' }
  | { type: 'CUSTOM_TEXT'; text: string }
  | { type: 'SUBMIT_CUSTOM' }
  | { type: 'CANCEL_CUSTOM' }
  | { type: 'BACK' }
  | { type: 'OPEN_MENU' }
  | { type: 'CLOSE_MENU' }
  | { type: 'TOGGLE_PAUSE' }
  | { type: 'SET_PAUSED'; paused: boolean }
  | { type: 'RETRY' }
  | { type: 'RESET'; nodeId: string; posterUrl: string | null }
  | { type: 'NOTICE'; text: string }
  | { type: 'DISMISS_NOTICE'; id: number };

export interface StoryStart {
  nodeId: string;
  posterUrl?: string | null;
}

export function createStoryState({ nodeId, posterUrl = null }: StoryStart): StoryState {
  return {
    phase: 'loadingScene',
    scene: null,
    pendingNodeId: nodeId,
    waitKind: null,
    pendingChoice: null,
    choiceAccepted: true,
    stashedScene: null,
    requestSeq: 0,
    pollSeq: 0,
    still: posterUrl,
    clipStarted: false,
    disabledChoices: [],
    customText: '',
    customError: null,
    notice: null,
    noticeSeq: 0,
    error: null,
    menuOpen: false,
    userPaused: false,
  };
}

const isPlaybackPhase = (phase: StoryPhase) => phase === 'playing' || phase === 'ending';

function withNotice(state: StoryState, text: string): StoryState {
  const id = state.noticeSeq + 1;
  return { ...state, noticeSeq: id, notice: { id, text } };
}

function clearPending(state: StoryState): StoryState {
  return {
    ...state,
    pendingNodeId: null,
    waitKind: null,
    pendingChoice: null,
    choiceAccepted: true,
    stashedScene: null,
  };
}

function choicesChanged(a: ChoiceView[], b: ChoiceView[]): boolean {
  if (a.length !== b.length) return true;
  return a.some(
    (choice, i) =>
      choice.ready !== b[i].ready ||
      choice.nodeId !== b[i].nodeId ||
      choice.posterUrl !== b[i].posterUrl ||
      choice.label !== b[i].label,
  );
}

function startScene(state: StoryState, scene: SceneView): StoryState {
  return {
    ...clearPending(state),
    phase: scene.isEnding ? 'ending' : 'playing',
    scene,
    still: state.still ?? scene.posterUrl,
    clipStarted: false,
    disabledChoices: [],
    customText: '',
    customError: null,
    notice: null,
    error: null,
    userPaused: false,
  };
}

function failPending(state: StoryState, code: ApiErrorCode | 'node_failed'): StoryState {
  if (state.phase === 'loadingScene') {
    return { ...state, phase: 'error', error: { code, message: messageForError(code, 'start') } };
  }
  if (state.phase !== 'waitingNext') return state;

  const kind = state.waitKind ?? 'preset';
  const pathFailed = code === 'node_failed' || code === 'generation_failed';
  let next: StoryState = { ...clearPending(state), phase: 'choosing' };
  if (kind === 'preset' && pathFailed && state.pendingChoice !== null) {
    next = { ...next, disabledChoices: [...state.disabledChoices, state.pendingChoice] };
  }
  return withNotice(next, messageForError(code, kind));
}

function onNodeUpdate(state: StoryState, scene: SceneView): StoryState {
  if (state.pendingNodeId === scene.id) {
    if (scene.status === 'ready' && scene.clipUrl) {
      if (state.phase === 'loadingScene') return startScene(state, scene);
      if (state.phase === 'waitingNext') {
        return state.choiceAccepted ? startScene(state, scene) : { ...state, stashedScene: scene };
      }
      return state;
    }
    if (scene.status === 'failed' || scene.status === 'ready') {
      if (state.phase === 'waitingNext' && !state.choiceAccepted) return { ...state, stashedScene: scene };
      return failPending(state, 'node_failed');
    }
    return state;
  }

  if (state.scene && state.scene.id === scene.id && choicesChanged(state.scene.choices, scene.choices)) {
    return { ...state, scene: { ...state.scene, choices: scene.choices } };
  }
  return state;
}

function onClipFinished(state: StoryState, clipUrl: string, failed: boolean): StoryState {
  if (!isPlaybackPhase(state.phase) || !state.scene || state.scene.clipUrl !== clipUrl) return state;
  const scene = state.scene;
  const still = scene.lastFrameUrl ?? scene.posterUrl ?? state.still;
  const base = { ...state, still, clipStarted: true, userPaused: false };

  if (state.phase === 'ending' || scene.choices.length === 0) {
    return { ...base, phase: 'finished', menuOpen: false };
  }
  const next: StoryState = { ...base, phase: 'choosing' };
  return failed ? withNotice(next, messages.sceneWouldNotPlay) : next;
}

function onChoose(state: StoryState, index: number): StoryState {
  if (state.phase !== 'choosing' || state.menuOpen || !state.scene) return state;
  const choice = state.scene.choices.find((c) => c.index === index);
  if (!choice) return state;
  if (state.disabledChoices.includes(index)) return withNotice(state, messages.pathClosed);

  return {
    ...state,
    phase: 'waitingNext',
    waitKind: 'preset',
    pendingChoice: index,
    pendingNodeId: choice.ready ? choice.nodeId : null,
    choiceAccepted: false,
    stashedScene: null,
    requestSeq: state.requestSeq + 1,
    notice: null,
  };
}

function onChoiceAccepted(state: StoryState, seq: number, nextNodeId: string): StoryState {
  if (state.phase !== 'waitingNext' || seq !== state.requestSeq) return state;
  const stashed = state.stashedScene;
  const accepted: StoryState = { ...state, choiceAccepted: true, pendingNodeId: nextNodeId, stashedScene: null };
  if (stashed && stashed.id === nextNodeId) return onNodeUpdate(accepted, stashed);
  return accepted;
}

function onChoiceFailed(state: StoryState, seq: number, code: ApiErrorCode): StoryState {
  if (state.phase !== 'waitingNext' || seq !== state.requestSeq) return state;
  if (state.waitKind === 'custom' && code !== 'budget_exhausted') {
    return {
      ...clearPending(state),
      phase: 'customInput',
      customError: messageForError(code, 'custom'),
    };
  }
  return failPending(state, code);
}

function onSubmitCustom(state: StoryState): StoryState {
  if (state.phase !== 'customInput') return state;
  const check = checkPromptText(state.customText, CUSTOM_CHOICE_LIMITS.min, CUSTOM_CHOICE_LIMITS.max);
  if (!check.ok) return { ...state, customError: check.message };
  return {
    ...state,
    phase: 'waitingNext',
    waitKind: 'custom',
    pendingChoice: null,
    pendingNodeId: null,
    choiceAccepted: false,
    stashedScene: null,
    customText: check.text,
    customError: null,
    requestSeq: state.requestSeq + 1,
    notice: null,
  };
}

export function storyReducer(state: StoryState, event: StoryEvent): StoryState {
  switch (event.type) {
    case 'NODE_UPDATE':
      return onNodeUpdate(state, event.scene);

    case 'NODE_WAIT_FAILED':
      if (event.nodeId !== state.pendingNodeId) return state;
      if (state.phase === 'waitingNext' && !state.choiceAccepted) return { ...state, pendingNodeId: null };
      return failPending(state, event.code);

    case 'CLIP_PLAYING':
      if (!isPlaybackPhase(state.phase) || state.clipStarted || state.scene?.clipUrl !== event.clipUrl) return state;
      return { ...state, clipStarted: true };

    case 'CLIP_ENDED':
      return onClipFinished(state, event.clipUrl, false);

    case 'CLIP_FAILED':
      return onClipFinished(state, event.clipUrl, true);

    case 'CHOOSE':
      return onChoose(state, event.index);

    case 'CHOICE_ACCEPTED':
      return onChoiceAccepted(state, event.seq, event.nextNodeId);

    case 'CHOICE_FAILED':
      return onChoiceFailed(state, event.seq, event.code);

    case 'OPEN_CUSTOM':
      if (state.phase !== 'choosing' || state.menuOpen) return state;
      return { ...state, phase: 'customInput', customError: null, notice: null };

    case 'CUSTOM_TEXT':
      if (state.phase !== 'customInput') return state;
      return { ...state, customText: event.text, customError: null };

    case 'SUBMIT_CUSTOM':
      return onSubmitCustom(state);

    case 'CANCEL_CUSTOM':
      if (state.phase !== 'customInput') return state;
      return { ...state, phase: 'choosing', customError: null };

    case 'BACK':
      if (state.menuOpen) return { ...state, menuOpen: false };
      if (state.phase === 'customInput') return { ...state, phase: 'choosing', customError: null };
      if (state.phase === 'finished') return state;
      return { ...state, menuOpen: true };

    case 'OPEN_MENU':
      if (state.menuOpen || state.phase === 'finished') return state;
      return { ...state, menuOpen: true };

    case 'CLOSE_MENU':
      if (!state.menuOpen) return state;
      return { ...state, menuOpen: false, userPaused: false };

    case 'TOGGLE_PAUSE':
      if (state.menuOpen) return { ...state, menuOpen: false, userPaused: false };
      if (!isPlaybackPhase(state.phase)) return state;
      return { ...state, userPaused: !state.userPaused };

    case 'SET_PAUSED':
      if (!isPlaybackPhase(state.phase)) return state;
      if (event.paused) return state.userPaused || state.menuOpen ? state : { ...state, userPaused: true };
      return state.userPaused || state.menuOpen ? { ...state, userPaused: false, menuOpen: false } : state;

    case 'RETRY':
      if (state.phase !== 'error') return state;
      return { ...state, phase: 'loadingScene', error: null, pollSeq: state.pollSeq + 1 };

    case 'RESET':
      return {
        ...createStoryState({ nodeId: event.nodeId, posterUrl: event.posterUrl ?? state.still }),
        noticeSeq: state.noticeSeq,
        pollSeq: state.pollSeq + 1,
        requestSeq: state.requestSeq + 1,
      };

    case 'NOTICE':
      return withNotice(state, event.text);

    case 'DISMISS_NOTICE':
      if (!state.notice || state.notice.id !== event.id) return state;
      return { ...state, notice: null };

    default:
      return state;
  }
}

export function isStillVisible(state: StoryState): boolean {
  if (!state.still) return false;
  return !(isPlaybackPhase(state.phase) && state.clipStarted);
}

export function isPlayerPaused(state: StoryState): boolean {
  return !isPlaybackPhase(state.phase) || state.menuOpen || state.userPaused;
}

export function shouldWatchChoices(state: StoryState): boolean {
  const { scene, phase } = state;
  if (!scene || scene.isEnding || scene.status !== 'ready') return false;
  if (phase !== 'playing' && phase !== 'choosing' && phase !== 'customInput') return false;
  return !scene.choices.every((choice) => choice.ready);
}

export function waitingLabel(state: StoryState): string | null {
  if (state.phase === 'loadingScene') return 'Setting the scene';
  if (state.phase !== 'waitingNext') return null;
  return state.waitKind === 'custom' ? 'The story bends' : 'Drawing the next scene';
}
