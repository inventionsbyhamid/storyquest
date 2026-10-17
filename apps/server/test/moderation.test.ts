import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChooseResponse,
  ErrorResponse,
  FinishResponse,
  ReportResponse,
  SceneView,
  ShareView,
  StoryView,
  TodayResponse,
} from '@storyquest/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/http/app';
import type { Services } from '../src/services';
import { hasDash } from '../src/text';
import { DEVICE, OTHER_DEVICE, testConfig, visibleText } from './helpers';

const ADMIN = { authorization: 'Bearer moderation_admin_token' };
let current: { app: FastifyInstance; services: Services; dir: string } | null = null;

afterEach(async () => {
  if (!current) return;
  await current.services.engine.stop(15_000);
  await current.app.close();
  current.services.db.close();
  rmSync(current.dir, { recursive: true, force: true });
  current = null;
});

async function boot(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-moderation-'));
  const config = testConfig(dir, {
    DAILY_IDEAS: '1',
    WARM_DEPTH: '1',
    SCENES_PER_STORY: '3',
    ADMIN_TOKEN: 'moderation_admin_token',
    ...env,
  });
  const { app, services } = await createServer(config);
  services.engine.start();
  await services.daily.ensure();
  await services.engine.idle();
  current = { app, services, dir };
  return { app, services };
}

async function scene(app: FastifyInstance, id: string) {
  for (let i = 0; i < 20; i++) {
    const view = SceneView.parse((await app.inject({ method: 'GET', url: `/v1/nodes/${id}?wait=5` })).json());
    if (view.status === 'ready' || view.status === 'failed') return view;
  }
  throw new Error('scene never settled');
}

async function startStory(app: FastifyInstance, device = DEVICE) {
  const home = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
  const res = await app.inject({
    method: 'POST',
    url: '/v1/stories',
    headers: { 'x-device-id': device },
    payload: { kind: 'idea', ideaId: home.ideas[0]!.id },
  });
  const story = StoryView.parse(res.json());
  await scene(app, story.currentNodeId);
  return story;
}

function choose(app: FastifyInstance, storyId: string, payload: object, device = DEVICE) {
  return app.inject({ method: 'POST', url: `/v1/stories/${storyId}/choose`, headers: { 'x-device-id': device }, payload });
}

function report(app: FastifyInstance, nodeId: string, body: object = { reason: 'scary' }, device = OTHER_DEVICE) {
  return app.inject({ method: 'POST', url: `/v1/nodes/${nodeId}/report`, headers: { 'x-device-id': device }, payload: body });
}

describe('reporting a scene', () => {
  it('validates the request and counts one report per device per scene', async () => {
    const { app, services } = await boot();
    const story = await startStory(app);
    const root = story.currentNodeId;

    expect((await app.inject({ method: 'POST', url: `/v1/nodes/${root}/report`, payload: { reason: 'scary' } })).statusCode).toBe(400);
    expect((await report(app, root, { reason: 'boring' })).statusCode).toBe(400);
    expect((await report(app, 'nd_0000000000000000')).statusCode).toBe(404);

    const first = await report(app, root, { reason: 'scary', storyId: story.id });
    expect(first.statusCode).toBe(200);
    expect(ReportResponse.parse(first.json())).toEqual({ ok: true });
    expect((await report(app, root, { reason: 'other' })).statusCode).toBe(200);
    await report(app, root, { reason: 'broken' }, DEVICE);

    const rows = services.db.prepare('SELECT device_id, reason, story_id FROM reports ORDER BY id').all();
    expect(rows).toEqual([
      { device_id: OTHER_DEVICE, reason: 'scary', story_id: story.id },
      { device_id: DEVICE, reason: 'broken', story_id: null },
    ]);
  });

  it('allows ten reports an hour per device', async () => {
    const { app } = await boot();
    const story = await startStory(app);
    for (let i = 0; i < 10; i++) expect((await report(app, story.currentNodeId)).statusCode).toBe(200);
    const limited = await report(app, story.currentNodeId);
    expect(limited.statusCode).toBe(429);
    expect(ErrorResponse.parse(limited.json()).error.code).toBe('rate_limited');
    expect((await report(app, story.currentNodeId, { reason: 'scary' }, DEVICE)).statusCode).toBe(200);
  });
});

