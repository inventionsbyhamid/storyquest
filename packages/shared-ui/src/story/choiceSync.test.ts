import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { createSerialQueue, sendChoice } from './choiceSync';

const story = (currentNodeId: string) => ({
  id: 's1',
  title: 'T',
  audience: 'family' as const,
  ideaId: null,
  currentNodeId,
  path: ['root', currentNodeId],
  status: 'active' as const,
  shareSlug: null,
});

const request = { kind: 'preset' as const, fromNodeId: 'root', index: 0 };

describe('createSerialQueue', () => {
  it('runs tasks one after another even when one fails', async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    let release!: () => void;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push('first');
            resolve();
          };
        }),
    );
    const second = queue.run(async () => {
      order.push('second');
      throw new Error('nope');
    });
    const third = queue.run(async () => {
      order.push('third');
      return 3;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);
    release();
    await first;
    await expect(second).rejects.toThrow('nope');
    await expect(third).resolves.toBe(3);
    await queue.idle();
    expect(order).toEqual(['first', 'second', 'third']);
  });
});

describe('sendChoice', () => {
  const noWait = { sleep: async () => undefined };

  it('sends the choice once when it works', async () => {
    const client = {
      choose: vi.fn(async () => ({ story: story('child-0'), nextNodeId: 'child-0' })),
      getStory: vi.fn(),
    };
    await sendChoice(client, 's1', request, 'child-0', noWait);
    expect(client.choose).toHaveBeenCalledTimes(1);
    expect(client.getStory).not.toHaveBeenCalled();
  });

  it('retries once after a failure', async () => {
    const choose = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('network', 'down'))
      .mockResolvedValueOnce({ story: story('child-0'), nextNodeId: 'child-0' });
    const client = { choose, getStory: vi.fn(async () => story('root')) };
    await sendChoice(client, 's1', request, 'child-0', noWait);
    expect(choose).toHaveBeenCalledTimes(2);
  });

  it('accepts a lost response when the server already moved on', async () => {
    const client = {
      choose: vi.fn().mockRejectedValue(new ApiError('timeout', 'slow')),
      getStory: vi.fn(async () => story('child-0')),
    };
    await sendChoice(client, 's1', request, 'child-0', noWait);
    expect(client.choose).toHaveBeenCalledTimes(1);
  });

  it('gives up after the second failure', async () => {
    const client = {
      choose: vi.fn().mockRejectedValue(new ApiError('network', 'down')),
      getStory: vi.fn().mockRejectedValue(new ApiError('network', 'down')),
    };
    await expect(sendChoice(client, 's1', request, 'child-0', noWait)).rejects.toMatchObject({ code: 'network' });
    expect(client.choose).toHaveBeenCalledTimes(2);
  });
});
