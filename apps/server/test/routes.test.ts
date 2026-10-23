import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChooseResponse,
  ErrorResponse,
  FinishResponse,
  SceneView,
  ShareView,
  StoryView,
  TodayResponse,
} from '@storyquest/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/http/app';
import { choicePhrase } from '../src/http/share-page';
import type { Services } from '../src/services';
import { hasDash } from '../src/text';
import { DEVICE, testConfig, visibleText } from './helpers';

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
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-routes-'));
  const { app, services } = await createServer(testConfig(dir, { DAILY_IDEAS: '1', ...env }));
  services.engine.start();
  await services.daily.ensure();
  current = { app, services, dir };
  return current;
}

const headers = { 'x-device-id': DEVICE };

async function node(app: FastifyInstance, id: string) {
  for (let i = 0; i < 20; i++) {
    const res = await app.inject({ method: 'GET', url: `/v1/nodes/${id}?wait=5` });
    expect(res.statusCode).toBe(200);
    const scene = SceneView.parse(res.json());
    if (scene.status === 'ready' || scene.status === 'failed') return scene;
  }
  throw new Error('scene never settled');
}

describe('share page copy', () => {
  it('phrases choice stats without dashes', () => {
    const phrases = [
      choicePhrase({ sceneNumber: 1, label: 'x', percent: 8, custom: false }),
      choicePhrase({ sceneNumber: 1, label: 'x', percent: 45, custom: false }),
      choicePhrase({ sceneNumber: 1, label: 'x', percent: 80, custom: false }),
      choicePhrase({ sceneNumber: 1, label: 'x', percent: 100, custom: false }),
      choicePhrase({ sceneNumber: 1, label: 'x', percent: 0, custom: true }),
    ];
    expect(phrases).toEqual([
      'Only 8% of families chose this',
      '45% of families chose this',
      '80% of families chose this too',
      'Every family so far chose this',
      'An idea all their own',
    ]);
  });
});

