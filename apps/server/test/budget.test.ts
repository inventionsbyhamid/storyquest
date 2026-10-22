import type Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChooseResponse, SceneView, StoryView, TodayResponse, WalletView } from '@storyquest/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { openDatabase } from '../src/db/database';
import { Repository } from '../src/db/repo';
import type { Bible } from '../src/domain';
import { Budget, BudgetExhausted } from '../src/engine/budget';
import { VideoOutOfCredit } from '../src/providers/video/types';
import { StoryEngine } from '../src/engine/engine';
import { createServer } from '../src/http/app';
import { silentLogger } from '../src/log';
import { Media } from '../src/media';
import { AnthropicChat, type MessagesClient } from '../src/providers/director/anthropic';
import { FakeDirector } from '../src/providers/director/fake';
import { LlmDirector } from '../src/providers/director/llm';
import { FakeVideo } from '../src/providers/video/fake';
import { VideoNotBilled, VideoRejected } from '../src/providers/video/types';
import { createServices, type Services } from '../src/services';
import { createRig, DEVICE, SpyVideo, testConfig, type TestRig } from './helpers';

const ADMIN = { authorization: 'Bearer budget_admin_token_1' };

let rig: TestRig | null = null;
let server: { app: FastifyInstance; services: Services; dir: string } | null = null;
const cleanups: Array<() => Promise<void>> = [];

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
  while (cleanups.length) await cleanups.pop()!();
});

function spyVideo(config: ReturnType<typeof testConfig>) {
  return new SpyVideo(
    new FakeVideo(new Media(), { width: config.fakeVideoWidth, height: config.fakeVideoHeight, delayMs: 0, fontFile: config.FONT_FILE }),
  );
}

async function boot(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-budget-'));
  const config = testConfig(dir, { DAILY_IDEAS: '1', WARM_DEPTH: '0', SCENES_PER_STORY: '3', ADMIN_TOKEN: 'budget_admin_token_1', ...env });
  const video = spyVideo(config);
  const { app, services } = await createServer(config, { video });
  services.engine.start();
  await services.daily.ensure();
  await services.engine.idle();
  server = { app, services, dir };
  return { app, services, video };
}

async function scene(app: FastifyInstance, id: string) {
  for (let i = 0; i < 20; i++) {
    const view = SceneView.parse((await app.inject({ method: 'GET', url: `/v1/nodes/${id}?wait=5` })).json());
    if (view.status === 'ready' || view.status === 'failed') return view;
  }
  throw new Error('scene never settled');
}

async function job(app: FastifyInstance, id: string) {
  for (let i = 0; i < 200; i++) {
    const view = (await app.inject({ method: 'GET', url: `/v1/admin/film/${id}`, headers: ADMIN })).json();
    if (view.status !== 'running') return view;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('job never finished');
}

describe('lifetime video cap', () => {
  it('holds under parallel renders and survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storyquest-budget-'));
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    const config = testConfig(dir, { TOTAL_VIDEO_SECONDS_CAP: '3', DAILY_IDEAS: '6', WARM_DEPTH: '0', MAX_PARALLEL_JOBS: '6' });
    const video = spyVideo(config);
    const services = createServices(config, silentLogger, { video });
    services.engine.start();
    await services.daily.ensure();
    await services.engine.idle();

    const roots = services.repo.listIdeas(services.daily.today()).map((idea) => services.repo.getNode(idea.rootNodeId)!);
    expect(roots.filter((node) => node.status === 'ready')).toHaveLength(3);
    const stopped = roots.filter((node) => node.status === 'failed');
    expect(stopped).toHaveLength(3);
    expect(stopped.every((node) => node.errorCode === 'budget_exhausted')).toBe(true);
    expect(video.calls).toHaveLength(3);
    expect(services.repo.getTotal('video_seconds')).toBe(3);
    expect(services.engine.budgetExhausted()).toBe(true);
    await services.engine.stop(5_000);
    services.db.close();

    const reopened = createServices(config, silentLogger, { video });
    cleanups.push(async () => {
      await reopened.engine.stop(5_000);
      reopened.db.close();
    });
    expect(reopened.repo.getTotal('video_seconds')).toBe(3);
    expect(reopened.budget.exhausted()).toBe('total_video');
    reopened.engine.start();
    await reopened.engine.idle();
    expect(video.calls).toHaveLength(3);
  });

  it('gives seconds back only when the provider never started the job', async () => {
    rig = createRig({ DAILY_IDEAS: '1', WARM_DEPTH: '0' });
    rig.services.engine.start();
    rig.video.failWith = new VideoNotBilled('fal did not take the request');
    await rig.services.daily.ensure();
    await rig.services.engine.idle();
    expect(rig.services.repo.getTotal('video_seconds')).toBe(0);
    expect(rig.services.repo.listSpend(10).filter((row) => row.kind === 'video').map((row) => row.status)).toEqual([
      'released',
      'released',
    ]);

    const root = rig.services.repo.listIdeas(rig.services.daily.today())[0]!.rootNodeId;
    rig.video.failWith = new Error('timed out after fal queued the job');
    rig.services.repo.resetFailed(root);
    rig.services.engine.enqueue(root, 'high');
    await rig.services.engine.idle();
    expect(rig.services.repo.getTotal('video_seconds')).toBe(2);
    expect(rig.services.repo.spendSeconds(rig.services.daily.today())).toBe(2);
  });

  it('counts a rejection that happened after the job started', async () => {
    rig = createRig({ DAILY_IDEAS: '1', WARM_DEPTH: '0' });
    rig.services.engine.start();
    rig.video.failWith = new VideoRejected('turned down by the output check', true);
    await rig.services.daily.ensure();
    await rig.services.engine.idle();
    expect(rig.services.repo.getTotal('video_seconds')).toBe(2);
  });
});

