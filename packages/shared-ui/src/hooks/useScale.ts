import { Dimensions, PixelRatio } from 'react-native';

// Layouts are designed at 1920x1080 and scaled by the screen diagonal, like the sample did.
const DESIGN_DIAGONAL = Math.hypot(1920, 1080);
const viewport = Dimensions.get('window');
const ratio = Math.hypot(viewport.width, viewport.height) / DESIGN_DIAGONAL;

export function scaledPixels(size: number): number {
  return PixelRatio.roundToNearestPixel(size * ratio);
}
