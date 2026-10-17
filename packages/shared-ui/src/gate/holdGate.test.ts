import { afterEach, describe, expect, it } from 'vitest';
import { ARM_MS, HOLD_MS, createHoldState, holdProgress, holdReducer } from './holdGate';
import type { HoldEvent, HoldState } from './holdGate';
import { confirmGrownUps, needsGrownUpsGate, resetGrownUpsGate } from './grownUps';

const run = (state: HoldState, ...events: HoldEvent[]) => events.reduce(holdReducer, state);
const armed = () => createHoldState(0);
const T = ARM_MS + 100;

describe('hold to continue', () => {
  it('passes when Select is held for the full time and then let go', () => {
    const held = run(armed(), { type: 'down', at: T });
    expect(holdProgress(held, T + HOLD_MS / 2)).toBeCloseTo(0.5);
    expect(holdProgress(held, T + HOLD_MS + 500)).toBe(1);
    expect(held.passed).toBe(false);
    const released = holdReducer(held, { type: 'up', at: T + HOLD_MS + 200 });
    expect(released.passed).toBe(true);
    expect(holdProgress(released, 0)).toBe(1);
  });

  it('starts over when let go early', () => {
    const state = run(armed(), { type: 'down', at: T }, { type: 'up', at: T + HOLD_MS - 1 });
    expect(state.passed).toBe(false);
    expect(state.startedAt).toBeNull();
    expect(holdProgress(state, T + HOLD_MS * 2)).toBe(0);
  });

  it('ignores key repeat while held', () => {
    const state = run(armed(), { type: 'down', at: T }, { type: 'down', at: T + 500 }, { type: 'down', at: T + 900 });
    expect(state.startedAt).toBe(T);
  });

  it('does not count a press that began before the gate opened', () => {
    // Select held down on the card that opened the gate keeps repeating.
    let state = createHoldState(1000);
    for (let at = 1000; at <= 1000 + HOLD_MS + 600; at += 100) state = holdReducer(state, { type: 'down', at });
    expect(state.startedAt).toBeNull();
    state = holdReducer(state, { type: 'up', at: 5000 });
    expect(state.passed).toBe(false);
    state = run(state, { type: 'down', at: 5200 }, { type: 'up', at: 5200 + HOLD_MS });
    expect(state.passed).toBe(true);
  });

  it('arms on its own when no key is down', () => {
    const state = holdReducer(createHoldState(0), { type: 'down', at: ARM_MS });
    expect(state.startedAt).toBe(ARM_MS);
  });

  it('drops a hold in progress on cancel and stays passed once passed', () => {
    const held = run(armed(), { type: 'down', at: T });
    expect(holdReducer(held, { type: 'cancel' }).startedAt).toBeNull();
    const passed = run(held, { type: 'up', at: T + HOLD_MS });
    expect(run(passed, { type: 'down', at: T + HOLD_MS + 10 }, { type: 'cancel' })).toBe(passed);
  });
});

describe('grown ups gate', () => {
  afterEach(resetGrownUpsGate);

  it('asks once per session and never for grown up stories', () => {
    expect(needsGrownUpsGate('family')).toBe(true);
    expect(needsGrownUpsGate('kids')).toBe(true);
    expect(needsGrownUpsGate(undefined)).toBe(true);
    expect(needsGrownUpsGate('grownups')).toBe(false);
    confirmGrownUps();
    expect(needsGrownUpsGate('kids')).toBe(false);
  });
});
