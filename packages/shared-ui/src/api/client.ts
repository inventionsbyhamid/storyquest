import {
  API_VERSION,
  ChooseResponse,
  DEVICE_HEADER,
  ErrorResponse,
  FinishResponse,
  IAP_USER_HEADER,
  ReportResponse,
  SceneView,
  ShareView,
  StoryListResponse,
  StoryView,
  TodayResponse,
  VerifyPurchaseResponse,
  WalletView,
} from '@storyquest/contracts';
import type {
  ChooseRequest,
  PrefetchRequest,
  ReportRequest,
  StartStoryRequest,
  VerifyPurchaseRequest,
} from '@storyquest/contracts';
import { ApiError, codeForStatus, isApiError, isTransient, parseRetryAfter, toApiError } from './errors';
import { resolveMediaUrl } from './media';
import { sleep as defaultSleep } from './sleep';

type ParseResult<T> = { success: true; data: T } | { success: false; error: unknown };

export interface Schema<T> {
  safeParse(input: unknown): ParseResult<T>;
}

type Method = 'GET' | 'POST';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
}

export interface ApiClientOptions {
  getBaseUrl: () => string;
  getDeviceId: () => Promise<string>;
  getIapUserId?: () => string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  // Sees every error a call finally fails with, for app wide signals like a spent budget.
  onError?: (error: ApiError) => void;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_GET_RETRIES = 2;
const LONG_POLL_GRACE_MS = 7000;
// A longer Retry-After is left to the caller rather than waited out inside one call.
const MAX_INLINE_RETRY_AFTER_MS = 3000;

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(400 * 2 ** (attempt - 1), 4000);
  return Math.round(base * (0.8 + random() * 0.4));
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetch ?? ((input: RequestInfo, init?: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultRetries = options.retries ?? DEFAULT_GET_RETRIES;

  async function once<T>(
    method: Method,
    path: string,
    schema: Schema<T>,
    body: unknown,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<T> {
    if (signal?.aborted) throw new ApiError('aborted', 'Request was cancelled');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const deviceId = await options.getDeviceId();
      const headers: Record<string, string> = { accept: 'application/json', [DEVICE_HEADER]: deviceId };
      const iapUserId = options.getIapUserId?.();
      if (iapUserId) headers[IAP_USER_HEADER] = iapUserId;
      if (body !== undefined) headers['content-type'] = 'application/json';

      const response = await fetchImpl(`${options.getBaseUrl()}/${API_VERSION}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      let json: unknown;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }

      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
        const parsedError = ErrorResponse.safeParse(json);
        if (parsedError.success) {
          const { code, message } = parsedError.data.error;
          // The server answers 409 not_found for a path whose scene was taken down.
          const closed = response.status === 409 && code === 'not_found';
          throw new ApiError(closed ? 'path_closed' : code, message, response.status, retryAfterMs);
        }
        throw new ApiError(
          codeForStatus(response.status),
          `Request failed with status ${response.status}`,
          response.status,
          retryAfterMs,
        );
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError('invalid_response', `Unexpected response for ${method} ${path}`, response.status);
      }
      return parsed.data;
    } catch (error) {
      if (isApiError(error)) throw error;
      if (signal?.aborted) throw new ApiError('aborted', 'Request was cancelled');
      if (timedOut) throw new ApiError('timeout', 'Request timed out');
      throw toApiError(error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function request<T>(
    method: Method,
    path: string,
    schema: Schema<T>,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    const retries = method === 'GET' ? (opts.retries ?? defaultRetries) : 0;
    const timeoutMs = opts.timeoutMs ?? defaultTimeout;
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(method, path, schema, body, opts.signal, timeoutMs);
      } catch (error) {
        const apiError = toApiError(error);
        const retryAfter = apiError.retryAfterMs ?? 0;
        if (
          apiError.code === 'aborted' ||
          attempt > retries ||
          !isTransient(apiError) ||
          retryAfter > MAX_INLINE_RETRY_AFTER_MS
        ) {
          if (apiError.code !== 'aborted') options.onError?.(apiError);
          throw apiError;
        }
        await sleep(Math.max(backoffDelay(attempt, random), retryAfter), opts.signal);
      }
    }
  }

  const id = (value: string) => encodeURIComponent(value);

  // Media may come back as paths on the API host; the app always works with absolute URLs.
  const media = (url: string | null) => resolveMediaUrl(url, options.getBaseUrl());
  const withSceneMedia = (scene: SceneView): SceneView => ({
    ...scene,
    clipUrl: media(scene.clipUrl),
    posterUrl: media(scene.posterUrl),
    lastFrameUrl: media(scene.lastFrameUrl),
    choices: scene.choices.map((choice) => ({ ...choice, posterUrl: media(choice.posterUrl) })),
  });

  return {
    getToday: (opts?: RequestOptions) =>
      request('GET', '/today', TodayResponse, undefined, opts).then((today) => ({
        ...today,
        ideas: today.ideas.map((idea) => ({
          ...idea,
          posterUrl: media(idea.posterUrl),
          trailerUrl: media(idea.trailerUrl),
        })),
      })),

    startStory: (input: StartStoryRequest, opts?: RequestOptions) =>
      request('POST', '/stories', StoryView, input, opts),

    listStories: (opts?: RequestOptions) =>
      request('GET', '/stories', StoryListResponse, undefined, opts).then((list) =>
        list.stories.map((story) => ({ ...story, posterUrl: media(story.posterUrl) })),
      ),

    getStory: (storyId: string, opts?: RequestOptions) =>
      request('GET', `/stories/${id(storyId)}`, StoryView, undefined, opts),

    getNode: (nodeId: string, opts: RequestOptions & { wait?: number } = {}) => {
      const wait = opts.wait ?? 0;
      const query = wait > 0 ? `?wait=${wait}` : '';
      return request('GET', `/nodes/${id(nodeId)}${query}`, SceneView, undefined, {
        retries: 0,
        ...opts,
        timeoutMs: opts.timeoutMs ?? wait * 1000 + LONG_POLL_GRACE_MS,
      }).then(withSceneMedia);
    },

    prefetchChild: (nodeId: string, input: PrefetchRequest, opts?: RequestOptions) =>
      request('POST', `/nodes/${id(nodeId)}/prefetch`, SceneView, input, opts).then(withSceneMedia),

    reportNode: (nodeId: string, input: ReportRequest, opts?: RequestOptions) =>
      request('POST', `/nodes/${id(nodeId)}/report`, ReportResponse, input, opts),

    choose: (storyId: string, input: ChooseRequest, opts?: RequestOptions) =>
      request('POST', `/stories/${id(storyId)}/choose`, ChooseResponse, input, opts),

    finish: (storyId: string, opts?: RequestOptions) =>
      request('POST', `/stories/${id(storyId)}/finish`, FinishResponse, {}, opts).then((result) => ({
        ...result,
        shareUrl: media(result.shareUrl) ?? result.shareUrl,
        movieUrl: media(result.movieUrl),
      })),

    getWallet: (opts?: RequestOptions) => request('GET', '/wallet', WalletView, undefined, opts),

    verifyPurchase: (input: VerifyPurchaseRequest, opts?: RequestOptions) =>
      request('POST', '/purchases/verify', VerifyPurchaseResponse, input, opts),

    getShare: (slug: string, opts?: RequestOptions) =>
      request('GET', `/share/${id(slug)}`, ShareView, undefined, opts).then((share) => ({
        ...share,
        movieUrl: media(share.movieUrl),
        scenes: share.scenes.map((scene) => ({
          ...scene,
          clipUrl: media(scene.clipUrl) ?? scene.clipUrl,
          posterUrl: media(scene.posterUrl),
        })),
      })),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
