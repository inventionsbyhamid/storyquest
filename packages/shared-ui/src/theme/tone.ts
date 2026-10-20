import { colors } from './colors';

/**
 * The night a picture brings with it: the server picks a deep color from each
 * poster and last frame, and the screens around that picture take it on.
 */
export interface Tone {
  night: string;
  raised: string;
  line: string;
  scrim: string;
}

export const DEFAULT_TONE: Tone = {
  night: colors.ink,
  raised: colors.inkRaised,
  line: colors.inkLine,
  scrim: colors.scrim,
};

const HEX = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes two #RRGGBB colors; amount 0 keeps the first, 1 gives the second. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((value, i) =>
      Math.round(value * (1 - amount) + b[i]! * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function toneFor(night: string | null | undefined): Tone {
  if (!night || !HEX.test(night) || night.toLowerCase() === colors.ink.toLowerCase()) return DEFAULT_TONE;
  const [r, g, b] = channels(night);
  return {
    night,
    raised: mixHex(night, colors.paper, 0.08),
    line: mixHex(night, colors.paper, 0.18),
    scrim: `rgba(${r}, ${g}, ${b}, 0.9)`,
  };
}
