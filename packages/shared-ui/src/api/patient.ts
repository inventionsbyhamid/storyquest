import { ApiError, isTransient, toApiError } from './errors';
import { sleep as defaultSleep } from './sleep';

// Offline tries are cheap, so they come often; a struggling server gets more room.
export function patientDelay(attempt: number, error: ApiError): number {
  const cap = error.code === 'network' ? 5000 : 15000;
  return Math.max(Math.min(1000 * 2 ** (attempt - 1), cap), error.retryAfterMs ?? 0);
}

export interface PatientOptions {
  signal: AbortSignal;
  onFailure?: (error: ApiError, attempt: number) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

// Keeps trying a load that has to work in the end, like Home while a TV that just woke up finds its network.
export async function retryPatiently<T>(task: () => Promise<T>, options: PatientOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (raw) {
      const error = toApiError(raw);
      if (error.code === 'aborted' || options.signal.aborted || !isTransient(error)) throw error;
      options.onFailure?.(error, attempt);
      await sleep(patientDelay(attempt, error), options.signal);
    }
  }
}
