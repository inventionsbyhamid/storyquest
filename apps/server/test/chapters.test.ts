import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChooseResponse,
  SceneView,
  ShareView,
  StoryListResponse,
  StoryView,
  TodayResponse,
  WalletView,
} from '@storyquest/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/http/app';
import { Media } from '../src/media';
import { FakeVideo } from '../src/providers/video/fake';
import type { Services } from '../src/services';
import { DEVICE, OTHER_DEVICE, SpyVideo, testConfig } from './helpers';

const ADMIN = { authorization: 'Bearer chapter_admin_token' };
const headers = { 'x-device-id': DEVICE };

let server: { app: FastifyInstance; services: Services; dir: string } | null = null;

afterEach(async () => {
  if (!server) return;
  await server.services.engine.stop(15_000);
  await server.app.close();
  server.services.db.close();
  rmSync(server.dir, { recursive: true, force: true });
  server = null;
});

async function boot(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-chapters-'));
  const config = testConfig(dir, {
    DAILY_IDEAS: '1',
    WARM_DEPTH: '0',
    AUTO_PREFETCH: 'false',
    CLIPS_PER_CHAPTER: '3',
    SCENES_PER_STORY: '2',
    SCENE_COST_SPARKS: '3',
    WELCOME_FREE_SPARKS: '3',
    DAILY_FREE_SPARKS: '0',
    ADMIN_TOKEN: 'chapter_admin_token',
    ...env,
  });
  const video = new SpyVideo(
    new FakeVideo(new Media(), {
      width: config.fakeVideoWidth,
      height: config.fakeVideoHeight,
      delayMs: 0,
      fontFile: config.FONT_FILE,
    }),
  );
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

async function choose(app: FastifyInstance, storyId: string, body: object) {
  const res = await app.inject({ method: 'POST', url: `/v1/stories/${storyId}/choose`, headers, payload: body });
  expect(res.statusCode).toBe(200);
  return ChooseResponse.parse(res.json());
}

async function start(app: FastifyInstance) {
  const today = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
  const res = await app.inject({
    method: 'POST',
    url: '/v1/stories',
    headers,
    payload: { kind: 'idea', ideaId: today.ideas[0]!.id },
  });
  return StoryView.parse(res.json());
}

describe('chapters', () => {
  it('plays a chapter as continuous clips and asks only at its end', async () => {
    const { app, services, video } = await boot();
    const story = await start(app);

    const first = await scene(app, story.currentNodeId);
    expect(first.continues).toBe(true);
    expect(first.choices).toHaveLength(1);
    expect(first.choices[0]!.sparks).toBe(0);

    // A family is on the chapter, so its next clips are filmed back to back without asking.
    await services.engine.idle();
    let next = await choose(app, story.id, { kind: 'preset', fromNodeId: first.id, index: 0 });
    const second = await scene(app, next.nextNodeId);
    expect(second.continues).toBe(true);
    expect(second.sceneNumber).toBe(1);
    next = await choose(app, story.id, { kind: 'preset', fromNodeId: second.id, index: 0 });
    const third = await scene(app, next.nextNodeId);
    expect(third.continues).toBe(false);
    expect(third.choices).toHaveLength(2);
    expect(third.sceneNumber).toBe(1);

    // One director call wrote the whole chapter; each clip starts from the one before.
    expect(video.calls).toHaveLength(3);
    expect(video.calls[1]!.startFramePath).toBeTruthy();
    expect(video.calls[0]!.prompt).not.toBe(video.calls[1]!.prompt);
    const chapterCalls = services.repo.listSpend(50).filter((row) => row.kind === 'director' && row.task === 'scene');
    expect(chapterCalls).toHaveLength(1);
  });

  it('charges a private chapter once and films only the first clip of a preview', async () => {
    const { app, services } = await boot();
    const story = await start(app);
    let current = await scene(app, story.currentNodeId);
    while (current.continues) {
      await services.engine.idle();
      current = await scene(
        app,
        (await choose(app, story.id, { kind: 'preset', fromNodeId: current.id, index: 0 })).nextNodeId,
      );
    }

    const custom = await choose(app, story.id, {
      kind: 'custom',
      fromNodeId: current.id,
      text: 'the fox learns to whistle',
    });
    let last = await scene(app, custom.nextNodeId);
    expect(last.sceneNumber).toBe(2);
    while (last.continues) {
      await services.engine.idle();
      last = await scene(
        app,
        (await choose(app, story.id, { kind: 'preset', fromNodeId: last.id, index: 0 })).nextNodeId,
      );
    }
    expect(last.isEnding).toBe(true);
    const wallet = WalletView.parse((await app.inject({ method: 'GET', url: '/v1/wallet', headers })).json());
    expect(wallet.freeSparks).toBe(0);
    expect(wallet.sparks).toBe(0);

    // An admin preview of the other choice films one clip, not the chapter.
    const idea = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json()).ideas[0]!;
    const started = await app.inject({
      method: 'POST',
      url: '/v1/admin/film',
      headers: ADMIN,
      payload: { ideaId: idea.id, path: [0], siblings: true },
    });
    expect(started.statusCode).toBe(202);
    for (
      let i = 0;
      i < 200 &&
      (await app.inject({ method: 'GET', url: `/v1/admin/film/${started.json().id}`, headers: ADMIN })).json()
        .status === 'running';
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await services.engine.idle();
    const sibling = services.repo.getPresetChildren(current.id).find((child) => child.choiceIndex === 1)!;
    expect(sibling.status).toBe('ready');
    expect(services.repo.getPresetChildren(sibling.id)).toHaveLength(0);

    // With filming paused, a choice whose chapter is only partly filmed is shown as not filmed.
    services.config.TOTAL_VIDEO_SECONDS_CAP = 1;
    const choicePoint = await scene(app, current.id);
    expect(choicePoint.choices[1]!.nodeId).toBeNull();
    expect(choicePoint.choices[0]!.nodeId).not.toBeNull();
  });

  it('lists a TV story for Continue watching and marks chapter starts when shared', async () => {
    const { app, services } = await boot();
    const story = await start(app);
    let current = await scene(app, story.currentNodeId);
    while (current.continues) {
      await services.engine.idle();
      current = await scene(
        app,
        (await choose(app, story.id, { kind: 'preset', fromNodeId: current.id, index: 0 })).nextNodeId,
      );
    }

    const list = StoryListResponse.parse((await app.inject({ method: 'GET', url: '/v1/stories', headers })).json());
    expect(list.stories).toHaveLength(1);
    expect(list.stories[0]).toMatchObject({ id: story.id, status: 'active', chapter: 1, totalChapters: 2 });
    expect(list.stories[0]!.posterUrl).toMatch(/poster/);
    const others = StoryListResponse.parse(
      (await app.inject({ method: 'GET', url: '/v1/stories', headers: { 'x-device-id': OTHER_DEVICE } })).json(),
    );
    expect(others.stories).toHaveLength(0);

    let last = await scene(
      app,
      (await choose(app, story.id, { kind: 'preset', fromNodeId: current.id, index: 0 })).nextNodeId,
    );
    while (last.continues) {
      await services.engine.idle();
      last = await scene(
        app,
        (await choose(app, story.id, { kind: 'preset', fromNodeId: last.id, index: 0 })).nextNodeId,
      );
    }
    const finished = await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/finish`, headers });
    expect(finished.statusCode).toBe(200);
    let share = ShareView.parse(
      (await app.inject({ method: 'GET', url: `/v1/share/${finished.json().shareSlug}` })).json(),
    );
    for (let i = 0; i < 200 && share.movieStatus === 'pending'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      share = ShareView.parse(
        (await app.inject({ method: 'GET', url: `/v1/share/${finished.json().shareSlug}` })).json(),
      );
    }
    expect(share.movieStatus).toBe('ready');
    expect(share.scenes).toHaveLength(6);
    expect(share.scenes.map((s) => s.chapterStart)).toEqual([true, false, false, true, false, false]);
    expect(share.scenes[3]!.choiceTaken).toBeTruthy();
    expect(share.scenes[1]!.choiceTaken).toBeNull();
    expect(share.stats.choices).toHaveLength(1);
  });

  it('keeps only the latest story of each idea in Continue watching', async () => {
    const { app, services } = await boot();
    const first = await start(app);
    await services.engine.idle();
    const second = await start(app);
    await services.engine.idle();
    const list = StoryListResponse.parse((await app.inject({ method: 'GET', url: '/v1/stories', headers })).json());
    expect(list.stories.map((story) => story.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
  });

  it('lets an admin add a chosen story plan and take stories off Home', async () => {
    const { app, services } = await boot();
    const drafted = await app.inject({ method: 'POST', url: '/v1/admin/plans', headers: ADMIN, payload: { count: 1 } });
    expect(drafted.statusCode).toBe(200);
    const [plan] = drafted.json().plans;
    expect(plan.title).toBeTruthy();

    const outline = ['Mia finds a door in the garden wall.', 'Mia and Biscuit cross the moon meadow.'];
    const added = await app.inject({
      method: 'POST',
      url: '/v1/admin/ideas',
      headers: ADMIN,
      payload: { plan: { ...plan, title: 'The Moon Door', outline } },
    });
    expect(added.statusCode).toBe(201);
    const ideaId = added.json().idea.id;
    await services.engine.idle();
    let today = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    expect(today.ideas.map((idea) => idea.title)).toContain('The Moon Door');
    expect(services.repo.getTree(services.repo.getIdea(ideaId)!.treeId)!.bible!.outline).toEqual(outline);

    const others = today.ideas.filter((idea) => idea.id !== ideaId);
    for (const idea of others) {
      expect(
        (await app.inject({ method: 'POST', url: `/v1/admin/ideas/${idea.id}/unlist`, headers: ADMIN })).statusCode,
      ).toBe(200);
    }
    today = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    expect(today.ideas.map((idea) => idea.id)).toEqual([ideaId]);
    const missingOutline = await app.inject({
      method: 'POST',
      url: '/v1/admin/ideas',
      headers: ADMIN,
      payload: { plan: { ...plan, outline: undefined } },
    });
    expect(missingOutline.statusCode).toBe(400);
  });
});
