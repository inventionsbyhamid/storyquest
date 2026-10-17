import { scaledPixels } from '../hooks/useScale';

export const typography = {
  fontSize: {
    meta: 24,
    body: 28,
    bodyLarge: 32,
    heading: 40,
    title: 56,
    hero: 64,
    display: 72,
  },
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    heavy: '800' as const,
  },
};

export const type = {
  display: { fontSize: scaledPixels(72), lineHeight: scaledPixels(80), fontWeight: '800' as const },
  hero: { fontSize: scaledPixels(64), lineHeight: scaledPixels(72), fontWeight: '800' as const },
  title: { fontSize: scaledPixels(56), lineHeight: scaledPixels(64), fontWeight: '700' as const },
  heading: { fontSize: scaledPixels(40), lineHeight: scaledPixels(48), fontWeight: '700' as const },
  bodyLarge: { fontSize: scaledPixels(32), lineHeight: scaledPixels(42), fontWeight: '500' as const },
  body: { fontSize: scaledPixels(28), lineHeight: scaledPixels(38), fontWeight: '500' as const },
  label: { fontSize: scaledPixels(28), lineHeight: scaledPixels(34), fontWeight: '700' as const },
  meta: { fontSize: scaledPixels(24), lineHeight: scaledPixels(30), fontWeight: '600' as const },
};
