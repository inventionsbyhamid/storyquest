import { describe, expect, it } from 'vitest';
import { DEFAULT_TONE, mixHex, toneFor } from './tone';

describe('toneFor', () => {
  it('keeps the app night when a picture has no color yet', () => {
    expect(toneFor(null)).toBe(DEFAULT_TONE);
    expect(toneFor(undefined)).toBe(DEFAULT_TONE);
    expect(toneFor('not a color')).toBe(DEFAULT_TONE);
    expect(toneFor('#1c2240')).toBe(DEFAULT_TONE);
  });

  it('builds raised panels, lines and a scrim from the night', () => {
    const tone = toneFor('#06292E');
    expect(tone.night).toBe('#06292E');
    expect(tone.raised).toBe(mixHex('#06292E', '#F1E6CF', 0.08));
    expect(tone.line).toBe(mixHex('#06292E', '#F1E6CF', 0.18));
    expect(tone.scrim).toBe('rgba(6, 41, 46, 0.9)');
  });
});

describe('mixHex', () => {
  it('mixes channel by channel', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
