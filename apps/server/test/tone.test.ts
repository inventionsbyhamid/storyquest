import { describe, expect, it } from 'vitest';
import { DEFAULT_NIGHT, nightColor, nightFromPixels, rgbToOklab } from '../src/tone';

function fill(parts: Array<{ rgb: [number, number, number]; count: number }>): Uint8Array {
  const pixels: number[] = [];
  for (const { rgb, count } of parts) {
    for (let i = 0; i < count; i++) pixels.push(...rgb);
  }
  return Uint8Array.from(pixels);
}

function hueOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [, a, b] = rgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return hue < 0 ? hue + 360 : hue;
}

function lightnessOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255)[0];
}

describe('nightFromPixels', () => {
  it('keeps the hue of a picture with one strong color', () => {
    const orange = nightFromPixels(fill([{ rgb: [230, 120, 30], count: 100 }]));
    expect(Math.abs(hueOf(orange) - hueOf('#E6781E'))).toBeLessThan(6);
  });

  it('makes every night equally dark', () => {
    for (const rgb of [
      [230, 120, 30],
      [40, 160, 70],
      [60, 90, 220],
      [240, 220, 60],
    ] as Array<[number, number, number]>) {
      expect(lightnessOf(nightFromPixels(fill([{ rgb, count: 50 }])))).toBeCloseTo(0.26, 1);
    }
  });

  it('lets a big sky beat a small bright lantern', () => {
    const night = nightFromPixels(
      fill([
        { rgb: [40, 70, 150], count: 90 },
        { rgb: [255, 170, 40], count: 10 },
      ]),
    );
    const hue = hueOf(night);
    expect(hue).toBeGreaterThan(230);
    expect(hue).toBeLessThan(290);
  });

  it('keeps the app night for grey pictures', () => {
    expect(nightFromPixels(fill([{ rgb: [128, 128, 128], count: 40 }]))).toBe(DEFAULT_NIGHT);
    expect(nightFromPixels(new Uint8Array(0))).toBe(DEFAULT_NIGHT);
  });

  it('wraps around red', () => {
    const night = nightFromPixels(
      fill([
        { rgb: [200, 30, 60], count: 50 },
        { rgb: [210, 40, 30], count: 50 },
      ]),
    );
    const hue = hueOf(night);
    expect(hue < 40 || hue > 340).toBe(true);
  });
});

describe('nightColor', () => {
  it('always returns a color inside sRGB', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      expect(nightColor(hue, 0.2)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
