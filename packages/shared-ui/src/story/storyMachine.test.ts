import { describe, expect, it } from 'vitest';
import { makeChoice, makeScene } from '../test/fixtures';
import {
  StoryEvent,
  StoryState,
  createStoryState,
  isPlayerPaused,
  isStillVisible,
  shouldWatchChoices,
  storyReducer,
  waitingLabel,
} from './storyMachine';
import { messages } from './messages';

const run = (state: StoryState, ...events: StoryEvent[]) => events.reduce(storyReducer, state);

const root = makeScene({ id: 'root' });
const child0 = makeScene({ id: 'child-0', sceneNumber: 2, depth: 1 });
const ending = makeScene({ id: 'end-1', sceneNumber: 6, isEnding: true, choices: [] });

function playing(): StoryState {
  return run(createStoryState({ nodeId: 'root', posterUrl: '/idea.jpg' }), { type: 'NODE_UPDATE', scene: root });
}

function choosing(): StoryState {
  return run(
    playing(),
    { type: 'CLIP_PLAYING', clipUrl: root.clipUrl! },
    { type: 'CLIP_ENDED', clipUrl: root.clipUrl! },
  );
}

describe('loading the first scene', () => {
  it('starts in loadingScene with the idea poster as the still', () => {
    const state = createStoryState({ nodeId: 'root', posterUrl: '/idea.jpg' });
    expect(state.phase).toBe('loadingScene');
    expect(state.pendingNodeId).toBe('root');
    expect(isStillVisible(state)).toBe(true);
    expect(waitingLabel(state)).toBe('Setting the scene');
    expect(isPlayerPaused(state)).toBe(true);
  });

  it('ignores updates while the node is still generating', () => {
    const state = createStoryState({ nodeId: 'root' });
    const next = storyReducer(state, {
      type: 'NODE_UPDATE',
      scene: makeScene({ id: 'root', status: 'generating', clipUrl: null }),
    });
    expect(next).toBe(state);
  });

  it('plays once the node is ready and keeps the still until the clip reports playing', () => {
    const state = playing();
    expect(state.phase).toBe('playing');
    expect(state.scene?.id).toBe('root');
    expect(state.pendingNodeId).toBeNull();
    expect(isStillVisible(state)).toBe(true);
    expect(isPlayerPaused(state)).toBe(false);

    const started = storyReducer(state, { type: 'CLIP_PLAYING', clipUrl: root.clipUrl! });
    expect(started.clipStarted).toBe(true);
    expect(isStillVisible(started)).toBe(false);
  });

  it('falls back to the scene poster when no still was given', () => {
    const state = run(createStoryState({ nodeId: 'root' }), { type: 'NODE_UPDATE', scene: root });
    expect(state.still).toBe(root.posterUrl);
  });

  it('shows an error when the first node fails and retries polling', () => {
    const failed = run(createStoryState({ nodeId: 'root' }), {
      type: 'NODE_UPDATE',
      scene: makeScene({ id: 'root', status: 'failed', clipUrl: null }),
    });
    expect(failed.phase).toBe('error');
    expect(failed.error?.code).toBe('node_failed');
    expect(failed.error?.message).toBe(messages.storyCouldNotStart);

    const retried = storyReducer(failed, { type: 'RETRY' });
    expect(retried.phase).toBe('loadingScene');
    expect(retried.pollSeq).toBe(failed.pollSeq + 1);
    expect(retried.pendingNodeId).toBe('root');
  });

  it('treats a ready node without a clip as failed', () => {
    const state = run(createStoryState({ nodeId: 'root' }), {
      type: 'NODE_UPDATE',
      scene: makeScene({ id: 'root', clipUrl: null }),
    });
    expect(state.phase).toBe('error');
  });

  it('shows a network error when waiting gives up', () => {
    const state = run(createStoryState({ nodeId: 'root' }), {
      type: 'NODE_WAIT_FAILED',
      nodeId: 'root',
      code: 'network',
    });
    expect(state.phase).toBe('error');
    expect(state.error?.code).toBe('network');
  });

  it('starts an ending scene in the ending phase', () => {
    const state = run(createStoryState({ nodeId: 'end-1' }), { type: 'NODE_UPDATE', scene: ending });
    expect(state.phase).toBe('ending');
  });
});

