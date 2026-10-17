import type { ChoiceView, SceneView } from '@storyquest/contracts';

export function makeChoice(index: number, overrides: Partial<ChoiceView> = {}): ChoiceView {
  return {
    index,
    label: index === 0 ? 'Open the moon door' : 'Follow the fox',
    nodeId: `child-${index}`,
    ready: true,
    posterUrl: `/media/child-${index}/poster.jpg`,
    ...overrides,
  };
}

export function makeScene(overrides: Partial<SceneView> = {}): SceneView {
  const id = overrides.id ?? 'node-1';
  return {
    id,
    treeId: 'tree-1',
    depth: 0,
    sceneNumber: 1,
    totalScenes: 6,
    status: 'ready',
    caption: 'A lantern flickers on the hill.',
    clipUrl: `/media/${id}/clip.mp4`,
    posterUrl: `/media/${id}/poster.jpg`,
    lastFrameUrl: `/media/${id}/last.jpg`,
    durationMs: 8000,
    isEnding: false,
    choices: [makeChoice(0), makeChoice(1)],
    generationMs: 5800,
    error: null,
    ...overrides,
  };
}
