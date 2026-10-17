import { ApiError } from './errors';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('aborted', 'Cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError('aborted', 'Cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}
