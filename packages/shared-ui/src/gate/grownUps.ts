import type { Audience } from '@storyquest/contracts';
import { loadStore, type KeyValueStore } from '../api/deviceId';

const STORAGE_KEY = 'storyquest.grownUpsConfirmed';

let confirmed = false;
let store: KeyValueStore | null = null;

// Typing a new idea is for grown ups. Asked once on each TV and remembered, never for grown up stories.
export function needsGrownUpsGate(audience?: Audience | null): boolean {
  return !confirmed && audience !== 'grownups';
}

export function confirmGrownUps(): void {
  confirmed = true;
  store?.setItem(STORAGE_KEY, 'yes').catch(() => {
    // Still confirmed for this session.
  });
}

/** Reads the remembered answer once at startup. */
export async function loadGrownUps(from: KeyValueStore | null = loadStore()): Promise<void> {
  store = from;
  try {
    if ((await from?.getItem(STORAGE_KEY)) === 'yes') confirmed = true;
  } catch {
    // Ask again; nothing is lost.
  }
}

export function resetGrownUpsGate(): void {
  confirmed = false;
  store = null;
}