describe('director call cap', () => {
  it('stops writing scenes once the cap is reached and turns new work away', async () => {
    rig = createRig({ DIRECTOR_CALL_CAP: '2', DAILY_IDEAS: '2', WARM_DEPTH: '0', MAX_PARALLEL_JOBS: '1' });
    rig.services.engine.start();
    await rig.services.daily.ensure();
    await rig.services.engine.idle();

    const roots = rig.services.repo.listIdeas(rig.services.daily.today()).map((idea) => rig!.services.repo.getNode(idea.rootNodeId)!);
    expect(roots.map((node) => node.status).sort()).toEqual(['failed', 'ready']);
    expect(roots.find((node) => node.status === 'failed')!.errorCode).toBe('budget_exhausted');
    expect(rig.services.repo.getTotal('director_calls')).toBe(2);
    expect(rig.video.calls).toHaveLength(1);
    expect(rig.services.budget.exhausted()).toBe('director_calls');

    const ready = roots.find((node) => node.status === 'ready')!;
    const idea = rig.services.repo.listIdeas(rig.services.daily.today()).find((candidate) => candidate.rootNodeId === ready.id)!;
    const story = await rig.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    await expect(
      rig.services.engine.choose(story.id, DEVICE, { kind: 'preset', fromNodeId: ready.id, index: 0 }),
    ).rejects.toMatchObject({ code: 'budget_exhausted', status: 429 });
  });

  it('counts every director request, retries and validation turns included, with their tokens', async () => {
    const repo = new Repository(openDatabase(':memory:'));
    const config = loadConfig({ DIRECTOR_CALL_CAP: '3' });
    const budget = new Budget({ config, repo, log: silentLogger, now: () => new Date() });
    const good = {
      summary: 'Mia found a silver door in the garden wall. Biscuit barked at the glowing keyhole.',
      caption: 'Mia finds a silver door.',
      videoPrompt:
        'Soft 3D animated film look. Mia, a seven year old girl with curly black hair, kneels by a glowing silver door in a moonlit garden while a beagle puppy wags beside her. Medium shot, slow push in.',
      choices: ['Open the moon door', 'Follow the falling star'],
      isEnding: false,
    };
    const replies: Array<object | Error> = [
      Object.assign(new Error('server busy'), { status: 529 }),
      { text: '{"summary": "too short"}', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500 } },
      { text: JSON.stringify(good), usage: { input_tokens: 1200, output_tokens: 300 } },
    ];
    let sent = 0;
    const client: MessagesClient = {
      messages: {
        async create() {
          sent++;
          const next = replies.shift()!;
          if (next instanceof Error) throw next;
          const { text, usage } = next as { text: string; usage: Anthropic.Usage };
          return {
            content: [{ type: 'text', text, citations: null }],
            stop_reason: 'end_turn',
            usage,
          } as unknown as Anthropic.Message;
        },
      },
    };
    const director = new LlmDirector(
      new AnthropicChat(client, 'bedrock', 'anthropic.claude-opus-5-5', 'low'),
      { sceneSeconds: 8, retryDelayMs: 0 },
      silentLogger,
      budget,
    );
    const bible = (await new FakeDirector().planIdeas('2026-10-18', 1))[0] as Bible;
    const request = {
      treeId: 'tr_x',
      nodeId: 'nd_x',
      pathKey: 'nd_x',
      bible,
      cast: bible.characters,
      history: [],
      choice: null,
      sceneNumber: 1,
      totalScenes: 6,
      sceneSeconds: 8,
    };
    await director.writeScene(request);

    expect(sent).toBe(3);
    expect(repo.getTotal('director_calls')).toBe(3);
    expect(repo.getTotal('input_tokens')).toBe(2700);
    expect(repo.getTotal('output_tokens')).toBe(500);
    expect(repo.listSpend(10).map((row) => [row.status, row.node_id])).toEqual([
      ['ok', 'nd_x'],
      ['ok', 'nd_x'],
      ['error', 'nd_x'],
    ]);

    await expect(director.writeScene(request)).rejects.toBeInstanceOf(BudgetExhausted);
    expect(sent).toBe(3);
  });
});

