import { describe, expect, it } from 'vitest';
import {
  AUDIENCES,
  MOODS,
  audienceFact,
  audienceLabel,
  checkPromptText,
  formatCount,
  formatEndingsDiscovered,
  formatFamiliesPlayed,
  formatFolio,
  formatMadeIn,
  formatPlays,
  formatRarestChoice,
  formatSceneProgress,
  moodLabel,
} from './format';
import { messageForError, messages } from './messages';

describe('format helpers', () => {
  it('groups thousands', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1204)).toBe('1,204');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('describes plays', () => {
    expect(formatPlays(0)).toBe('New tonight');
    expect(formatPlays(1)).toBe('1 played');
    expect(formatPlays(1204)).toBe('1,204 played');
  });

  it('formats generation time', () => {
    expect(formatMadeIn(5800)).toBe('Made in 5.8 s');
    expect(formatMadeIn(430)).toBe('Made in 0.4 s');
    expect(formatMadeIn(64200)).toBe('Made in 64 s');
    expect(formatMadeIn(null)).toBeNull();
    expect(formatMadeIn(0)).toBeNull();
  });

  it('formats scene progress', () => {
    expect(formatSceneProgress(3, 6)).toBe('Scene 3 of 6');
    expect(formatFolio(3, 6)).toBe('3 / 6');
    expect(formatFolio(2, 0)).toBe('2');
    expect(formatSceneProgress(2, 0)).toBe('Scene 2');
  });

  it('describes the rarest choice', () => {
    expect(formatRarestChoice(null)).toBeNull();
    expect(formatRarestChoice({ sceneNumber: 2, label: 'Open the moon door', percent: 8.4, custom: false })).toBe(
      'Only 8% of families chose \u201COpen the moon door\u201D',
    );
    expect(formatRarestChoice({ sceneNumber: 2, label: 'Hide', percent: 0.3, custom: false })).toBe(
      'Fewer than 1% of families chose \u201CHide\u201D',
    );
    expect(formatRarestChoice({ sceneNumber: 2, label: 'Run!', percent: 72, custom: false })).toBe(
      '72% of families also chose \u201CRun\u201D',
    );
    expect(formatRarestChoice({ sceneNumber: 3, label: 'A dragon tea party', percent: 0, custom: true })).toBe(
      'Only your family went with \u201CA dragon tea party\u201D',
    );
  });

  it('describes endings and families', () => {
    expect(formatEndingsDiscovered(0)).toBeNull();
    expect(formatEndingsDiscovered(1)).toBe('1 ending discovered so far');
    expect(formatEndingsDiscovered(4)).toBe('4 endings discovered so far');
    expect(formatFamiliesPlayed(1)).toBe('1 family played this story');
    expect(formatFamiliesPlayed(1204)).toBe('1,204 families played this story');
  });

  it('labels moods and audiences', () => {
    expect(moodLabel('spooky')).toBe('A little spooky');
    expect(audienceLabel('grownups')).toBe('Grown ups');
    expect(audienceFact('grownups')).toBe('For grown ups');
  });

  it('checks prompt length after trimming', () => {
    expect(checkPromptText('  hi ', 3, 240)).toEqual({ ok: false, text: 'hi', message: messages.promptTooShort });
    expect(checkPromptText('a cozy dragon', 3, 240)).toEqual({ ok: true, text: 'a cozy dragon', message: null });
    expect(checkPromptText('x'.repeat(241), 3, 240).message).toBe(messages.promptTooLong);
  });
});

describe('user facing copy', () => {
  const dash = /[-‐‑‒–—―−]/;
  const codes = [
    'bad_request',
    'not_found',
    'rate_limited',
    'budget_exhausted',
    'unsafe_input',
    'generation_failed',
    'not_ready',
    'payment_required',
    'purchase_invalid',
    'internal',
    'network',
    'timeout',
    'aborted',
    'invalid_response',
    'node_failed',
  ] as const;
  const contexts = ['preset', 'custom', 'start', 'today', 'general'] as const;

  it('never uses dashes or hyphens', () => {
    const texts = [
      ...Object.values(messages),
      ...MOODS.map(moodLabel),
      ...AUDIENCES.map(audienceLabel),
      ...codes.flatMap((code) => contexts.map((context) => messageForError(code, context))),
      formatPlays(3),
      formatMadeIn(1234)!,
      formatSceneProgress(1, 6),
    ];
    for (const text of texts) expect(text).not.toMatch(dash);
  });
});
