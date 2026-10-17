export const HOLD_MS = 3000;
// A press that started before the gate opened (or key repeat from it) must end before a hold counts.
export const ARM_MS = 400;

export interface HoldState {
  armedAt: number;
  startedAt: number | null;
  passed: boolean;
}

export type HoldEvent = { type: 'down'; at: number } | { type: 'up'; at: number } | { type: 'cancel' };

export function createHoldState(openedAt: number): HoldState {
  return { armedAt: openedAt + ARM_MS, startedAt: null, passed: false };
}

export function holdProgress(state: HoldState, now: number): number {
  if (state.passed) return 1;
  if (state.startedAt === null) return 0;
  return Math.min(1, Math.max(0, (now - state.startedAt) / HOLD_MS));
}

// The gate passes when Select is let go after being held for the full time, so the release
// never lands on whatever opens next.
export function holdReducer(state: HoldState, event: HoldEvent): HoldState {
  if (state.passed) return state;
  switch (event.type) {
    case 'down':
      if (state.startedAt !== null) return state;
      if (event.at < state.armedAt) return { ...state, armedAt: Math.max(state.armedAt, event.at + ARM_MS) };
      return { ...state, startedAt: event.at };
    case 'up':
      if (state.startedAt === null) return { ...state, armedAt: Math.min(state.armedAt, event.at) };
      if (event.at - state.startedAt >= HOLD_MS) return { ...state, startedAt: null, passed: true };
      return { ...state, startedAt: null };
    case 'cancel':
      return state.startedAt === null ? state : { ...state, startedAt: null };
    default:
      return state;
  }
}
