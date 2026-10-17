import { useSyncExternalStore } from 'react';
import { api } from '../api';
import { setIapUserId } from '../api/identity';
import { createIapService } from './iap';
import { SparksStore } from './sparksStore';
import type { SparksSnapshot } from './sparksStore';

export const sparks = new SparksStore({ api, iap: createIapService(), setIdentity: setIapUserId });

export function useSparks(): SparksSnapshot {
  return useSyncExternalStore(sparks.subscribe, sparks.getSnapshot, sparks.getSnapshot);
}

export type { SparksSnapshot, BuyOutcome } from './sparksStore';
export * from './format';
