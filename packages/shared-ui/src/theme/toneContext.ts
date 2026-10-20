import { createContext, useContext } from 'react';
import { DEFAULT_TONE, Tone } from './tone';

export const ToneContext = createContext<Tone>(DEFAULT_TONE);

export function useTone(): Tone {
  return useContext(ToneContext);
}
