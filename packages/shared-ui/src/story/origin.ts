import type { StartStoryRequest } from '@storyquest/contracts';
import type { StoryOrigin } from '../navigation/types';

export function startRequestFor(origin: StoryOrigin): StartStoryRequest | null {
  if (origin.ideaId) return { kind: 'idea', ideaId: origin.ideaId };
  if (origin.prompt) {
    return {
      kind: 'custom',
      prompt: origin.prompt,
      moods: origin.moods ?? [],
      audience: origin.audience ?? 'family',
    };
  }
  return null;
}