describe('playback', () => {
  it('ignores clip events for other clips', () => {
    const state = playing();
    expect(storyReducer(state, { type: 'CLIP_ENDED', clipUrl: '/other.mp4' })).toBe(state);
    expect(storyReducer(state, { type: 'CLIP_PLAYING', clipUrl: '/other.mp4' })).toBe(state);
  });

  it('moves to choosing with the last frame as the still when the clip ends', () => {
    const state = choosing();
    expect(state.phase).toBe('choosing');
    expect(state.still).toBe(root.lastFrameUrl);
    expect(isStillVisible(state)).toBe(true);
    expect(isPlayerPaused(state)).toBe(true);
  });

  it('keeps going with a notice when the clip fails to play', () => {
    const state = run(playing(), { type: 'CLIP_FAILED', clipUrl: root.clipUrl! });
    expect(state.phase).toBe('choosing');
    expect(state.notice?.text).toBe(messages.sceneWouldNotPlay);
  });

  it('finishes after the ending clip', () => {
    const state = run(
      createStoryState({ nodeId: 'end-1' }),
      { type: 'NODE_UPDATE', scene: ending },
      { type: 'CLIP_ENDED', clipUrl: ending.clipUrl! },
    );
    expect(state.phase).toBe('finished');
    expect(state.still).toBe(ending.lastFrameUrl);
  });

  it('finishes when a scene has no choices even if not marked as ending', () => {
    const scene = makeScene({ id: 'root', choices: [] });
    const state = run(
      createStoryState({ nodeId: 'root' }),
      { type: 'NODE_UPDATE', scene },
      { type: 'CLIP_ENDED', clipUrl: scene.clipUrl! },
    );
    expect(state.phase).toBe('finished');
  });

  it('toggles pause during playback only', () => {
    const paused = storyReducer(playing(), { type: 'TOGGLE_PAUSE' });
    expect(paused.userPaused).toBe(true);
    expect(isPlayerPaused(paused)).toBe(true);
    expect(storyReducer(paused, { type: 'TOGGLE_PAUSE' }).userPaused).toBe(false);

    const state = choosing();
    expect(storyReducer(state, { type: 'TOGGLE_PAUSE' })).toBe(state);
  });

  it('applies pause and resume from voice commands idempotently', () => {
    const paused = run(playing(), { type: 'SET_PAUSED', paused: true }, { type: 'SET_PAUSED', paused: true });
    expect(paused.userPaused).toBe(true);
    const resumed = run(paused, { type: 'OPEN_MENU' }, { type: 'SET_PAUSED', paused: false });
    expect(resumed.userPaused).toBe(false);
    expect(resumed.menuOpen).toBe(false);
  });
});

