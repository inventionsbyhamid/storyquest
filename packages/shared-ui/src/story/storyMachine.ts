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

export interface ChoiceSync {
  id: number;
  fromNodeId: string;
  index: number;
  nodeId: string;
}

// The action to resume once the family has enough Sparks.
export type SparksPrompt = { kind: 'choice'; index: number } | { kind: 'custom' } | { kind: 'openCustom' };

export interface StoryState {
  phase: StoryPhase;
  sparksPrompt: SparksPrompt | null;
  scene: SceneView | null;
  // The scene before this one, where the family can choose again if this one is reported.
  previousScene: SceneView | null;
  childScenes: Record<string, SceneView>;
  syncs: ChoiceSync[];
  syncSeq: number;
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
  // Scenes this family reported. Choices leading to them are closed.
  hiddenNodes: string[];
  // The scene the report sheet is about, while it is open.
  reportNodeId: string | null;
  // The current scene was reported, so its frames stay covered.
  sceneHidden: boolean;
  // A budget cap stops new scenes: only choices already filmed can be taken.
  filmingPaused: boolean;
}

export type StoryEvent =
  | { type: 'NODE_UPDATE'; scene: SceneView }
  | { type: 'NODE_WAIT_FAILED'; nodeId: string; code: ApiErrorCode }
  | { type: 'CHILD_SCENE'; scene: SceneView }
  | { type: 'SYNC_DONE'; id: number }
  | { type: 'SYNC_FAILED'; id: number }
  | { type: 'NEED_SPARKS'; prompt: SparksPrompt }
  | { type: 'SPARKS_DISMISSED' }
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
  | { type: 'OPEN_REPORT' }
  | { type: 'CLOSE_REPORT' }
  | { type: 'SCENE_REPORTED'; nodeId: string }
  | { type: 'FILMING_PAUSED'; paused: boolean }
  | { type: 'RESET'; nodeId: string; posterUrl: string | null }
  | { type: 'NOTICE'; text: string }
  | { type: 'DISMISS_NOTICE'; id: number };

export interface StoryStart {
  nodeId: string;
  posterUrl?: string | null;
  hiddenNodes?: string[];
  filmingPaused?: boolean;
}

export function createStoryState({
  nodeId,
  posterUrl = null,
  hiddenNodes = [],
  filmingPaused = false,
}: StoryStart): StoryState {
  return {
    phase: 'loadingScene',
    sparksPrompt: null,
    scene: null,
    previousScene: null,
    childScenes: {},
    syncs: [],
    syncSeq: 0,
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
    hiddenNodes,
    reportNodeId: null,
    sceneHidden: false,
    filmingPaused,
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
    sparksPrompt: null,
    scene,
    previousScene: state.scene && state.scene.id !== scene.id ? state.scene : state.previousScene,
    childScenes: {},
    still: state.still ?? scene.posterUrl,
    clipStarted: false,
    disabledChoices: [],
    customText: '',
    customError: null,
    notice: null,
    error: null,
    userPaused: false,
    sceneHidden: false,
  };
}

