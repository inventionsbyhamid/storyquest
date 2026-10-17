import { describe, expect, it, vi } from 'vitest';
import { makeScene } from '../test/fixtures';
import { createApiClient } from './client';
import { ApiError } from './errors';

type FetchArgs = [string, RequestInit];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

const story = {
  id: 'story-1',
  title: 'The Moon Door',
  audience: 'family',
  ideaId: 'idea-1',
  currentNodeId: 'root',
  path: ['root'],
  status: 'active',
  shareSlug: null,
};

function setup(
  responses: Array<Response | Error | ((init: RequestInit) => Promise<Response>)>,
  iapUserId: string | null = null,
) {
  const calls: FetchArgs[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(init);
    return next;
  });
  const sleeps: number[] = [];
  const client = createApiClient({
    getBaseUrl: () => 'https://api.example.test',
    getDeviceId: async () => 'tv_device',
    getIapUserId: () => iapUserId,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
  return { client, calls, sleeps };
}

describe('api client', () => {
  it('sends the device id and parses today', async () => {
    const today = { date: '2026-10-17', ideas: [] };
    const { client, calls } = setup([jsonResponse(today)]);
    await expect(client.getToday()).resolves.toEqual(today);
    const [url, init] = calls[0];
    expect(url).toBe('https://api.example.test/v1/today');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['x-device-id']).toBe('tv_device');
  });

  it('sends the iap user id once it is known', async () => {
    const wallet = {
      sparks: 12,
      freeSparks: 1,
      sceneCost: 1,
      products: [{ sku: 'sparks_10', sparks: 10 }],
      purchasesEnabled: true,
    };
    const { client, calls } = setup([jsonResponse(wallet), jsonResponse(wallet)], 'amzn-user');
    await expect(client.getWallet()).resolves.toEqual(wallet);
    expect(calls[0][0]).toBe('https://api.example.test/v1/wallet');
    expect((calls[0][1].headers as Record<string, string>)['x-iap-user-id']).toBe('amzn-user');

    const without = setup([jsonResponse(wallet)]);
    await without.client.getWallet();
    expect((without.calls[0][1].headers as Record<string, string>)['x-iap-user-id']).toBeUndefined();
  });

  it('verifies purchases and reports invalid receipts', async () => {
    const wallet = {
      sparks: 10,
      freeSparks: 0,
      sceneCost: 1,
      products: [],
      purchasesEnabled: true,
    };
    const ok = setup([jsonResponse({ wallet, credited: 10, alreadyProcessed: false })]);
    const body = { receiptId: 'r1', userId: 'u1', sku: 'sparks_10' };
    await expect(ok.client.verifyPurchase(body)).resolves.toMatchObject({ credited: 10 });
    expect(ok.calls[0][0]).toBe('https://api.example.test/v1/purchases/verify');
    expect(JSON.parse(ok.calls[0][1].body as string)).toEqual(body);

    const bad = setup([jsonResponse({ error: { code: 'purchase_invalid', message: 'no' } }, 400)]);
    await expect(bad.client.verifyPurchase(body)).rejects.toMatchObject({ code: 'purchase_invalid' });
  });

  it('asks the server to prepare one focused choice', async () => {
    const { client, calls } = setup([jsonResponse(makeScene({ id: 'node/1' }))]);
    const parent = await client.prefetchChild('node/1', { index: 1 });
    expect(parent.id).toBe('node/1');
    expect(parent.clipUrl).toBe('https://api.example.test/media/node/1/clip.mp4');
    expect(calls[0][0]).toBe('https://api.example.test/v1/nodes/node%2F1/prefetch');
    expect(calls[0][1].method).toBe('POST');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ index: 1 });
  });

  it('posts json bodies', async () => {
    const { client, calls } = setup([jsonResponse(story)]);
    await client.startStory({ kind: 'idea', ideaId: 'idea-1' });
    const [url, init] = calls[0];
    expect(url).toBe('https://api.example.test/v1/stories');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'idea', ideaId: 'idea-1' });
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('builds the long poll url and encodes ids', async () => {
    const { client, calls } = setup([jsonResponse(makeScene({ id: 'a/b' }))]);
    await client.getNode('a/b', { wait: 8 });
    expect(calls[0][0]).toBe('https://api.example.test/v1/nodes/a%2Fb?wait=8');
  });

  it('resolves media urls against the api base', async () => {
    const { client } = setup([jsonResponse(makeScene({ id: 'n1' }))]);
    const scene = await client.getNode('n1');
    expect(scene.clipUrl).toBe('https://api.example.test/media/n1/clip.mp4');
    expect(scene.lastFrameUrl).toBe('https://api.example.test/media/n1/last.jpg');
    expect(scene.choices[0].posterUrl).toBe('https://api.example.test/media/child-0/poster.jpg');

    const finish = setup([
      jsonResponse({
        story: { ...story, status: 'finished', shareSlug: 'abc' },
        shareSlug: 'abc',
        shareUrl: '/s/abc',
        movieStatus: 'pending',
        movieUrl: null,
        stats: { choices: [], rarestChoice: null, endingsDiscovered: 1, familiesPlayed: 2 },
      }),
    ]);
    const result = await finish.client.finish('story-1');
    expect(result.shareUrl).toBe('https://api.example.test/s/abc');
    expect(result.movieUrl).toBeNull();
  });

  it('turns server errors into typed errors', async () => {
    const { client } = setup([jsonResponse({ error: { code: 'unsafe_input', message: 'nope' } }, 400)]);
    const error = await client
      .choose('story-1', { kind: 'custom', fromNodeId: 'root', text: 'hmm hmm' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('unsafe_input');
    expect(error.status).toBe(400);
  });

  it('maps unknown error bodies by status', async () => {
    const { client } = setup([jsonResponse(undefined, 404)]);
    await expect(client.getStory('missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('rejects responses that do not match the contract', async () => {
    const { client } = setup([jsonResponse({ date: 7 })]);
    await expect(client.getToday({ retries: 0 })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('retries idempotent requests with backoff', async () => {
    const today = { date: '2026-10-17', ideas: [] };
    const { client, sleeps, calls } = setup([
      new TypeError('Network request failed'),
      jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500),
      jsonResponse(today),
    ]);
    await expect(client.getToday()).resolves.toEqual(today);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([400, 800]);
  });

  it('gives up after the retry budget', async () => {
    const { client, calls } = setup([new TypeError('down'), new TypeError('down'), new TypeError('down')]);
    await expect(client.getToday()).rejects.toMatchObject({ code: 'network' });
    expect(calls).toHaveLength(3);
  });

  it('does not retry client errors or posts', async () => {
    const first = setup([jsonResponse({ error: { code: 'not_found', message: 'gone' } }, 404)]);
    await expect(first.client.getStory('x')).rejects.toMatchObject({ code: 'not_found' });
    expect(first.calls).toHaveLength(1);

    const second = setup([new TypeError('down')]);
    await expect(second.client.finish('story-1')).rejects.toMatchObject({ code: 'network' });
    expect(second.calls).toHaveLength(1);
  });

  it('times out slow requests', async () => {
    vi.useFakeTimers();
    try {
      const { client } = setup([
        (init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ]);
      const pending = client.getToday({ timeoutMs: 1000, retries: 0 }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      await expect(pending).resolves.toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports caller aborts as aborted and does not retry', async () => {
    const controller = new AbortController();
    const { client, calls } = setup([
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          controller.abort();
        }),
    ]);
    await expect(client.getToday({ signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(calls).toHaveLength(1);
  });

  it('uses a timeout longer than the long poll wait', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const { client } = setup([
        (init) =>
          new Promise<Response>((resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
            setTimeout(() => resolve(jsonResponse(makeScene())), 8500);
          }),
      ]);
      const pending = client.getNode('node-1', { wait: 8 });
      await vi.advanceTimersByTimeAsync(8600);
      await expect(pending).resolves.toMatchObject({ id: 'node-1' });
      expect(aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
