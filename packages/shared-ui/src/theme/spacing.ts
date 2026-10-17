import { scaledPixels } from '../hooks/useScale';

export const spacing = {
  xs: 8,
  sm: 12,
  md: 20,
  lg: 32,
  xl: 48,
  xxl: 64,
  xxxl: 96,
};

export const radii = {
  sm: scaledPixels(12),
  md: scaledPixels(20),
  lg: scaledPixels(28),
  pill: 999,
};
