import { describe, expect, it } from 'vitest';
import { makeChoice, makeScene } from '../test/fixtures';
import { autoPickCandidates, formatAutoPick, pickAtRandom } from './autoPick';
import { createStoryState, storyReducer, type StoryEvent, type StoryState } from './storyMachine';

const run = (state: StoryState, ...events: StoryEvent[]) => events.reduce(storyReducer, state);

function choosingWith(choices = [makeChoice(0), makeChoice(1)], hiddenNodes: string[] = []): StoryState {
  const scene = makeScene({ id: 'root', choices });
  return run(
    createStoryState({ nodeId: 'root', posterUrl: '/idea.jpg', hiddenNodes }),
    { type: 'NODE_UPDATE', scene },
    { type: 'CLIP_PLAYING', clipUrl: scene.clipUrl! },
    { type: 'CLIP_ENDED', clipUrl: scene.clipUrl! },
  );
}

describe('auto pick', () => {
  it('offers filmed free choices once the scene has ended', () => {
    expect(autoPickCandidates(choosingWith())).toEqual([0, 1]);
  });

  it('never picks a choice that costs Sparks or is still being drawn', () => {
    const state = choosingWith([makeChoice(0, { sparks: 1 }), makeChoice(1, { ready: false })]);
    expect(autoPickCandidates(state)).toEqual([]);
  });

  it('skips paths that are closed', () => {
    const state = choosingWith([makeChoice(0), makeChoice(1, { nodeId: 'gone' })], ['gone']);
    expect(autoPickCandidates(state)).toEqual([0]);
  });

  it('waits for the scene to end', () => {
    const scene = makeScene({ id: 'root' });
    const playing = run(createStoryState({ nodeId: 'root', posterUrl: '/idea.jpg' }), { type: 'NODE_UPDATE', scene });
    expect(autoPickCandidates(playing)).toEqual([]);
  });

  it('picks one of the candidates', () => {
    expect(pickAtRandom([0, 1], () => 0)).toBe(0);
    expect(pickAtRandom([0, 1], () => 0.99)).toBe(1);
    expect(pickAtRandom([], () => 0.5)).toBeNull();
  });

  it('counts down in plain words', () => {
    expect(formatAutoPick(7)).toBe('Picking one for you in 7');
  });
});
