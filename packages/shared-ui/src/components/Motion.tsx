import { createContext, useContext } from 'react';

// Screens hidden under the stack stay mounted; looping animations check this to stop drawing.
export const MotionContext = createContext(true);

export function useMotion(): boolean {
  return useContext(MotionContext);
}
