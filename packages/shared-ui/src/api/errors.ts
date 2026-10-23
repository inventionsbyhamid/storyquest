import type { ErrorCode } from '@storyquest/contracts';

// path_closed: the server refused a choice whose scene is hidden (HTTP 409).
export type ClientErrorCode = 'network' | 'timeout' | 'aborted' | 'invalid_response' | 'path_closed';
export type ApiErrorCode = ErrorCode | ClientErrorCode;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;
  // How long the server asked us to wait before trying again (Retry-After on a 429).
  readonly retryAfterMs: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isApiError(error: unknown): error is ApiError {
  if (error instanceof ApiError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ApiError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

export function isAbortError(error: unknown): boolean {
  return isApiError(error) && error.code === 'aborted';
}

export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError('network', message);
}

const TRANSIENT: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  'network',
  'timeout',
  'internal',
  'rate_limited',
  'not_ready',
]);

export function isTransient(error: unknown): boolean {
  return isApiError(error) && TRANSIENT.has(error.code);
}

export function parseRetryAfter(value: string | null | undefined): number | null {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

export function codeForStatus(status: number): ErrorCode {
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'internal';
}
