import { useSyncExternalStore } from 'react';
import { isFilmingPaused, subscribeFilming } from './filming';

export function useFilmingPaused(): boolean {
  return useSyncExternalStore(subscribeFilming, isFilmingPaused, isFilmingPaused);
}