function failPending(state: StoryState, code: ApiErrorCode | 'node_failed'): StoryState {
  if (state.phase === 'loadingScene') {
    return { ...state, phase: 'error', error: { code, message: messageForError(code, 'start') } };
  }
  if (state.phase !== 'waitingNext') return state;

  const kind = state.waitKind ?? 'preset';
  const pathFailed = code === 'node_failed' || code === 'generation_failed' || code === 'path_closed';
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

// Private paths are filmed only for this family, so the server prepares just the choice they focus on.
export function isPrivatePath(scene: SceneView | null): boolean {
  return !!scene && scene.choices.some((choice) => choice.sparks > 0);
}

export function isPlayable(scene: SceneView | undefined): scene is SceneView {
  return !!scene && scene.status === 'ready' && !!scene.clipUrl;
}

function onChildScene(state: StoryState, child: SceneView): StoryState {
  const current = state.scene;
  if (!current) return state;
  const choice = current.choices.find((item) => item.nodeId === child.id);
  if (!choice) return state;
  // A child that failed or was taken down cannot be played: close that path.
  if (child.status === 'failed') {
    if (state.disabledChoices.includes(choice.index)) return state;
    return { ...state, disabledChoices: [...state.disabledChoices, choice.index] };
  }
  if (!isPlayable(child)) return state;
  if (state.childScenes[child.id]?.clipUrl === child.clipUrl) return state;
  return { ...state, childScenes: { ...state.childScenes, [child.id]: child } };
}

function onChoose(state: StoryState, index: number): StoryState {
  if (state.phase !== 'choosing' || state.menuOpen || !state.scene) return state;
  const choice = state.scene.choices.find((c) => c.index === index);
  if (!choice) return state;
  if (closedChoices(state).includes(index)) return withNotice(state, messages.pathClosed);
  if (notFilmedChoices(state).includes(index)) return withNotice(state, messageForError('budget_exhausted', 'preset'));

  // The next scene is already on the device: play it now and tell the server in the background.
  // Paid scenes wait for the server to accept the choice, because that is when Sparks are charged.
  const cached = choice.nodeId ? state.childScenes[choice.nodeId] : undefined;
  if (choice.ready && choice.sparks === 0 && isPlayable(cached)) {
    const id = state.syncSeq + 1;
    const sync: ChoiceSync = { id, fromNodeId: state.scene.id, index, nodeId: cached.id };
    return { ...startScene(state, cached), syncs: [...state.syncs, sync], syncSeq: id };
  }

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

function onChoiceFailed(current: StoryState, seq: number, code: ApiErrorCode): StoryState {
  if (current.phase !== 'waitingNext' || seq !== current.requestSeq) return current;
  const state = code === 'budget_exhausted' ? { ...current, filmingPaused: true } : current;
  if (code === 'payment_required') {
    if (state.waitKind === 'custom') {
      return { ...clearPending(state), phase: 'customInput', sparksPrompt: { kind: 'custom' } };
    }
    const index = state.pendingChoice ?? 0;
    return { ...clearPending(state), phase: 'choosing', sparksPrompt: { kind: 'choice', index } };
  }
  if (state.waitKind === 'custom' && code !== 'budget_exhausted') {
    return {
      ...clearPending(state),
      phase: 'customInput',
      customError: messageForError(code, 'custom'),
    };
  }
  return failPending(state, code);
}

// The family reported a scene: hide it for them, close the menu and carry on. If it is the scene
// on screen, cover it and go straight to what happens next.
function onSceneReported(state: StoryState, nodeId: string): StoryState {
  const childScenes = { ...state.childScenes };
  delete childScenes[nodeId];
  let next: StoryState = {
    ...state,
    hiddenNodes: state.hiddenNodes.includes(nodeId) ? state.hiddenNodes : [...state.hiddenNodes, nodeId],
    childScenes,
    reportNodeId: null,
    menuOpen: false,
    userPaused: false,
  };
  if (!state.scene || state.scene.id !== nodeId) return withNotice(next, messages.reportThanks);

  // The reported scene is gone for everyone, so the story picks up at the choice before it.
  const back = state.previousScene;
  const cleared: StoryState = {
    ...clearPending(next),
    sparksPrompt: null,
    childScenes: {},
    clipStarted: true,
    customText: '',
    customError: null,
    requestSeq: state.requestSeq + 1,
  };
  if (back && !back.isEnding && back.choices.length > 0) {
    const still = back.lastFrameUrl ?? back.posterUrl ?? null;
    return withNotice(
      {
        ...cleared,
        phase: 'choosing',
        scene: back,
        previousScene: null,
        still,
        sceneHidden: !still,
        disabledChoices: [],
      },
      messages.reportThanks,
    );
  }
  return withNotice(
    {
      ...cleared,
      phase: 'error',
      still: null,
      sceneHidden: true,
      error: { code: 'path_closed', message: messages.storyRemoved },
    },
    messages.reportThanks,
  );
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

    case 'CHILD_SCENE':
      return onChildScene(state, event.scene);

    case 'SYNC_DONE':
      if (!state.syncs.some((sync) => sync.id === event.id)) return state;
      return { ...state, syncs: state.syncs.filter((sync) => sync.id !== event.id) };

    case 'SYNC_FAILED':
      if (!state.syncs.some((sync) => sync.id === event.id)) return state;
      return withNotice(
        { ...state, syncs: state.syncs.filter((sync) => sync.id !== event.id) },
        messages.choiceNotSaved,
      );

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
      if (state.filmingPaused) return withNotice(state, messageForError('budget_exhausted', 'custom'));
      return { ...state, phase: 'customInput', customError: null, notice: null, sparksPrompt: null };

    case 'NEED_SPARKS':
      if (state.phase !== 'choosing' && state.phase !== 'customInput') return state;
      return { ...state, sparksPrompt: event.prompt };

    case 'SPARKS_DISMISSED':
      return state.sparksPrompt ? { ...state, sparksPrompt: null } : state;

    case 'CUSTOM_TEXT':
      if (state.phase !== 'customInput') return state;
      return { ...state, customText: event.text, customError: null };

    case 'SUBMIT_CUSTOM':
      return onSubmitCustom(state);

    case 'CANCEL_CUSTOM':
      if (state.phase !== 'customInput') return state;
      return { ...state, phase: 'choosing', customError: null };

    case 'BACK':
      if (state.sparksPrompt) return { ...state, sparksPrompt: null };
      if (state.reportNodeId) return { ...state, reportNodeId: null };
      if (state.menuOpen) return { ...state, menuOpen: false };
      if (state.phase === 'customInput') return { ...state, phase: 'choosing', customError: null };
      if (state.phase === 'finished') return state;
      return { ...state, menuOpen: true };

    case 'OPEN_MENU':
      if (state.menuOpen || state.phase === 'finished') return state;
      return { ...state, menuOpen: true };

    case 'CLOSE_MENU':
      if (!state.menuOpen) return state;
      return { ...state, menuOpen: false, reportNodeId: null, userPaused: false };

    case 'OPEN_REPORT':
      if (!state.menuOpen || !state.scene || state.reportNodeId) return state;
      return { ...state, reportNodeId: state.scene.id };

    case 'CLOSE_REPORT':
      return state.reportNodeId ? { ...state, reportNodeId: null } : state;

    case 'SCENE_REPORTED':
      return onSceneReported(state, event.nodeId);

    case 'TOGGLE_PAUSE':
      if (state.reportNodeId) return state;
      if (state.menuOpen) return { ...state, menuOpen: false, userPaused: false };
      if (!isPlaybackPhase(state.phase)) return state;
      return { ...state, userPaused: !state.userPaused };

    case 'SET_PAUSED':
      if (!isPlaybackPhase(state.phase)) return state;
      if (event.paused) return state.userPaused || state.menuOpen ? state : { ...state, userPaused: true };
      if (state.reportNodeId) return state;
      return state.userPaused || state.menuOpen ? { ...state, userPaused: false, menuOpen: false } : state;

    case 'RETRY':
      if (state.phase !== 'error') return state;
      return { ...state, phase: 'loadingScene', error: null, pollSeq: state.pollSeq + 1 };

    case 'RESET':
      return {
        ...createStoryState({
          nodeId: event.nodeId,
          posterUrl: event.posterUrl ?? state.still,
          hiddenNodes: state.hiddenNodes,
          filmingPaused: state.filmingPaused,
        }),
        noticeSeq: state.noticeSeq,
        syncSeq: state.syncSeq,
        pollSeq: state.pollSeq + 1,
        requestSeq: state.requestSeq + 1,
      };

    case 'FILMING_PAUSED':
      return state.filmingPaused === event.paused ? state : { ...state, filmingPaused: event.paused };

    case 'NOTICE':
      return withNotice(state, event.text);

    case 'DISMISS_NOTICE':
      if (!state.notice || state.notice.id !== event.id) return state;
      return { ...state, notice: null };

    default:
      return state;
  }
}

// Choices the family cannot take: paths that failed and paths to scenes they reported.
export function closedChoices(state: StoryState): number[] {
  const scene = state.scene;
  if (!scene) return state.disabledChoices;
  const hidden = scene.choices
    .filter((choice) => choice.nodeId !== null && state.hiddenNodes.includes(choice.nodeId))
    .map((choice) => choice.index);
  if (hidden.length === 0) return state.disabledChoices;
  return [...state.disabledChoices, ...hidden.filter((index) => !state.disabledChoices.includes(index))];
}

// While filming is paused, choices nobody has filmed yet cannot be taken.
export function notFilmedChoices(state: StoryState): number[] {
  const scene = state.scene;
  if (!state.filmingPaused || !scene) return [];
  const closed = closedChoices(state);
  return scene.choices
    .filter((choice) => choice.nodeId === null && !choice.ready && !closed.includes(choice.index))
    .map((choice) => choice.index);
}

export function isStillVisible(state: StoryState): boolean {
  if (state.sceneHidden) return true;
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
  if (state.phase === 'loadingScene') return 'Starting the story';
  if (state.phase !== 'waitingNext') return null;
  return state.waitKind === 'custom' ? 'Filming your idea' : 'Drawing the next scene';
}
