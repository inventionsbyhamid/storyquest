import type { StoryState } from './storyMachine';
import { closedChoices, notFilmedChoices } from './storyMachine';

/** How long the choice dock waits before picking for a family that has not pressed anything. */
export const AUTO_PICK_SECONDS = 10;

/**
 * Choices the app may take on its own: filmed all the way through their chapter, open and free,
 * so a story that carries on by itself never spends Sparks, starts new filming or makes the family wait.
 */
export function autoPickCandidates(state: StoryState): number[] {
  const scene = state.scene;
  if (state.phase !== 'choosing' || !scene || scene.isEnding || scene.continues) return [];
  const unavailable = [...closedChoices(state), ...notFilmedChoices(state)];
  return scene.choices
    .filter(
      (choice) => choice.ready && choice.filmed !== false && choice.sparks === 0 && !unavailable.includes(choice.index),
    )
    .map((choice) => choice.index);
}

export function pickAtRandom(candidates: number[], random: () => number = Math.random): number | null {
  if (candidates.length === 0) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]!;
}

export function formatAutoPick(seconds: number): string {
  return `Picking one for you in ${seconds}`;
}
