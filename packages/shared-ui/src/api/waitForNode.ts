import type { SceneView } from '@storyquest/contracts';
import type { ApiClient } from './client';
import { ApiError, isTransient, toApiError } from './errors';
import { sleep as defaultSleep } from './sleep';
import { backoffDelay } from './client';

export interface WaitForNodeOptions {
  signal: AbortSignal;
  until?: (scene: SceneView) => boolean;
  onUpdate?: (scene: SceneView) => void;
  waitSeconds?: number;
  minIntervalMs?: number;
  maxFailures?: number;
  maxDurationMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const isNodeSettled = (scene: SceneView) => scene.status === 'ready' || scene.status === 'failed';

export const areChoicesSettled = (scene: SceneView) =>
  scene.status !== 'ready' || scene.isEnding || scene.choices.every((choice) => choice.ready);

export async function waitForNode(
  client: Pick<ApiClient, 'getNode'>,
  nodeId: string,
  options: WaitForNodeOptions,
): Promise<SceneView> {
  const {
    signal,
    until = isNodeSettled,
    onUpdate,
    waitSeconds = 8,
    minIntervalMs = 1000,
    maxFailures = 4,
    maxDurationMs = 4 * 60 * 1000,
    now = Date.now,
    sleep = defaultSleep,
  } = options;

  const startedAt = now();
  let failures = 0;

  for (;;) {
    if (signal.aborted) throw new ApiError('aborted', 'Cancelled');
    if (now() - startedAt > maxDurationMs) throw new ApiError('timeout', 'Gave up waiting for the scene');

    const requestedAt = now();
    try {
      const scene = await client.getNode(nodeId, { wait: waitSeconds, signal });
      failures = 0;
      onUpdate?.(scene);
      if (until(scene)) return scene;
      const elapsed = now() - requestedAt;
      if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed, signal);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'aborted') throw apiError;
      if (apiError.code === 'not_ready') {
        const elapsed = now() - requestedAt;
        if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed, signal);
        continue;
      }
      if (!isTransient(apiError)) throw apiError;
      failures += 1;
      if (failures > maxFailures) throw apiError;
      await sleep(backoffDelay(failures), signal);
    }
  }
}
