import { afterEach, describe, expect, it } from 'vitest';
import { confirmGrownUps, loadGrownUps, needsGrownUpsGate, resetGrownUpsGate } from './grownUps';
import { createGateState, gateReducer, makeQuestion, questionText } from './question';
import type { GateAction, GateQuestion, GateState } from './question';

const q = (a: number, b: number): GateQuestion => ({ a, b, answer: a * b });
const digit = (d: number, next = q(3, 4)): GateAction => ({ type: 'digit', digit: d, next });
const run = (state: GateState, ...actions: GateAction[]) => actions.reduce(gateReducer, state);

describe('grown ups question', () => {
  it('asks a two digit times table question with no repeated digits', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const question = makeQuestion();
      seen.add(question.answer);
      expect(question.answer).toBe(question.a * question.b);
      expect(question.answer).toBeGreaterThanOrEqual(12);
      expect(question.answer).toBeLessThanOrEqual(81);
      const [tens, ones] = String(question.answer);
      expect(tens).not.toBe(ones);
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(questionText(q(7, 4))).toBe('What is 7 times 4?');
  });

  it('passes on the right answer', () => {
    const state = run(createGateState(q(7, 4)), digit(2), digit(8));
    expect(state.passed).toBe(true);
    expect(state.entry).toBe('28');
  });

  it('asks a new question after a wrong answer', () => {
    const next = q(6, 9);
    const state = run(createGateState(q(7, 4)), digit(2), digit(9, next));
    expect(state.passed).toBe(false);
    expect(state.missed).toBe(true);
    expect(state.entry).toBe('');
    expect(state.question).toBe(next);
  });

  it('never passes when one key is pressed over and over', () => {
    for (let d = 0; d <= 9; d++) {
      let state = createGateState(makeQuestion());
      for (let i = 0; i < 40; i++) state = gateReducer(state, digit(d, makeQuestion()));
      expect(state.passed).toBe(false);
    }
  });

  it('erases the last digit and clears the miss note on the next digit', () => {
    const missed = run(createGateState(q(7, 4)), digit(1), digit(1, q(5, 5)));
    expect(missed.missed).toBe(true);
    const typing = run(missed, digit(2), { type: 'erase' }, digit(2));
    expect(typing.entry).toBe('2');
    expect(typing.missed).toBe(false);
    expect(run(typing, digit(5)).passed).toBe(true);
  });
});

describe('when to ask', () => {
  afterEach(resetGrownUpsGate);

  it('remembers the answer on this TV', async () => {
    const saved = new Map<string, string>();
    const store = {
      getItem: async (key: string) => saved.get(key) ?? null,
      setItem: async (key: string, value: string) => void saved.set(key, value),
    };
    await loadGrownUps(store);
    expect(needsGrownUpsGate('kids')).toBe(true);
    confirmGrownUps();
    await Promise.resolve();
    resetGrownUpsGate();
    expect(needsGrownUpsGate('kids')).toBe(true);
    await loadGrownUps(store);
    expect(needsGrownUpsGate('kids')).toBe(false);
  });

  it('asks once and never for grown up stories', () => {
    expect(needsGrownUpsGate('family')).toBe(true);
    expect(needsGrownUpsGate('kids')).toBe(true);
    expect(needsGrownUpsGate(undefined)).toBe(true);
    expect(needsGrownUpsGate('grownups')).toBe(false);
    confirmGrownUps();
    expect(needsGrownUpsGate('kids')).toBe(false);
  });
});