describe('auto prefetch off', () => {
  it('films nothing until a family chooses, and choosing still works', async () => {
    const { app, services } = await boot({ AUTO_PREFETCH: 'false', WARM_DEPTH: '1' });
    const home = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    const rootId = services.repo.getIdea(home.ideas[0]!.id)!.rootNodeId;
    expect(services.repo.getPresetChildren(rootId)).toHaveLength(0);

    const story = StoryView.parse(
      (await app.inject({ method: 'POST', url: '/v1/stories', headers: { 'x-device-id': DEVICE }, payload: { kind: 'idea', ideaId: home.ideas[0]!.id } })).json(),
    );
    await services.engine.idle();
    expect(services.repo.getPresetChildren(rootId)).toHaveLength(0);

    const root = await scene(app, story.currentNodeId);
    expect(root.choices).toEqual([
      { index: 0, label: root.choices[0]!.label, nodeId: null, ready: false, posterUrl: null, tone: null, sparks: 0, filmed: false },
      { index: 1, label: root.choices[1]!.label, nodeId: null, ready: false, posterUrl: null, tone: null, sparks: 0, filmed: false },
    ]);

    const chosen = ChooseResponse.parse(
      (await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/choose`, headers: { 'x-device-id': DEVICE }, payload: { kind: 'preset', fromNodeId: root.id, index: 1 } })).json(),
    );
    expect((await scene(app, chosen.nextNodeId)).status).toBe('ready');
    const after = await scene(app, root.id);
    expect(after.choices[0]).toMatchObject({ nodeId: null, ready: false });
    expect(after.choices[1]).toMatchObject({ nodeId: chosen.nextNodeId, ready: true });
    await services.engine.idle();
    expect(services.repo.getPresetChildren(chosen.nextNodeId)).toHaveLength(0);

    const custom = ChooseResponse.parse(
      (await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/choose`, headers: { 'x-device-id': DEVICE }, payload: { kind: 'custom', fromNodeId: chosen.nextNodeId, text: 'a kite race' } })).json(),
    );
    await scene(app, custom.nextNodeId);
    await app.inject({ method: 'POST', url: `/v1/nodes/${custom.nextNodeId}/prefetch`, headers: { 'x-device-id': DEVICE }, payload: { index: 0 } });
    expect(services.repo.getPresetChildren(custom.nextNodeId)).toHaveLength(0);

    const warm = await app.inject({ method: 'POST', url: `/v1/admin/ideas/${home.ideas[0]!.id}/warm`, headers: ADMIN });
    expect(warm.statusCode).toBe(409);
  });

  it('leaves scenes prepared before a restart alone until someone chooses them', async () => {
    rig = createRig({ AUTO_PREFETCH: 'false', DAILY_IDEAS: '1', WARM_DEPTH: '0' });
    rig.services.engine.start();
    await rig.services.daily.ensure();
    await rig.services.engine.idle();
    await rig.services.engine.stop(5_000);
    const root = rig.services.repo.getNode(rig.services.repo.listIdeas(rig.services.daily.today())[0]!.rootNodeId)!;
    const orphan = rig.services.repo.getOrCreatePresetChild(root, 0, 0).node;
    expect(rig.services.repo.listWantedPendingIds()).not.toContain(orphan.id);

    const engine = new StoryEngine({
      ...rig.services,
      log: silentLogger,
    });
    engine.start();
    await engine.idle();
    expect(rig.services.repo.getNode(orphan.id)!.status).toBe('pending');
    await engine.stop(5_000);
  });
});

