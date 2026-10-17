import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TodayResponse } from '@storyquest/contracts';
import { ApiError } from '@fal-ai/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { Bible } from '../src/domain';
import { JobQueue } from '../src/engine/queue';
import { createServer } from '../src/http/app';
import { silentLogger } from '../src/log';
import { Media } from '../src/media';
import { FakeDirector } from '../src/providers/director/fake';
import type { Scene, SceneRequest } from '../src/providers/director/types';
import { FakeVideo } from '../src/providers/video/fake';
import { FalVideo } from '../src/providers/video/fal';
import { VideoRejected } from '../src/providers/video/types';
import type { Services } from '../src/services';
import { captureLogger, createRig, manualClock, SpyVideo, testConfig, type TestRig } from './helpers';

const TODAY = '2026-10-17T12:00:00Z';
const ADMIN = { authorization: 'Bearer resilience_admin_token' };

class FlakyDirector extends FakeDirector {
  failPlans = false;
  hangPlans = false;
  planCalls = 0;
  readonly drafts: boolean[] = [];

  override async planIdeas(date: string, count: number, avoid: string[] = []): Promise<Bible[]> {
    this.planCalls++;
    if (this.hangPlans) return new Promise(() => {});
    if (this.failPlans) throw new Error('director unavailable');
    return super.planIdeas(date, count, avoid);
  }

  override async writeScene(request: SceneRequest): Promise<Scene> {
    this.drafts.push(Boolean(request.stricter));
    return super.writeScene(request);
  }
}

let rig: TestRig | null = null;
let server: { app: FastifyInstance; services: Services; dir: string } | null = null;

afterEach(async () => {
  await rig?.close();
  rig = null;
  if (server) {
    await server.services.engine.stop(15_000);
    await server.app.close();
    server.services.db.close();
    rmSync(server.dir, { recursive: true, force: true });
    server = null;
  }
});

async function bootServer(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-resilience-'));
  const config = testConfig(dir, { DAILY_IDEAS: '2', WARM_DEPTH: '0', ADMIN_TOKEN: 'resilience_admin_token', ...env });
  const clock = manualClock(TODAY);
  const director = new FlakyDirector();
  const video = new SpyVideo(
    new FakeVideo(new Media(), { width: config.fakeVideoWidth, height: config.fakeVideoHeight, delayMs: 0, fontFile: config.FONT_FILE }),
  );
  const { app, services } = await createServer(config, { director, video, now: clock.now });
  services.engine.start();
  server = { app, services, dir };
  return { app, services, director, video, clock };
}

