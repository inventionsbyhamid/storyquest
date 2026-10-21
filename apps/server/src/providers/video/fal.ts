import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError, createFalClient, type FalClient } from '@fal-ai/client';
import type { Logger } from '../../log';
import { VideoNotBilled, VideoRejected, type RenderRequest, type RenderResult, type VideoProvider } from './types';

export interface FalVideoOptions {
  key: string;
  textToVideoModel: string;
  imageToVideoModel: string;
  resolution: string;
  promptExpansion: string;
  retryDelayMs?: number;
}

interface FalVideoOutput {
  video?: { url?: string; content_type?: string; file_size?: number };
  timings?: { inference?: number };
  expanded_prompt?: string;
}

const RENDER_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const ATTEMPTS = 2;
// The model has no negative prompt and sometimes burns the spoken line in as a subtitle; the app shows its own captions.
const NO_TEXT = ' No subtitles, captions or written words anywhere on screen.';

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  return true;
}

export class FalVideo implements VideoProvider {
  readonly name = 'fal';
  private readonly client: Pick<FalClient, 'subscribe'>;

  constructor(
    private readonly options: FalVideoOptions,
    private readonly log: Logger,
    client?: Pick<FalClient, 'subscribe'>,
  ) {
    this.client = client ?? createFalClient({ credentials: options.key });
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const endpoint = request.startFramePath ? this.options.imageToVideoModel : this.options.textToVideoModel;
    const input: Record<string, unknown> = {
      prompt: request.prompt + NO_TEXT,
      duration: request.seconds,
      resolution: this.options.resolution,
      prompt_expansion_mode: this.options.promptExpansion,
      enable_safety_checker: true,
    };
    if (request.startFramePath) {
      // The client uploads Blob inputs to fal storage and swaps in the URL.
      const frame = await readFile(request.startFramePath);
      input.image_url = new Blob([frame], { type: 'image/jpeg' });
    } else {
      input.aspect_ratio = '16:9';
    }

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const started = Date.now();
      let enqueued = false;
      try {
        const result = await this.client.subscribe(endpoint, {
          input,
          logs: false,
          timeout: RENDER_TIMEOUT_MS,
          abortSignal: AbortSignal.timeout(RENDER_TIMEOUT_MS + 5_000),
          onEnqueue: () => {
            enqueued = true;
          },
        });
        const output = result.data as FalVideoOutput;
        const url = output.video?.url;
        if (!url) throw new Error('fal returned no video url');
        await this.download(url, request.outPath);
        const inferenceMs = output.timings?.inference ? Math.round(output.timings.inference * 1000) : null;
        this.log.info({ endpoint, attempt, requestId: result.requestId, ms: Date.now() - started, inferenceMs }, 'video rendered');
        return { billedSeconds: request.seconds, inferenceMs };
      } catch (err) {
        const status = err instanceof ApiError ? err.status : undefined;
        const message = (err as Error).message;
        this.log.warn({ endpoint, attempt, status, enqueued, error: message }, 'video render failed');
        // fal answers 422 when its safety checker or input validation turns a prompt down.
        if (status === 422 || status === 400) throw new VideoRejected(`video request rejected: ${message}`, enqueued);
        // Once fal has queued the job it may run and bill even if we stop waiting, so it counts and is not retried.
        if (enqueued) throw err;
        if (!isRetryable(err) || attempt === ATTEMPTS) throw new VideoNotBilled(`fal did not take the request: ${message}`);
        await sleep((this.options.retryDelayMs ?? 1_500) * attempt);
      }
    }
    throw new VideoNotBilled('fal did not take the request');
  }

  private async download(url: string, outPath: string): Promise<void> {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok || !response.body) throw new Error(`video download failed with status ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(outPath));
  }
}
