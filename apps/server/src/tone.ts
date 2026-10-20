/**
 * Picks the "night" of a picture: a deep, dark version of its main colorful hue,
 * used behind text on the TV. Worked out in OKLab so every night has the same
 * lightness and paper colored text always reads on it.
 */

export const DEFAULT_NIGHT = '#1C2240';

const NIGHT_LIGHTNESS = 0.26;
const MIN_CHROMA = 0.03;
const MAX_CHROMA = 0.075;
// Below this the picture is close to grey, so it keeps the app's own night blue.
const NEUTRAL_COLORFULNESS = 0.01;
const BINS = 36;

type Lab = [number, number, number];

function toLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function hex(channels: number[]): string {
  return `#${channels
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** A dark color of the given hue and chroma, with chroma reduced until it fits in sRGB. */
export function nightColor(hueDegrees: number, chroma: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  let c = chroma;
  for (let i = 0; i < 40; i++) {
    const rgb = oklabToLinear([NIGHT_LIGHTNESS, c * Math.cos(hue), c * Math.sin(hue)]);
    if (rgb.every((v) => v >= 0 && v <= 1)) return hex(rgb);
    c *= 0.9;
  }
  return hex(oklabToLinear([NIGHT_LIGHTNESS, 0, 0]));
}

/**
 * Takes packed RGB pixels (3 bytes each). The winning hue is the one with the
 * most color in the picture: lots of area and strong color both count, so a
 * big blue sky beats a small orange lantern and a grey wall counts for little.
 */
export function nightFromPixels(pixels: Uint8Array): string {
  const count = Math.floor(pixels.length / 3);
  if (count === 0) return DEFAULT_NIGHT;
  const weight = new Float64Array(BINS);
  const sumA = new Float64Array(BINS);
  const sumB = new Float64Array(BINS);

  for (let i = 0; i < count; i++) {
    const [L, a, b] = rgbToOklab(pixels[i * 3]!, pixels[i * 3 + 1]!, pixels[i * 3 + 2]!);
    const chroma = Math.hypot(a, b);
    if (chroma < 0.01) continue;
    // Near black and near white pixels carry little real color.
    const trust = L < 0.1 || L > 0.96 ? 0.25 : 1;
    let hue = Math.atan2(b, a) / (2 * Math.PI);
    if (hue < 0) hue += 1;
    const bin = Math.min(BINS - 1, Math.floor(hue * BINS));
    weight[bin] += chroma * trust;
    sumA[bin] += a * trust;
    sumB[bin] += b * trust;
  }

  let peak = 0;
  let best = -1;
  for (let i = 0; i < BINS; i++) {
    const around = weight[(i + BINS - 1) % BINS]! + weight[i]! + weight[(i + 1) % BINS]!;
    if (around > best) {
      best = around;
      peak = i;
    }
  }

  const colorfulness = best / count;
  if (colorfulness < NEUTRAL_COLORFULNESS) return DEFAULT_NIGHT;
  let a = 0;
  let b = 0;
  for (const i of [(peak + BINS - 1) % BINS, peak, (peak + 1) % BINS]) {
    a += sumA[i]!;
    b += sumB[i]!;
  }
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  const chroma = Math.min(MAX_CHROMA, Math.max(MIN_CHROMA, colorfulness * 0.7));
  return nightColor(hue < 0 ? hue + 360 : hue, chroma);
}

/** Mixes two #RRGGBB colors; amount 0 keeps the first, 1 gives the second. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) => {
    const value = Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
    return value.toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`.toUpperCase();
}