async function today(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/v1/today' });
  expect(res.statusCode).toBe(200);
  return TodayResponse.parse(res.json());
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('today fallback', () => {
  it('shows the latest playable day when today cannot be planned', async () => {
    const { app, services, director } = await bootServer();
    await services.daily.ensure('2026-10-16');
    await services.engine.idle();

    director.failPlans = true;
    const home = await today(app);
    expect(home.date).toBe('2026-10-16');
    expect(home.ideas).toHaveLength(2);
    expect(home.ideas.every((idea) => idea.ready && idea.date === '2026-10-16')).toBe(true);
  });

  it('shows the latest playable day while today has no ready opening yet', async () => {
    const { app, services, video } = await bootServer();
    await services.daily.ensure('2026-10-16');
    await services.engine.idle();

    video.failWith = new Error('video provider down');
    await services.daily.ensure('2026-10-17');
    await services.engine.idle();
    expect(services.repo.listIdeas('2026-10-17').every((idea) => services.repo.getNode(idea.rootNodeId)!.status === 'failed')).toBe(true);

    const home = await today(app);
    expect(home.date).toBe('2026-10-16');

    video.failWith = null;
    await services.daily.ensure('2026-10-17');
    await services.engine.idle();
    expect((await today(app)).date).toBe('2026-10-17');
  });

  it('answers straight away while the director is stuck', async () => {
    const { app, services, director } = await bootServer();
    await services.daily.ensure('2026-10-16');
    await services.engine.idle();
    director.hangPlans = true;

    const started = Date.now();
    const home = await today(app);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(home.date).toBe('2026-10-16');
    expect(director.planCalls).toBe(2);
  });

  it('retries daily creation with a growing backoff of at least ten minutes', async () => {
    const { services, director, clock } = await bootServer();
    director.failPlans = true;
    const minutes = (n: number) => n * 60_000;

    services.daily.kick();
    await settle();
    expect(director.planCalls).toBe(1);

    services.daily.kick();
    clock.advance(minutes(9));
    services.daily.kick();
    await settle();
    expect(director.planCalls).toBe(1);

    clock.advance(minutes(1) + 1_000);
    services.daily.kick();
    await settle();
    expect(director.planCalls).toBe(2);

    clock.advance(minutes(15));
    services.daily.kick();
    await settle();
    expect(director.planCalls).toBe(2);

    clock.advance(minutes(5) + 1_000);
    director.failPlans = false;
    services.daily.kick();
    await settle();
    expect(director.planCalls).toBe(3);
    expect(services.daily.retryState.failures).toBe(0);
    expect(services.repo.listIdeas('2026-10-17')).toHaveLength(2);
  });
});

describe('story lifetime', () => {
  it('lists the ideas of the last IDEA_LIFETIME_DAYS days, newest first', async () => {
    const { app, services } = await bootServer({ DAILY_IDEAS: '1', IDEA_LIFETIME_DAYS: '3' });
    for (const date of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) await services.daily.ensure(date);
    await services.engine.idle();
    const home = await today(app);
    expect(home.date).toBe('2026-10-17');
    expect(home.ideas.map((idea) => idea.date)).toEqual(['2026-10-17', '2026-10-16', '2026-10-15']);
  });
});

describe('featured stories', () => {
  it('appends pinned ideas from earlier days after today, without duplicates and up to the cap', async () => {
    const { app, services } = await bootServer();
    for (const date of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) await services.daily.ensure(date);
    await services.engine.idle();

    const older = ['2026-10-14', '2026-10-15', '2026-10-16'].flatMap((date) => services.repo.listIdeas(date));
    const todays = services.repo.listIdeas('2026-10-17');
    const pin = (id: string) => app.inject({ method: 'POST', url: `/v1/admin/ideas/${id}/feature`, headers: ADMIN });

    const pinned = await pin(older[0]!.id);
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json()).toMatchObject({ featured: true, idea: { id: older[0]!.id, date: '2026-10-14' } });
    await pin(todays[0]!.id);

    let home = await today(app);
    expect(home.date).toBe('2026-10-17');
    expect(home.ideas.map((idea) => idea.id)).toEqual([todays[0]!.id, todays[1]!.id, older[0]!.id]);
    expect(home.ideas[2]!.date).toBe('2026-10-14');

    for (const idea of older) await pin(idea.id);
    home = await today(app);
    expect(home.ideas).toHaveLength(2 + 3);

    const unpinned = await app.inject({ method: 'DELETE', url: `/v1/admin/ideas/${older[0]!.id}/feature`, headers: ADMIN });
    expect(unpinned.json()).toMatchObject({ featured: false });
    home = await today(app);
    expect(home.ideas.map((idea) => idea.id)).not.toContain(older[0]!.id);
  });

  it('guards the feature endpoints', async () => {
    const { app } = await bootServer();
    const missing = await app.inject({ method: 'POST', url: '/v1/admin/ideas/id_0000000000000000/feature', headers: ADMIN });
    expect(missing.statusCode).toBe(404);
    const anonymous = await app.inject({ method: 'POST', url: '/v1/admin/ideas/id_0000000000000000/feature' });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('warming a whole tree', () => {
  it('generates every preset path down to the requested depth at low priority', async () => {
    const { app, services } = await bootServer({ SCENES_PER_STORY: '3', DAILY_IDEAS: '1' });
    await services.daily.ensure();
    const idea = services.repo.listIdeas('2026-10-17')[0]!;

    const started = await app.inject({ method: 'POST', url: `/v1/admin/ideas/${idea.id}/warm?depth=3`, headers: ADMIN });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ depth: 3, expected: 7, force: false });

    await services.engine.idle();
    const progress = (await app.inject({ method: 'GET', url: `/v1/admin/ideas/${idea.id}/warm`, headers: ADMIN })).json();
    expect(progress).toMatchObject({ complete: true, counts: { ready: 7, pending: 0, generating: 0, failed: 0 } });

    const nodes = services.repo.listSharedNodes(idea.treeId, 10);
    expect(nodes).toHaveLength(7);
    const endings = nodes.filter((node) => node.depth === 2);
    expect(endings.every((node) => node.isEnding && services.repo.getPresetChildren(node.id).length === 0)).toBe(true);
  });

  it('stops at the daily cap unless forced', async () => {
    const { app, services } = await bootServer({ SCENES_PER_STORY: '3', DAILY_IDEAS: '1', DAILY_VIDEO_SECONDS_CAP: '4' });
    await services.daily.ensure();
    const idea = services.repo.listIdeas('2026-10-17')[0]!;

    await app.inject({ method: 'POST', url: `/v1/admin/ideas/${idea.id}/warm`, headers: ADMIN });
    await services.engine.idle();
    let progress = services.engine.warmProgress(idea.id);
    expect(progress.complete).toBe(false);
    expect(progress.budgetExhausted).toBe(true);
    expect(progress.counts.ready).toBe(4);
    expect(services.repo.spendSeconds('2026-10-17')).toBe(4);

    await app.inject({ method: 'POST', url: `/v1/admin/ideas/${idea.id}/warm?depth=3&force=true`, headers: ADMIN });
    await services.engine.idle();
    progress = services.engine.warmProgress(idea.id);
    expect(progress).toMatchObject({ complete: true, force: true });
    expect(services.repo.spendSeconds('2026-10-17')).toBe(7);
  });

  it('runs live work before queued warm jobs', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new JobQueue(
      1,
      async (id) => {
        order.push(id);
        if (id === 'first') await gate;
      },
      silentLogger,
    );
    queue.enqueue('first', 'low');
    queue.enqueue('warm_a', 'low');
    queue.enqueue('warm_b', 'low');
    queue.enqueue('family', 'high');
    queue.enqueue('warm_b', 'high');
    release();
    await queue.idle();
    expect(order).toEqual(['first', 'family', 'warm_b', 'warm_a']);
  });
});

describe('budget defaults', () => {
  it('defaults to a 900 second daily cap', () => {
    expect(loadConfig({}).DAILY_VIDEO_SECONDS_CAP).toBe(900);
  });

  it('warns once when spend passes 80% of the cap', async () => {
    const { logger, entries } = captureLogger();
    rig = createRig({ DAILY_IDEAS: '1', WARM_DEPTH: '1', DAILY_VIDEO_SECONDS_CAP: '3' }, {}, logger);
    rig.services.engine.start();
    await rig.services.daily.ensure();
    await rig.services.engine.idle();
    const warnings = entries.filter((entry) => entry.msg === 'daily video spend passed 80% of the cap');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.obj).toMatchObject({ spentSeconds: 3, capSeconds: 3 });
  });
});

