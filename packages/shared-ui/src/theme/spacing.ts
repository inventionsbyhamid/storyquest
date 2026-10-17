import { scaledPixels } from '../hooks/useScale';

export const space = {
  xs: scaledPixels(8),
  sm: scaledPixels(16),
  md: scaledPixels(24),
  lg: scaledPixels(32),
  xl: scaledPixels(48),
  xxl: scaledPixels(72),
};

export const radii = {
  card: scaledPixels(14),
  image: scaledPixels(10),
  plate: scaledPixels(18),
  round: 999,
};

export const screen = {
  side: scaledPixels(96),
  top: scaledPixels(64),
};
