import { describe, expect, it, vi } from 'vitest';
import type { SceneView } from '@storyquest/contracts';
import { makeChoice, makeScene } from '../test/fixtures';
import { ApiError } from './errors';
import { areChoicesSettled, waitForNode } from './waitForNode';

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function script(steps: Array<SceneView | ApiError>, clock: ReturnType<typeof fakeClock>, latency = 0) {
  const getNode = vi.fn(async () => {
    clock.advance(latency);
    const step = steps.shift();
    if (!step) throw new Error('script exhausted');
    if (step instanceof ApiError) throw step;
    return step;
  });
  return { getNode };
}

describe('waitForNode', () => {
  it('returns once the node is ready and reports every update', async () => {
    const clock = fakeClock();
    const client = script(
      [
        makeScene({ status: 'pending', clipUrl: null }),
        makeScene({ status: 'generating', clipUrl: null }),
        makeScene(),
      ],
      clock,
      8000,
    );
    const updates: string[] = [];
    const sleep = vi.fn(async () => undefined);
    const scene = await waitForNode(client, 'node-1', {
      signal: new AbortController().signal,
      onUpdate: (s) => updates.push(s.status),
      now: clock.now,
      sleep,
    });
    expect(scene.status).toBe('ready');
    expect(updates).toEqual(['pending', 'generating', 'ready']);
    expect(client.getNode).toHaveBeenCalledWith('node-1', expect.objectContaining({ wait: 8 }));
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns failed nodes instead of looping', async () => {
    const clock = fakeClock();
    const client = script([makeScene({ status: 'failed', clipUrl: null })], clock);
    const scene = await waitForNode(client, 'node-1', {
      signal: new AbortController().signal,
      now: clock.now,
      sleep: async () => undefined,
    });
    expect(scene.status).toBe('failed');
  });

  it('throttles when the server answers immediately', async () => {
    const clock = fakeClock();
    const client = script([makeScene({ status: 'pending', clipUrl: null }), makeScene()], clock, 200);
    const sleeps: number[] = [];
    await waitForNode(client, 'node-1', {
      signal: new AbortController().signal,
      minIntervalMs: 1000,
      now: clock.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
    });
    expect(sleeps).toEqual([800]);
  });

  it('retries transient failures and resets the counter after a success', async () => {
    const clock = fakeClock();
    const client = script(
      [
        new ApiError('network', 'down'),
        new ApiError('timeout', 'slow'),
        makeScene({ status: 'generating', clipUrl: null }),
        new ApiError('network', 'down'),
        makeScene(),
      ],
      clock,
      8000,
    );
    const scene = await waitForNode(client, 'node-1', {
      signal: new AbortController().signal,
      maxFailures: 2,
      now: clock.now,
      sleep: async () => undefined,
    });
    expect(scene.status).toBe('ready');
  });

  it('gives up after too many failures', async () => {
    const clock = fakeClock();
    const client = script(
      [new ApiError('network', 'a'), new ApiError('network', 'b'), new ApiError('network', 'c')],
      clock,
    );
    await expect(
      waitForNode(client, 'node-1', {
        signal: new AbortController().signal,
        maxFailures: 2,
        now: clock.now,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('fails fast on errors that will not fix themselves', async () => {
    const clock = fakeClock();
    const client = script([new ApiError('not_found', 'gone')], clock);
    await expect(
      waitForNode(client, 'node-1', {
        signal: new AbortController().signal,
        now: clock.now,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(client.getNode).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller aborts', async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const client = script([makeScene({ status: 'pending', clipUrl: null })], clock, 8000);
    const result = waitForNode(client, 'node-1', {
      signal: controller.signal,
      now: clock.now,
      onUpdate: () => controller.abort(),
      sleep: async () => undefined,
    });
    await expect(result).rejects.toMatchObject({ code: 'aborted' });
  });

  it('times out after the maximum duration', async () => {
    const clock = fakeClock();
    const client = script(
      Array.from({ length: 10 }, () => makeScene({ status: 'generating', clipUrl: null })),
      clock,
      8000,
    );
    await expect(
      waitForNode(client, 'node-1', {
        signal: new AbortController().signal,
        maxDurationMs: 20000,
        now: clock.now,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('can wait for choices to become ready', async () => {
    const clock = fakeClock();
    const notReady = makeScene({ choices: [makeChoice(0, { ready: false }), makeChoice(1)] });
    const client = script([notReady, makeScene()], clock, 8000);
    const scene = await waitForNode(client, 'node-1', {
      signal: new AbortController().signal,
      until: areChoicesSettled,
      now: clock.now,
      sleep: async () => undefined,
    });
    expect(scene.choices.every((c) => c.ready)).toBe(true);
    expect(areChoicesSettled(makeScene({ isEnding: true, choices: [] }))).toBe(true);
  });
});
