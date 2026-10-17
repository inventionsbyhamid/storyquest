import type { Audience } from '@storyquest/contracts';

let confirmed = false;

// Typing a new idea is for grown ups. Asked once per app session, never for grown up stories.
export function needsGrownUpsGate(audience?: Audience | null): boolean {
  return !confirmed && audience !== 'grownups';
}

export function confirmGrownUps(): void {
  confirmed = true;
}

export function resetGrownUpsGate(): void {
  confirmed = false;
}