describe('HTTP API', () => {
  it('reports health', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, director: 'fake', safety: 'wordlist' });
  });

  it('plays a story end to end over HTTP and serves a share page', async () => {
    const { app, services } = await boot();

    const today = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    expect(today.ideas).toHaveLength(1);
    const idea = today.ideas[0]!;

    const started = await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'idea', ideaId: idea.id } });
    expect(started.statusCode).toBe(200);
    let story = StoryView.parse(started.json());
    expect(story).toMatchObject({ ideaId: idea.id, status: 'active', shareSlug: null });

    for (;;) {
      const scene = await node(app, story.currentNodeId);
      expect(scene.status).toBe('ready');
      expect(scene.clipUrl).toMatch(/^http:\/\/tv\.test\/media\/nodes\//);
      // Stand in clips are flat colored inks, so their night is never the plain app night.
      expect(scene.tone).toMatch(/^#[0-9A-F]{6}$/);
      expect(scene.tone).not.toBe('#1C2240');
      expect(scene.endTone).toMatch(/^#[0-9A-F]{6}$/);
      expect(scene.sceneNumber).toBe(scene.depth + 1);
      expect(scene.totalScenes).toBe(6);
      expect(scene.generationMs).toBeGreaterThan(0);
      if (scene.isEnding) {
        expect(scene.choices).toEqual([]);
        break;
      }
      expect(scene.choices).toHaveLength(2);
      const chosen = await app.inject({
        method: 'POST',
        url: `/v1/stories/${story.id}/choose`,
        headers,
        payload: { kind: 'preset', fromNodeId: scene.id, index: 1 },
      });
      expect(chosen.statusCode).toBe(200);
      const body = ChooseResponse.parse(chosen.json());
      expect(body.story.currentNodeId).toBe(body.nextNodeId);
      story = body.story;
    }

    const fetched = StoryView.parse((await app.inject({ method: 'GET', url: `/v1/stories/${story.id}` })).json());
    expect(fetched.path).toHaveLength(6);

    const finished = await app.inject({
      method: 'POST',
      url: `/v1/stories/${story.id}/finish`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '',
    });
    expect(finished.statusCode).toBe(200);
    const finish = FinishResponse.parse(finished.json());
    expect(finish.shareUrl).toBe(`http://tv.test/s/${finish.shareSlug}`);
    expect(finish.stats.choices).toHaveLength(5);

    await services.engine.idle();
    const share = ShareView.parse((await app.inject({ method: 'GET', url: `/v1/share/${finish.shareSlug}` })).json());
    expect(share.movieStatus).toBe('ready');
    expect(share.movieUrl).toMatch(/\/media\/movies\//);
    expect(share.scenes).toHaveLength(6);
    expect(share.scenes[0]!.choiceTaken).toBeNull();
    expect(share.scenes[1]!.choiceTaken).toBeTruthy();

    const page = await app.inject({ method: 'GET', url: `/s/${finish.shareSlug}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('<meta property="og:image"');
    expect(page.body).toContain(`--ink:${share.scenes[0]!.tone}`);
    expect(page.body).toContain(share.title.replace(/'/g, '&#39;'));
    const text = visibleText(page.body);
    expect(text).toContain('Made with');
    expect(text).toContain('Every family so far chose this');
    expect(hasDash(text)).toBe(false);

    const media = await app.inject({
      method: 'GET',
      url: new URL(share.scenes[0]!.clipUrl).pathname,
      headers: { range: 'bytes=0-99' },
    });
    expect(media.statusCode).toBe(206);
    expect(media.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(media.rawPayload.length).toBe(100);
  });

  it('requires a device id to start a story', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'POST', url: '/v1/stories', payload: { kind: 'idea', ideaId: 'id_x' } });
    expect(res.statusCode).toBe(400);
    const body = ErrorResponse.parse(res.json());
    expect(body.error.code).toBe('bad_request');
    expect(hasDash(body.error.message)).toBe(false);
  });

  it('validates bodies and answers in the error shape', async () => {
    const { app } = await boot();
    const bad = await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'nope' } });
    expect(bad.statusCode).toBe(400);
    expect(ErrorResponse.parse(bad.json()).error.code).toBe('bad_request');

    const broken = await app.inject({
      method: 'POST',
      url: '/v1/stories',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(broken.statusCode).toBe(400);

    const missing = await app.inject({ method: 'GET', url: '/v1/nodes/nd_0000000000000000' });
    expect(missing.statusCode).toBe(404);
    expect(ErrorResponse.parse(missing.json()).error.code).toBe('not_found');

    const unknown = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(ErrorResponse.parse(unknown.json()).error.code).toBe('not_found');

    const page = await app.inject({ method: 'GET', url: '/s/zzzzzzzz' });
    expect(page.statusCode).toBe(404);
    expect(hasDash(visibleText(page.body))).toBe(false);
  });

  it('rejects unsafe custom text with 422 and stale choices with 409', async () => {
    const { app, services } = await boot();
    const idea = services.repo.listIdeas(services.daily.today())[0]!;
    const story = StoryView.parse(
      (await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'idea', ideaId: idea.id } })).json(),
    );
    const root = await node(app, story.currentNodeId);

    const unsafe = await app.inject({
      method: 'POST',
      url: `/v1/stories/${story.id}/choose`,
      headers,
      payload: { kind: 'custom', fromNodeId: root.id, text: 'lots of gore everywhere' },
    });
    expect(unsafe.statusCode).toBe(422);
    const error = ErrorResponse.parse(unsafe.json()).error;
    expect(error.code).toBe('unsafe_input');
    expect(hasDash(error.message)).toBe(false);

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/stories/${story.id}/choose`,
      headers,
      payload: { kind: 'preset', fromNodeId: 'nd_0000000000000000', index: 0 },
    });
    expect(stale.statusCode).toBe(409);

    const early = await app.inject({ method: 'POST', url: `/v1/stories/${story.id}/finish`, headers });
    expect(early.statusCode).toBe(409);
    expect(ErrorResponse.parse(early.json()).error.code).toBe('not_ready');
  });

  it('long polls a scene until it is ready', async () => {
    const { app } = await boot({ WARM_DEPTH: '0' });
    const today = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
    const story = StoryView.parse(
      (await app.inject({ method: 'POST', url: '/v1/stories', headers, payload: { kind: 'idea', ideaId: today.ideas[0]!.id } })).json(),
    );
    const root = await node(app, story.currentNodeId);
    const chosen = ChooseResponse.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/stories/${story.id}/choose`,
          headers,
          payload: { kind: 'custom', fromNodeId: root.id, text: 'everyone starts dancing' },
        })
      ).json(),
    );
    const res = await app.inject({ method: 'GET', url: `/v1/nodes/${chosen.nextNodeId}?wait=15` });
    const scene = SceneView.parse(res.json());
    expect(scene.status).toBe('ready');
    expect(scene.clipUrl).not.toBeNull();

    const parent = SceneView.parse((await app.inject({ method: 'GET', url: `/v1/nodes/${root.id}` })).json());
    expect(parent.choices.every((choice) => choice.nodeId !== null)).toBe(true);
  });

  it('keeps admin routes off without a token and checks the token when set', async () => {
    const off = await boot();
    expect((await off.app.inject({ method: 'GET', url: '/v1/admin/stats' })).statusCode).toBe(404);
    await off.services.engine.stop(15_000);
    await off.app.close();
    off.services.db.close();
    rmSync(off.dir, { recursive: true, force: true });
    current = null;

    const { app } = await boot({ ADMIN_TOKEN: 'a_long_enough_admin_token' });
    expect((await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const stats = await app.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization: 'Bearer a_long_enough_admin_token' },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({ ideasToday: 1, videoSecondsCap: 900 });
    const daily = await app.inject({
      method: 'POST',
      url: '/v1/admin/daily',
      headers: { authorization: 'Bearer a_long_enough_admin_token' },
    });
    expect(daily.statusCode).toBe(200);
    expect(daily.json()).toMatchObject({ created: 0 });
  });
});

describe('rate limits', () => {
  it('counts each visitor behind Cloudflare on their own', async () => {
    const { app } = await boot();
    const edge = '172.70.108.121';
    const get = (ip: string, remoteAddress = edge) =>
      app.inject({ method: 'GET', url: '/v1/today', remoteAddress, headers: { 'cf-connecting-ip': ip } });

    for (let i = 0; i < 300; i++) expect((await get('203.0.113.7')).statusCode).toBe(200);
    const limited = await get('203.0.113.7');
    expect(limited.statusCode).toBe(429);
    expect(ErrorResponse.parse(limited.json()).error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    expect((await get('198.51.100.9')).statusCode).toBe(200);
    // Straight to the server the header is ignored, so it cannot dodge the limit.
    expect((await get('198.51.100.10', '203.0.113.7')).statusCode).toBe(429);
  });
});
