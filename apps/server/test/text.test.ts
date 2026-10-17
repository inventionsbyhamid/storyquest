import { describe, expect, it } from 'vitest';
import { clipText, hasDash, provisionalTitle, sanitizeUserText } from '../src/text';

describe('sanitizeUserText', () => {
  it.each([
    ['Pickle—the brave toaster—leapt.', 'Pickle, the brave toaster, leapt.'],
    ['The moon door opened — Inside was a garden.', 'The moon door opened. Inside was a garden.'],
    ['Mia ran to the gate – Leo waved back', 'Mia ran to the gate. Leo waved back'],
    ['half-dragon', 'half dragon'],
    ['A well-known, 8-year-old hero', 'A well known, 8 year old hero'],
    ['wait -- what?', 'wait, what?'],
    ['Pick one - left or right', 'Pick one, left or right'],
    ['Ages 3-5', 'Ages 3 to 5'],
    ['Ages 3 – 5', 'Ages 3 to 5'],
    ['  lots   of \n space  ', 'lots of space'],
    ['Go now –', 'Go now'],
    ['– Start here', 'Start here'],
    ['- bullet point', 'bullet point'],
    ['Wait—', 'Wait'],
    ['x — , y', 'x, y'],
    ['Mia − Leo', 'Mia, Leo'],
    ['non‑breaking‐hyphen', 'non breaking hyphen'],
    ['Ready?—Go!', 'Ready? Go!'],
    ['It was dark — I held the lantern', 'It was dark, I held the lantern'],
    ['Leo says "Let\'s go!"', 'Leo says "Let\'s go!"'],
    ['', ''],
  ])('%j becomes %j', (input, expected) => {
    expect(sanitizeUserText(input)).toBe(expected);
  });

  it('never leaves a dash behind', () => {
    const nasty = 'A — b – c - d -- e ‒ f ― g—h re-enter x- y -z － end';
    const result = sanitizeUserText(nasty);
    expect(hasDash(result)).toBe(false);
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('keeps numbers with commas intact', () => {
    expect(sanitizeUserText('1,000 stars')).toBe('1,000 stars');
  });
});

describe('clipText', () => {
  it('leaves short text alone', () => {
    expect(clipText('Short and sweet.', 90)).toBe('Short and sweet.');
  });

  it('cuts on a word boundary and adds an ellipsis', () => {
    const clipped = clipText('The very long caption about a brave little toaster who walks across the kitchen', 40);
    expect(clipped.length).toBeLessThanOrEqual(40);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).not.toMatch(/\s…$/);
  });
});

describe('provisionalTitle', () => {
  it('builds a short title from a prompt', () => {
    expect(provisionalTitle('a shy dragon-who loves baking bread at night')).toBe('A Shy Dragon Who Loves');
  });

  it('falls back when nothing usable is left', () => {
    expect(provisionalTitle('!!!')).toBe('A New Story');
  });
});