describe('video safety rejections', () => {
  it('asks the director for a gentler scene once and renders that', async () => {
    const director = new FlakyDirector();
    rig = createRig({ DAILY_IDEAS: '1', WARM_DEPTH: '0' }, { director });
    rig.services.engine.start();
    rig.video.rejectNext = 1;
    await rig.services.daily.ensure();
    const idea = rig.services.repo.listIdeas(rig.services.daily.today())[0]!;
    const root = await rig.services.engine.waitForNode(idea.rootNodeId, 20_000);
    expect(root?.status).toBe('ready');
    expect(director.drafts).toEqual([false, true]);
    expect(rig.video.calls).toHaveLength(2);
  });

  it('fails kindly when the gentler scene is rejected too', async () => {
    const director = new FlakyDirector();
    rig = createRig({ DAILY_IDEAS: '1', WARM_DEPTH: '0' }, { director });
    rig.services.engine.start();
    rig.video.rejectNext = 2;
    await rig.services.daily.ensure();
    const idea = rig.services.repo.listIdeas(rig.services.daily.today())[0]!;
    const root = await rig.services.engine.waitForNode(idea.rootNodeId, 20_000);
    expect(root).toMatchObject({ status: 'failed', error: expect.stringContaining('did not turn out right') });
    expect(rig.video.calls).toHaveLength(2);
    expect(rig.services.repo.spendSeconds(rig.services.daily.today())).toBe(0);
  });

  it('maps fal 422 rejections to VideoRejected without retrying, and retries server errors once', async () => {
    const options = {
      key: 'unused',
      textToVideoModel: 't2v',
      imageToVideoModel: 'i2v',
      resolution: '768P',
      promptExpansion: 'disabled',
      retryDelayMs: 0,
    };
    const request = { prompt: 'p', caption: 'c', seconds: 8, startFramePath: null, outPath: '/tmp/never.mp4' };

    let calls = 0;
    const rejecting = new FalVideo(options, silentLogger, {
      subscribe: async () => {
        calls++;
        throw new ApiError({ message: 'Unprocessable Entity', status: 422, body: { detail: [{ type: 'content_policy_violation' }] } });
      },
    });
    await expect(rejecting.render(request)).rejects.toBeInstanceOf(VideoRejected);
    expect(calls).toBe(1);

    calls = 0;
    const flaky = new FalVideo(options, silentLogger, {
      subscribe: async () => {
        calls++;
        throw new ApiError({ message: 'Bad Gateway', status: 502 });
      },
    });
    await expect(flaky.render(request)).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(2);
  });
});