describe('choices', () => {
  it('waits for the server to accept a ready choice before playing it', () => {
    const chosen = storyReducer(choosing(), { type: 'CHOOSE', index: 0 });
    expect(chosen.phase).toBe('waitingNext');
    expect(chosen.waitKind).toBe('preset');
    expect(chosen.pendingNodeId).toBe('child-0');
    expect(chosen.choiceAccepted).toBe(false);
    expect(waitingLabel(chosen)).toBe('Drawing the next scene');

    const stashed = storyReducer(chosen, { type: 'NODE_UPDATE', scene: child0 });
    expect(stashed.phase).toBe('waitingNext');
    expect(stashed.stashedScene?.id).toBe('child-0');

    const accepted = storyReducer(stashed, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-0' });
    expect(accepted.phase).toBe('playing');
    expect(accepted.scene?.id).toBe('child-0');
    expect(accepted.still).toBe(root.lastFrameUrl);
    expect(accepted.clipStarted).toBe(false);
    expect(isStillVisible(accepted)).toBe(true);
  });

  it('plays as soon as the node is ready when the choice was accepted first', () => {
    const chosen = storyReducer(choosing(), { type: 'CHOOSE', index: 0 });
    const accepted = storyReducer(chosen, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-0' });
    expect(accepted.phase).toBe('waitingNext');
    expect(accepted.choiceAccepted).toBe(true);
    const next = storyReducer(accepted, { type: 'NODE_UPDATE', scene: child0 });
    expect(next.phase).toBe('playing');
  });

  it('does not poll early for a choice that is not ready', () => {
    const scene = makeScene({
      id: 'root',
      choices: [makeChoice(0, { ready: false }), makeChoice(1, { ready: false, nodeId: null })],
    });
    const state = run(
      createStoryState({ nodeId: 'root' }),
      { type: 'NODE_UPDATE', scene },
      { type: 'CLIP_ENDED', clipUrl: scene.clipUrl! },
      { type: 'CHOOSE', index: 1 },
    );
    expect(state.pendingNodeId).toBeNull();
    const accepted = storyReducer(state, { type: 'CHOICE_ACCEPTED', seq: state.requestSeq, nextNodeId: 'child-1' });
    expect(accepted.pendingNodeId).toBe('child-1');
  });

  it('drops a stashed scene for a different node than the server chose', () => {
    const chosen = run(choosing(), { type: 'CHOOSE', index: 0 }, { type: 'NODE_UPDATE', scene: child0 });
    const accepted = storyReducer(chosen, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'other' });
    expect(accepted.phase).toBe('waitingNext');
    expect(accepted.pendingNodeId).toBe('other');
    expect(accepted.stashedScene).toBeNull();
  });

  it('restarts polling after an early poll failure', () => {
    const chosen = run(
      choosing(),
      { type: 'CHOOSE', index: 0 },
      { type: 'NODE_WAIT_FAILED', nodeId: 'child-0', code: 'network' },
    );
    expect(chosen.phase).toBe('waitingNext');
    expect(chosen.pendingNodeId).toBeNull();
    const accepted = storyReducer(chosen, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-0' });
    expect(accepted.pendingNodeId).toBe('child-0');
  });

  it('ignores stale server responses', () => {
    const chosen = storyReducer(choosing(), { type: 'CHOOSE', index: 0 });
    expect(storyReducer(chosen, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq - 1, nextNodeId: 'x' })).toBe(chosen);
    expect(storyReducer(chosen, { type: 'CHOICE_FAILED', seq: chosen.requestSeq - 1, code: 'network' })).toBe(chosen);
  });

  it('closes a failed path and returns to the choices', () => {
    const chosen = run(choosing(), { type: 'CHOOSE', index: 1 });
    const accepted = storyReducer(chosen, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-1' });
    const failed = storyReducer(accepted, {
      type: 'NODE_UPDATE',
      scene: makeScene({ id: 'child-1', status: 'failed', clipUrl: null }),
    });
    expect(failed.phase).toBe('choosing');
    expect(failed.disabledChoices).toEqual([1]);
    expect(failed.notice?.text).toBe(messages.pathClosed);
    expect(failed.pendingNodeId).toBeNull();

    const again = storyReducer(failed, { type: 'CHOOSE', index: 1 });
    expect(again.phase).toBe('choosing');
    expect(again.notice?.text).toBe(messages.pathClosed);
    expect(again.notice?.id).not.toBe(failed.notice?.id);
  });

  it('applies a stashed failure once the choice is accepted', () => {
    const failedScene = makeScene({ id: 'child-0', status: 'failed', clipUrl: null });
    const chosen = run(choosing(), { type: 'CHOOSE', index: 0 }, { type: 'NODE_UPDATE', scene: failedScene });
    expect(chosen.phase).toBe('waitingNext');
    const accepted = storyReducer(chosen, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-0' });
    expect(accepted.phase).toBe('choosing');
    expect(accepted.disabledChoices).toEqual([0]);
  });

  it('returns to the choices with a kind notice when the server rejects a preset choice', () => {
    const chosen = storyReducer(choosing(), { type: 'CHOOSE', index: 0 });
    const failed = storyReducer(chosen, { type: 'CHOICE_FAILED', seq: chosen.requestSeq, code: 'budget_exhausted' });
    expect(failed.phase).toBe('choosing');
    expect(failed.disabledChoices).toEqual([]);
    expect(failed.notice?.text).toBe('New paths are resting until tomorrow. Try the other choice.');
  });

  it('returns to the choices when the next scene takes too long', () => {
    const chosen = storyReducer(choosing(), { type: 'CHOOSE', index: 0 });
    const accepted = storyReducer(chosen, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-0' });
    const failed = storyReducer(accepted, { type: 'NODE_WAIT_FAILED', nodeId: 'child-0', code: 'timeout' });
    expect(failed.phase).toBe('choosing');
    expect(failed.notice?.text).toBe(messages.slowScene);
    expect(failed.disabledChoices).toEqual([]);
  });

  it('ignores choices outside the choosing phase or with the menu open', () => {
    const state = playing();
    expect(storyReducer(state, { type: 'CHOOSE', index: 0 })).toBe(state);
    const menu = storyReducer(choosing(), { type: 'OPEN_MENU' });
    expect(storyReducer(menu, { type: 'CHOOSE', index: 0 })).toBe(menu);
    const unknown = choosing();
    expect(storyReducer(unknown, { type: 'CHOOSE', index: 5 })).toBe(unknown);
  });

  it('refreshes choice readiness for the current scene without touching playback', () => {
    const scene = makeScene({
      id: 'root',
      choices: [makeChoice(0, { ready: false, posterUrl: null }), makeChoice(1, { ready: false })],
    });
    const state = run(
      createStoryState({ nodeId: 'root' }),
      { type: 'NODE_UPDATE', scene },
      { type: 'CLIP_PLAYING', clipUrl: scene.clipUrl! },
    );
    expect(shouldWatchChoices(state)).toBe(true);

    const same = storyReducer(state, { type: 'NODE_UPDATE', scene });
    expect(same).toBe(state);

    const refreshed = storyReducer(state, { type: 'NODE_UPDATE', scene: makeScene({ id: 'root' }) });
    expect(refreshed.scene?.choices.every((c) => c.ready)).toBe(true);
    expect(refreshed.phase).toBe('playing');
    expect(refreshed.clipStarted).toBe(true);
    expect(shouldWatchChoices(refreshed)).toBe(false);
  });

  it('does not watch choices for endings', () => {
    const state = run(createStoryState({ nodeId: 'end-1' }), { type: 'NODE_UPDATE', scene: ending });
    expect(shouldWatchChoices(state)).toBe(false);
  });
});

describe('instant choices', () => {
  const child1 = makeScene({ id: 'child-1', sceneNumber: 2, depth: 1 });

  function cached(): StoryState {
    return run(choosing(), { type: 'CHILD_SCENE', scene: child0 }, { type: 'CHILD_SCENE', scene: child1 });
  }

  it('keeps prefetched children of the current scene only', () => {
    const state = cached();
    expect(Object.keys(state.childScenes).sort()).toEqual(['child-0', 'child-1']);
    expect(storyReducer(state, { type: 'CHILD_SCENE', scene: child0 })).toBe(state);
    expect(storyReducer(state, { type: 'CHILD_SCENE', scene: makeScene({ id: 'stranger' }) })).toBe(state);
    const pending = makeScene({ id: 'child-0', status: 'generating', clipUrl: null });
    expect(storyReducer(choosing(), { type: 'CHILD_SCENE', scene: pending }).childScenes).toEqual({});
  });

  it('plays a cached child at once and queues the choice for the server', () => {
    const before = cached();
    const state = storyReducer(before, { type: 'CHOOSE', index: 1 });
    expect(state.phase).toBe('playing');
    expect(state.scene?.id).toBe('child-1');
    expect(state.pendingNodeId).toBeNull();
    expect(state.still).toBe(root.lastFrameUrl);
    expect(state.clipStarted).toBe(false);
    expect(isStillVisible(state)).toBe(true);
    expect(state.childScenes).toEqual({});
    expect(state.requestSeq).toBe(before.requestSeq);
    expect(state.syncs).toEqual([{ id: 1, fromNodeId: 'root', index: 1, nodeId: 'child-1' }]);
    expect(waitingLabel(state)).toBeNull();
  });

  it('plays a cached ending straight into the ending phase', () => {
    const endingChild = makeScene({ id: 'child-0', isEnding: true, choices: [] });
    const state = run(choosing(), { type: 'CHILD_SCENE', scene: endingChild }, { type: 'CHOOSE', index: 0 });
    expect(state.phase).toBe('ending');
  });

  it('falls back to waiting when the child is not cached or not ready', () => {
    const uncached = storyReducer(choosing(), { type: 'CHOOSE', index: 0 });
    expect(uncached.phase).toBe('waitingNext');
    expect(uncached.syncs).toEqual([]);

    const scene = makeScene({ id: 'root', choices: [makeChoice(0, { ready: false }), makeChoice(1)] });
    const notReady = run(
      createStoryState({ nodeId: 'root' }),
      { type: 'NODE_UPDATE', scene },
      { type: 'CLIP_ENDED', clipUrl: scene.clipUrl! },
      { type: 'CHILD_SCENE', scene: child0 },
      { type: 'CHOOSE', index: 0 },
    );
    expect(notReady.phase).toBe('waitingNext');
  });

  it('still refuses a closed path even when cached', () => {
    const closed = { ...cached(), disabledChoices: [0] };
    const state = storyReducer(closed, { type: 'CHOOSE', index: 0 });
    expect(state.phase).toBe('choosing');
    expect(state.notice?.text).toBe(messages.pathClosed);
    expect(state.syncs).toEqual([]);
  });

  it('clears synced choices and gently notes failed ones', () => {
    const state = run(cached(), { type: 'CHOOSE', index: 0 });
    const done = storyReducer(state, { type: 'SYNC_DONE', id: 1 });
    expect(done.syncs).toEqual([]);
    expect(done.notice).toBeNull();
    expect(storyReducer(done, { type: 'SYNC_DONE', id: 1 })).toBe(done);

    const failed = storyReducer(state, { type: 'SYNC_FAILED', id: 1 });
    expect(failed.syncs).toEqual([]);
    expect(failed.phase).toBe('playing');
    expect(failed.scene?.id).toBe('child-0');
    expect(failed.notice?.text).toBe(messages.choiceNotSaved);
    expect(storyReducer(failed, { type: 'SYNC_FAILED', id: 9 })).toBe(failed);
  });

  it('numbers syncs across scenes and resets', () => {
    const first = run(cached(), { type: 'CHOOSE', index: 0 });
    const grandchild = makeScene({ id: 'child-00', sceneNumber: 3, depth: 2 });
    const scene2 = makeScene({
      id: 'child-0',
      sceneNumber: 2,
      choices: [makeChoice(0, { nodeId: 'child-00' }), makeChoice(1)],
    });
    const second = run(
      { ...first, scene: scene2 },
      { type: 'CLIP_ENDED', clipUrl: scene2.clipUrl! },
      { type: 'CHILD_SCENE', scene: grandchild },
      { type: 'CHOOSE', index: 0 },
    );
    expect(second.syncs.map((sync) => sync.id)).toEqual([1, 2]);
    expect(second.syncs[1]).toEqual({ id: 2, fromNodeId: 'child-0', index: 0, nodeId: 'child-00' });

    const reset = storyReducer(second, { type: 'RESET', nodeId: 'root', posterUrl: null });
    expect(reset.syncs).toEqual([]);
    expect(reset.syncSeq).toBe(2);
    expect(reset.childScenes).toEqual({});
  });
});

describe('something else', () => {
  function inputOpen(text = 'The fox finds a tiny dragon'): StoryState {
    return run(choosing(), { type: 'OPEN_CUSTOM' }, { type: 'CUSTOM_TEXT', text });
  }

  it('opens and cancels the input sheet', () => {
    const open = storyReducer(choosing(), { type: 'OPEN_CUSTOM' });
    expect(open.phase).toBe('customInput');
    expect(storyReducer(open, { type: 'CANCEL_CUSTOM' }).phase).toBe('choosing');
    expect(storyReducer(open, { type: 'BACK' }).phase).toBe('choosing');
  });

  it('validates the text before sending', () => {
    const short = run(inputOpen(' a '), { type: 'SUBMIT_CUSTOM' });
    expect(short.phase).toBe('customInput');
    expect(short.customError).toBe(messages.promptTooShort);
    const long = run(inputOpen('x'.repeat(201)), { type: 'SUBMIT_CUSTOM' });
    expect(long.customError).toBe(messages.promptTooLong);
    expect(storyReducer(long, { type: 'CUSTOM_TEXT', text: 'ok then' }).customError).toBeNull();
  });

  it('waits for the custom scene with the story bends label', () => {
    const sent = run(inputOpen('  The fox finds a tiny dragon  '), { type: 'SUBMIT_CUSTOM' });
    expect(sent.phase).toBe('waitingNext');
    expect(sent.waitKind).toBe('custom');
    expect(sent.customText).toBe('The fox finds a tiny dragon');
    expect(sent.pendingNodeId).toBeNull();
    expect(waitingLabel(sent)).toBe('The story bends');

    const accepted = storyReducer(sent, { type: 'CHOICE_ACCEPTED', seq: sent.requestSeq, nextNodeId: 'custom-1' });
    expect(accepted.pendingNodeId).toBe('custom-1');
    const next = storyReducer(accepted, { type: 'NODE_UPDATE', scene: makeScene({ id: 'custom-1', sceneNumber: 2 }) });
    expect(next.phase).toBe('playing');
    expect(next.customText).toBe('');
  });

  it('keeps the text and shows a kind message for unsafe ideas', () => {
    const sent = run(inputOpen('something odd'), { type: 'SUBMIT_CUSTOM' });
    const rejected = storyReducer(sent, { type: 'CHOICE_FAILED', seq: sent.requestSeq, code: 'unsafe_input' });
    expect(rejected.phase).toBe('customInput');
    expect(rejected.customText).toBe('something odd');
    expect(rejected.customError).toBe("Let's try a different idea.");
  });

  it('sends the family back to the choices when new paths are resting', () => {
    const sent = run(inputOpen(), { type: 'SUBMIT_CUSTOM' });
    const rejected = storyReducer(sent, { type: 'CHOICE_FAILED', seq: sent.requestSeq, code: 'budget_exhausted' });
    expect(rejected.phase).toBe('choosing');
    expect(rejected.notice?.text).toBe('New paths are resting until tomorrow. Pick one of the choices.');
  });

  it('returns to the choices when the custom scene fails', () => {
    const sent = run(inputOpen(), { type: 'SUBMIT_CUSTOM' });
    const accepted = storyReducer(sent, { type: 'CHOICE_ACCEPTED', seq: sent.requestSeq, nextNodeId: 'custom-1' });
    const failed = storyReducer(accepted, {
      type: 'NODE_UPDATE',
      scene: makeScene({ id: 'custom-1', status: 'failed', clipUrl: null }),
    });
    expect(failed.phase).toBe('choosing');
    expect(failed.disabledChoices).toEqual([]);
    expect(failed.notice?.text).toBe(messages.customFailed);
  });
});

describe('menu and notices', () => {
  it('opens the menu with back and closes it again', () => {
    const open = storyReducer(playing(), { type: 'BACK' });
    expect(open.menuOpen).toBe(true);
    expect(isPlayerPaused(open)).toBe(true);
    const closed = storyReducer(open, { type: 'BACK' });
    expect(closed.menuOpen).toBe(false);
    expect(isPlayerPaused(closed)).toBe(false);
  });

  it('resumes from the menu with play pause', () => {
    const state = run(playing(), { type: 'OPEN_MENU' }, { type: 'TOGGLE_PAUSE' });
    expect(state.menuOpen).toBe(false);
    expect(state.userPaused).toBe(false);
  });

  it('keeps the menu open when the next scene arrives', () => {
    const chosen = run(choosing(), { type: 'CHOOSE', index: 0 }, { type: 'BACK' });
    const accepted = run(
      chosen,
      { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-0' },
      { type: 'NODE_UPDATE', scene: child0 },
    );
    expect(accepted.phase).toBe('playing');
    expect(accepted.menuOpen).toBe(true);
    expect(isPlayerPaused(accepted)).toBe(true);
  });

  it('starts over from a new root while keeping a still on screen', () => {
    const chosen = storyReducer(choosing(), { type: 'CHOOSE', index: 0 });
    const reset = storyReducer(chosen, { type: 'RESET', nodeId: 'root', posterUrl: null });
    expect(reset.phase).toBe('loadingScene');
    expect(reset.scene).toBeNull();
    expect(reset.pendingNodeId).toBe('root');
    expect(reset.still).toBe(root.lastFrameUrl);
    expect(reset.pollSeq).toBe(chosen.pollSeq + 1);
    expect(storyReducer(reset, { type: 'CHOICE_ACCEPTED', seq: chosen.requestSeq, nextNodeId: 'child-0' })).toBe(reset);
    const started = storyReducer(reset, { type: 'NODE_UPDATE', scene: root });
    expect(started.phase).toBe('playing');
  });

  it('shows ad hoc notices', () => {
    const state = storyReducer(playing(), { type: 'NOTICE', text: 'Hello' });
    expect(state.notice?.text).toBe('Hello');
  });

  it('dismisses only the current notice', () => {
    const state = run(choosing(), { type: 'CHOOSE', index: 0 });
    const failed = storyReducer(state, { type: 'CHOICE_FAILED', seq: state.requestSeq, code: 'network' });
    const id = failed.notice!.id;
    expect(storyReducer(failed, { type: 'DISMISS_NOTICE', id: id + 1 })).toBe(failed);
    expect(storyReducer(failed, { type: 'DISMISS_NOTICE', id }).notice).toBeNull();
  });
});
