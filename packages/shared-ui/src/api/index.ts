import { getApiBaseUrl } from '../config';
import { createApiClient } from './client';
import { getDeviceId } from './deviceId';

export const api = createApiClient({ getBaseUrl: getApiBaseUrl, getDeviceId });

export { createApiClient } from './client';
export type { ApiClient } from './client';
export { ApiError, isApiError, isAbortError, isTransient, toApiError } from './errors';
export type { ApiErrorCode } from './errors';
export { resolveMediaUrl } from './media';
export { getDeviceId } from './deviceId';
export { waitForNode, isNodeSettled, areChoicesSettled } from './waitForNode';
