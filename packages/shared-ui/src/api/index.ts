import { markBudgetExhausted } from '../budget/filming';
import { getApiBaseUrl } from '../config';
import { createApiClient } from './client';
import { getDeviceId } from './deviceId';
import { getIapUserId } from './identity';

export const api = createApiClient({
  getBaseUrl: getApiBaseUrl,
  getDeviceId,
  getIapUserId,
  onError: (error) => {
    if (error.code === 'budget_exhausted') markBudgetExhausted();
  },
});

export { createApiClient } from './client';
export type { ApiClient } from './client';
export { ApiError, isApiError, isAbortError, isTransient, toApiError } from './errors';
export type { ApiErrorCode } from './errors';
export { resolveMediaUrl } from './media';
export { getDeviceId } from './deviceId';
export { getIapUserId, setIapUserId } from './identity';
export { waitForNode, isNodeSettled, areChoicesSettled } from './waitForNode';