describe('daily planner off', () => {
  it('plans nothing new and keeps every filmed story on Home', async () => {
    class CountingDirector extends FakeDirector {
      plans = 0;
      override async planIdeas(date: string, count: number, avoid: string[] = []) {
        this.plans++;
        return super.planIdeas(date, count, avoid);
      }
    }
    const director = new CountingDirector();
    rig = createRig({ DAILY_PLANNER: 'false', DAILY_IDEAS: '2', IDEA_LIFETIME_DAYS: '1', WARM_DEPTH: '0' }, { director });
    rig.services.engine.start();
    await rig.services.daily.ensure('2026-10-10');
    await rig.services.engine.idle();
    expect(director.plans).toBe(1);

    rig.services.daily.start();
    rig.services.daily.kick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(director.plans).toBe(1);

    const home = rig.services.daily.listForHome();
    expect(home.date).toBe('2026-10-10');
    expect(home.ideas).toHaveLength(2);
    rig.services.daily.stop();
  });
});

describe('admin filming', () => {
  it('films a chosen path, reusing what exists, and reports the cost', async () => {
    const { app, services } = await boot({ AUTO_PREFETCH: 'false' });
    const idea = services.repo.listIdeas(services.daily.today())[0]!;

    expect((await app.inject({ method: 'POST', url: '/v1/admin/film', payload: { ideaId: idea.id, path: [1] } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/admin/film', headers: ADMIN, payload: { ideaId: idea.id, path: [2] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/admin/film', headers: ADMIN, payload: { ideaId: idea.id, path: [0, 0, 0] } })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/admin/film', headers: ADMIN, payload: { ideaId: 'id_0000000000000000', path: [] } })).statusCode,
    ).toBe(404);

    const started = await app.inject({ method: 'POST', url: '/v1/admin/film', headers: ADMIN, payload: { ideaId: idea.id, path: [1, 0] } });
    expect(started.statusCode).toBe(202);
    const done = await job(app, started.json().id);
    expect(done.status).toBe('done');
    expect(done.steps.map((step: { depth: number; choiceIndex: number | null; reused: boolean; status: string }) => [step.depth, step.choiceIndex, step.reused, step.status])).toEqual([
      [0, null, true, 'ready'],
      [1, 1, false, 'ready'],
      [2, 0, false, 'ready'],
    ]);
    expect(done.cost).toMatchObject({ videoSeconds: 2, directorCalls: 2, videoUsd: 0.08 });
    expect(services.repo.getPresetChildren(idea.rootNodeId).map((child) => child.choiceIndex)).toEqual([1]);

    const again = await job(app, (await app.inject({ method: 'POST', url: '/v1/admin/film', headers: ADMIN, payload: { ideaId: idea.id, path: [1], siblings: true } })).json().id);
    expect(again.status).toBe('done');
    expect(again.steps.filter((step: { reused: boolean }) => !step.reused)).toHaveLength(1);
    expect(again.cost).toMatchObject({ videoSeconds: 1, directorCalls: 1 });
    expect(services.repo.getPresetChildren(idea.rootNodeId).map((child) => child.status)).toEqual(['ready', 'ready']);
  });

  it('stops when a cap is reached', async () => {
    const { app, services } = await boot({ AUTO_PREFETCH: 'false', TOTAL_VIDEO_SECONDS_CAP: '2' });
    const idea = services.repo.listIdeas(services.daily.today())[0]!;
    const started = await app.inject({ method: 'POST', url: '/v1/admin/film', headers: ADMIN, payload: { ideaId: idea.id, path: [0, 0] } });
    const done = await job(app, started.json().id);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('cannot be filmed right now');
    expect(done.steps.map((step: { status: string }) => step.status)).toEqual(['ready', 'ready', 'failed']);
    expect(services.repo.getTotal('video_seconds')).toBe(2);
  });
});

describe('filming paused', () => {
  it('asks for Sparks past the free budget, and tells the TV only when nothing can be filmed', async () => {
    const { app, services } = await boot({ AUTO_PREFETCH: 'false', TOTAL_VIDEO_SECONDS_CAP: '2' });
    const headers = { 'x-device-id': DEVICE };
    const home = async () => TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    const wallet = async () => WalletView.parse((await app.inject({ method: 'GET', url: '/v1/wallet', headers })).json());
    expect((await home()).filmingPaused).toBe(false);
    expect((await wallet()).filmingPaused).toBe(false);

    const ideaId = (await home()).ideas[0]!.id;
    const story = StoryView.parse((await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'idea', ideaId } })).json());
    const root = await scene(app, story.currentNodeId);
    const chosen = ChooseResponse.parse(
      (await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/choose`, headers, payload: { kind: 'preset', fromNodeId: root.id, index: 0 } })).json(),
    );
    expect((await scene(app, chosen.nextNodeId)).status).toBe('ready');
    await services.engine.idle();

    expect(services.budget.exhausted()).toBe('total_video');
    expect((await home()).filmingPaused).toBe(false);
    // Free Sparks only spend the free budget, so past it the family buys Sparks.
    expect((await wallet()).freeSparks).toBe(0);
    services.repo.changeWallet(`device:${DEVICE}`, { sparks: 10 });
    const next = await scene(app, chosen.nextNodeId);
    expect(next.choices.every((choice) => choice.sparks > 0)).toBe(true);

    // A choice past the free budget is filmed once the family pays, even past the cap.
    const paid = ChooseResponse.parse(
      (await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/choose`, headers, payload: { kind: 'preset', fromNodeId: next.id, index: 0 } })).json(),
    );
    expect(services.repo.getNode(paid.nextNodeId)!.charge).not.toBeNull();
    expect((await scene(app, paid.nextNodeId)).status).toBe('ready');

    services.filming.markOutOfCredit();
    expect((await home()).filmingPaused).toBe(true);
    expect((await wallet()).filmingPaused).toBe(true);
    const refused = await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'custom', prompt: 'a kite race', audience: 'family', moods: [] } });
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe('budget_exhausted');
  });

  it('stops all filming at the hard cap, paid or not', async () => {
    const { app, services } = await boot({ AUTO_PREFETCH: 'false', TOTAL_VIDEO_SECONDS_CAP: '1', HARD_VIDEO_SECONDS_CAP: '1' });
    const headers = { 'x-device-id': DEVICE };
    const today = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    expect(services.budget.hardExhausted()).toBe(true);
    expect(today.filmingPaused).toBe(true);
    services.wallet.view({ deviceId: DEVICE, userId: null });
    services.repo.changeWallet(`device:${DEVICE}`, { sparks: 10 });
    const refused = await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'custom', prompt: 'a kite race', audience: 'family', moods: [] } });
    expect(refused.json().error.code).toBe('budget_exhausted');
  });

  it('gives Sparks back when the video account turns a paid chapter away for lack of credit', async () => {
    const { app, services, video } = await boot({ AUTO_PREFETCH: 'false' });
    const headers = { 'x-device-id': DEVICE };
    const ideaId = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json()).ideas[0]!.id;
    const story = StoryView.parse((await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'idea', ideaId } })).json());
    const root = await scene(app, story.currentNodeId);
    const before = WalletView.parse((await app.inject({ method: 'GET', url: '/v1/wallet', headers })).json());
    video.failWith = new VideoOutOfCredit('fal account is out of credit: User is locked. Reason: Exhausted balance.');
    const chosen = ChooseResponse.parse(
      (await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/choose`, headers, payload: { kind: 'custom', fromNodeId: root.id, text: 'a kite race' } })).json(),
    );
    const failed = await scene(app, chosen.nextNodeId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('nothing was charged');
    const after = WalletView.parse((await app.inject({ method: 'GET', url: '/v1/wallet', headers })).json());
    expect(after.freeSparks + after.sparks).toBe(before.freeSparks + before.sparks);
    expect(services.filming.available()).toBe(false);
  });
});

describe('filming a scene again', () => {
  it('swaps in a new take and refuses once a later scene used the old last frame', async () => {
    const { app, services } = await boot({ AUTO_PREFETCH: 'false' });
    const idea = services.repo.listIdeas(services.daily.today())[0]!;
    const before = services.repo.getNode(idea.rootNodeId)!;
    const oldClip = services.store.absolute(before.clipPath!);

    const started = await app.inject({ method: 'POST', url: `/v1/admin/nodes/${before.id}/redo`, headers: ADMIN });
    expect(started.statusCode).toBe(202);
    const done = await job(app, started.json().id);
    expect(done).toMatchObject({ kind: 'redo', status: 'done', cost: { videoSeconds: 1, directorCalls: 0 } });
    const after = services.repo.getNode(before.id)!;
    expect(after.clipPath).not.toBe(before.clipPath);
    expect(after.lastFramePath).not.toBe(before.lastFramePath);
    expect(after.videoPrompt).toBe(before.videoPrompt);
    // Every paid take is kept.
    expect(existsSync(oldClip)).toBe(true);
    expect(existsSync(services.store.absolute(after.clipPath!))).toBe(true);
    expect(services.repo.getTotal('video_seconds')).toBe(2);

    await job(app, (await app.inject({ method: 'POST', url: '/v1/admin/film', headers: ADMIN, payload: { ideaId: idea.id, path: [0] } })).json().id);
    const refused = await app.inject({ method: 'POST', url: `/v1/admin/nodes/${before.id}/redo`, headers: ADMIN });
    expect(refused.statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/v1/admin/nodes/nd_0000000000000000/redo', headers: ADMIN })).statusCode).toBe(404);
  });
});

describe('chapter budget', () => {
  it('pauses filming unless a whole chapter fits under the cap', async () => {
    const { services } = await boot({ DAILY_IDEAS: '0', CLIPS_PER_CHAPTER: '3', TOTAL_VIDEO_SECONDS_CAP: '5' });
    const { budget } = services;
    expect(budget.exhausted()).toBeNull();
    budget.settleVideo(budget.reserveVideo(3, { task: 'scene', nodeId: 'nd_a' }), 3, 'ok');
    // Two seconds are left, enough for one more clip but not a three clip chapter.
    expect(budget.exhausted()).toBe('total_video');
    expect(() => budget.reserveVideo(1, { task: 'scene', nodeId: 'nd_b' })).not.toThrow();
  });
});

describe('spend report', () => {
  it('adds up seconds, calls and tokens into dollars and what is left', async () => {
    const { app, services } = await boot({ DAILY_IDEAS: '0', TOTAL_VIDEO_SECONDS_CAP: '100', DIRECTOR_CALL_CAP: '10' });
    const { budget } = services;
    budget.beginCall({ task: 'scene', nodeId: 'nd_a' });
    budget.endCall({ task: 'scene', nodeId: 'nd_a' }, { inputTokens: 1_000_000, outputTokens: 500_000, ms: 900, ok: true });
    const reservation = budget.reserveVideo(10, { task: 'scene', nodeId: 'nd_a' });
    budget.settleVideo(reservation, 10, 'ok');

    const spend = (await app.inject({ method: 'GET', url: '/v1/admin/spend', headers: ADMIN })).json();
    expect(spend.lifetime).toEqual({
      videoSeconds: 10,
      directorCalls: 1,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      videoUsd: 0.4,
      directorUsd: 15.4,
      totalUsd: 15.8,
    });
    expect(spend.today).toMatchObject({ videoSeconds: 10, directorCalls: 1, totalUsd: 15.8 });
    expect(spend.caps).toMatchObject({
      totalVideoSeconds: 100,
      totalVideoSecondsLeft: 90,
      directorCalls: 10,
      directorCallsLeft: 9,
      exhausted: null,
    });
    expect(spend.recent.map((row: { kind: string }) => row.kind)).toEqual(['video', 'director']);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/spend' })).statusCode).toBe(401);
  });
});