describe('a reported shared scene', () => {
  it('closes that path for everyone straight away', async () => {
    const { app, services } = await boot();
    const story = await startStory(app);
    const root = await scene(app, story.currentNodeId);
    const closed = root.choices[0]!.nodeId!;
    expect(root.choices[0]!.ready).toBe(true);

    await report(app, closed, { reason: 'inappropriate' });

    const after = await scene(app, root.id);
    expect(after.choices[0]).toMatchObject({ nodeId: closed, ready: false, posterUrl: null });
    expect(after.choices[1]!.ready).toBe(true);

    const res = await choose(app, story.id, { kind: 'preset', fromNodeId: root.id, index: 0 });
    expect(res.statusCode).toBe(409);
    const error = ErrorResponse.parse(res.json()).error;
    expect(error).toMatchObject({ code: 'not_found', message: expect.stringContaining('That path is closed') });
    expect(hasDash(error.message)).toBe(false);

    const removed = await scene(app, closed);
    expect(removed).toMatchObject({ status: 'failed', clipUrl: null, choices: [] });
    expect(removed.error).toContain('This scene was removed');

    await services.engine.idle();
    expect(services.repo.getPresetChildren(closed)).toHaveLength(0);
    expect(services.repo.getNode(closed)!.status).toBe('ready');
  });

  it('lets a family that is on the removed scene choose again from the scene before', async () => {
    const { app } = await boot();
    const story = await startStory(app);
    const root = await scene(app, story.currentNodeId);
    const onIt = ChooseResponse.parse((await choose(app, story.id, { kind: 'preset', fromNodeId: root.id, index: 0 })).json());
    await scene(app, onIt.nextNodeId);

    await report(app, onIt.nextNodeId);
    expect((await choose(app, story.id, { kind: 'preset', fromNodeId: onIt.nextNodeId, index: 0 })).statusCode).toBe(409);
    const again = ChooseResponse.parse((await choose(app, story.id, { kind: 'preset', fromNodeId: root.id, index: 1 })).json());
    expect(again.story.path).toEqual([root.id, root.choices[1]!.nodeId]);
  });

  it('takes a whole story off Home when its opening is reported', async () => {
    const { app } = await boot();
    const story = await startStory(app);
    await report(app, story.currentNodeId);

    const home = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    expect(home.ideas).toHaveLength(0);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stories',
      headers: { 'x-device-id': DEVICE },
      payload: { kind: 'idea', ideaId: story.ideaId },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('a reported private scene', () => {
  it('only changes the story it belongs to', async () => {
    const { app, services } = await boot();
    const story = await startStory(app);
    const custom = ChooseResponse.parse(
      (await choose(app, story.id, { kind: 'custom', fromNodeId: story.currentNodeId, text: 'a rainbow bridge' })).json(),
    );
    await scene(app, custom.nextNodeId);
    await report(app, custom.nextNodeId, { reason: 'other', storyId: story.id }, DEVICE);

    expect((await scene(app, custom.nextNodeId)).status).toBe('failed');
    const other = await startStory(app, OTHER_DEVICE);
    const root = await scene(app, other.currentNodeId);
    expect(root.choices.every((choice) => choice.ready)).toBe(true);
    expect(services.repo.getNode(custom.nextNodeId)!.ownerStoryId).toBe(story.id);
  });
});

describe('share pages', () => {
  async function finishedStory(env: Record<string, string> = {}) {
    const booted = await boot(env);
    const { app, services } = booted;
    const story = await startStory(app);
    let from = story.currentNodeId;
    for (let i = 0; i < 2; i++) {
      from = ChooseResponse.parse((await choose(app, story.id, { kind: 'preset', fromNodeId: from, index: 0 })).json()).nextNodeId;
      await scene(app, from);
    }
    const finish = FinishResponse.parse(
      (await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/finish`, headers: { 'x-device-id': DEVICE } })).json(),
    );
    await services.engine.idle();
    const path = services.repo.getStory(story.id)!.path;
    return { ...booted, story, slug: finish.shareSlug, path };
  }

  it('shows a removed scene as its caption only, and drops the movie', async () => {
    const { app, services, slug, path } = await finishedStory({ SUPPORT_EMAIL: 'help@example.com' });
    expect(ShareView.parse((await app.inject({ method: 'GET', url: `/v1/share/${slug}` })).json()).movieStatus).toBe('ready');

    const middle = services.repo.getNode(path[1]!)!;
    await report(app, middle.id);

    const share = ShareView.parse((await app.inject({ method: 'GET', url: `/v1/share/${slug}` })).json());
    expect(share).toMatchObject({ movieStatus: 'failed', movieUrl: null });
    expect(share.scenes).toHaveLength(3);
    expect(share.scenes[1]).toMatchObject({ removed: true, clipUrl: '', posterUrl: null, caption: middle.caption });
    expect(share.scenes[0]!.removed).toBeUndefined();

    const page = await app.inject({ method: 'GET', url: `/s/${slug}` });
    expect(page.body).not.toContain(middle.posterPath!);
    expect(page.body).not.toContain(middle.clipPath!);
    const text = visibleText(page.body);
    expect(text).toContain('This scene was removed.');
    expect(text).toContain('Some scenes of this story were removed');
    expect(text).toContain('To report this story, contact');
    expect(page.body).toContain(`<a href="mailto:help@example.com?subject=Report%20story%20${slug}">Report this story</a>`);
    expect(hasDash(text)).toBe(false);
  });

  it('has no report link without a support email', async () => {
    const { app, slug } = await finishedStory();
    const text = visibleText((await app.inject({ method: 'GET', url: `/s/${slug}` })).body);
    expect(text).not.toContain('Report this story');
    expect(text).not.toContain('To report this story');
  });
});

describe('admin moderation', () => {
  it('lists reports, restores a scene and deletes one for good', async () => {
    const { app, services } = await boot();
    const story = await startStory(app);
    const root = await scene(app, story.currentNodeId);
    const target = root.choices[0]!.nodeId!;
    await report(app, target, { reason: 'scary' });
    await report(app, target, { reason: 'broken' }, DEVICE);

    expect((await app.inject({ method: 'GET', url: '/v1/admin/reports' })).statusCode).toBe(401);
    const list = (await app.inject({ method: 'GET', url: '/v1/admin/reports', headers: ADMIN })).json();
    const node = services.repo.getNode(target)!;
    expect(list.reports).toHaveLength(1);
    expect(list.reports[0]).toMatchObject({
      nodeId: target,
      shared: true,
      caption: node.caption,
      videoPrompt: node.videoPrompt,
      reports: 2,
      reasons: { scary: 1, broken: 1, inappropriate: 0, other: 0 },
      hidden: true,
      createdAt: node.createdAt,
    });
    expect(list.reports[0].firstReportedAt).toBeTruthy();

    const restored = await app.inject({ method: 'POST', url: `/v1/admin/nodes/${target}/restore`, headers: ADMIN });
    expect(restored.json()).toMatchObject({ nodeId: target, hidden: false });
    expect((await scene(app, root.id)).choices[0]!.ready).toBe(true);

    const files = [node.clipPath!, node.posterPath!, node.lastFramePath!].map((file) => services.store.absolute(file));
    expect(files.every((file) => existsSync(file))).toBe(true);
    const deleted = await app.inject({ method: 'DELETE', url: `/v1/admin/nodes/${target}`, headers: ADMIN });
    expect(deleted.json()).toMatchObject({ nodeId: target, hidden: true, deletedAt: expect.any(String) });
    expect(files.some((file) => existsSync(file))).toBe(false);
    expect((await scene(app, root.id)).choices[0]!.ready).toBe(false);

    const again = await app.inject({ method: 'POST', url: `/v1/admin/nodes/${target}/restore`, headers: ADMIN });
    expect(again.statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: '/v1/admin/nodes/nd_0000000000000000', headers: ADMIN })).statusCode).toBe(404);
  });

  it('removes stitched movies that contain a deleted scene', async () => {
    const { app, services } = await boot({ SCENES_PER_STORY: '2' });
    const story = await startStory(app);
    const next = ChooseResponse.parse((await choose(app, story.id, { kind: 'preset', fromNodeId: story.currentNodeId, index: 0 })).json());
    await scene(app, next.nextNodeId);
    await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/finish`, headers: { 'x-device-id': DEVICE } });
    await services.engine.idle();
    const movie = services.store.absolute(services.repo.getStory(story.id)!.moviePath!);
    expect(existsSync(movie)).toBe(true);

    await app.inject({ method: 'DELETE', url: `/v1/admin/nodes/${next.nextNodeId}`, headers: ADMIN });
    expect(existsSync(movie)).toBe(false);
    expect(services.repo.getStory(story.id)).toMatchObject({ movieStatus: 'failed', moviePath: null });
  });
});
