import { TextStyle } from 'react-native';
import { scaledPixels } from '../hooks/useScale';

// Fraunces is bundled as one semibold display cut; the file name is the family name on Vega.
export const DISPLAY_FONT = 'Fraunces';

function fraunces(size: number): TextStyle {
  return {
    fontFamily: DISPLAY_FONT,
    fontSize: scaledPixels(size),
    lineHeight: scaledPixels(Math.round(size * 1.25)),
    letterSpacing: -0.5,
  };
}

function sans(size: number, weight: TextStyle['fontWeight'] = '400'): TextStyle {
  return { fontSize: scaledPixels(size), lineHeight: scaledPixels(Math.round(size * 1.4)), fontWeight: weight };
}

export const type = {
  display: fraunces(76),
  title: fraunces(52),
  heading: sans(36, '600'),
  body: sans(28),
  bodyStrong: sans(28, '600'),
  label: sans(24, '600'),
  small: sans(22),
};
