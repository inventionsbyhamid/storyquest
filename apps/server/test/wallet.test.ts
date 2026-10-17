import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChooseResponse,
  ErrorResponse,
  SceneView,
  StoryView,
  TodayResponse,
  VerifyPurchaseResponse,
  WalletView,
} from '@storyquest/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { openDatabase } from '../src/db/database';
import { Repository } from '../src/db/repo';
import { AppError } from '../src/engine/errors';
import { createServer } from '../src/http/app';
import { Media } from '../src/media';
import { FakeVideo } from '../src/providers/video/fake';
import type { Services } from '../src/services';
import { AmazonReceiptVerifier, rvsUrl } from '../src/wallet/receipts';
import { Wallet } from '../src/wallet/wallet';
import { captureLogger, createRig, DEVICE, manualClock, OTHER_DEVICE, SpyVideo, testConfig, type TestRig } from './helpers';

const USER = 'amzn1.application.user.TESTUSER1';
const SKU_10 = 'storyquest.sparks.10';
const MONEY = { DAILY_FREE_SPARKS: '0', WELCOME_FREE_SPARKS: '1', SCENE_COST_SPARKS: '1' };

let server: { app: FastifyInstance; services: Services; dir: string } | null = null;
let rig: TestRig | null = null;

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

async function boot(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'storyquest-wallet-'));
  const config = testConfig(dir, { DAILY_IDEAS: '1', WARM_DEPTH: '1', ADMIN_TOKEN: 'wallet_admin_token_123', ...MONEY, ...env });
  const video = new SpyVideo(
    new FakeVideo(new Media(), { width: config.fakeVideoWidth, height: config.fakeVideoHeight, delayMs: 0, fontFile: config.FONT_FILE }),
  );
  const { app, services } = await createServer(config, { video });
  services.engine.start();
  await services.daily.ensure();
  await services.engine.idle();
  server = { app, services, dir };
  return { app, services, video };
}

const headers = (user?: string, device = DEVICE) => ({ 'x-device-id': device, ...(user ? { 'x-iap-user-id': user } : {}) });

async function wallet(app: FastifyInstance, user?: string, device = DEVICE) {
  const res = await app.inject({ method: 'GET', url: '/v1/wallet', headers: headers(user, device) });
  expect(res.statusCode).toBe(200);
  return WalletView.parse(res.json());
}

function buy(app: FastifyInstance, receiptId: string, userId = USER, sku = SKU_10) {
  return app.inject({ method: 'POST', url: '/v1/purchases/verify', headers: headers(), payload: { receiptId, userId, sku } });
}

async function scene(app: FastifyInstance, id: string) {
  for (let i = 0; i < 20; i++) {
    const view = SceneView.parse((await app.inject({ method: 'GET', url: `/v1/nodes/${id}?wait=5` })).json());
    if (view.status === 'ready' || view.status === 'failed') return view;
  }
  throw new Error('scene never settled');
}

async function startIdeaStory(app: FastifyInstance) {
  const home = TodayResponse.parse((await app.inject({ method: 'GET', url: '/v1/today' })).json());
  const res = await app.inject({ method: 'POST', url: '/v1/stories', headers: headers(), payload: { kind: 'idea', ideaId: home.ideas[0]!.id } });
  const story = StoryView.parse(res.json());
  await scene(app, story.currentNodeId);
  return story;
}

function choose(app: FastifyInstance, storyId: string, payload: object, user?: string) {
  return app.inject({ method: 'POST', url: `/v1/stories/${storyId}/choose`, headers: headers(user), payload });
}

async function chooseOk(app: FastifyInstance, storyId: string, payload: object, user?: string) {
  const res = await choose(app, storyId, payload, user);
  expect(res.statusCode, res.body).toBe(200);
  return ChooseResponse.parse(res.json()).nextNodeId;
}

function prefetch(app: FastifyInstance, nodeId: string, index: number, user?: string) {
  return app.inject({ method: 'POST', url: `/v1/nodes/${nodeId}/prefetch`, headers: headers(user), payload: { index } });
}

describe('wallet view', () => {
  it('starts every new TV with one free scene', async () => {
    const { app } = await boot();
    expect(await wallet(app)).toEqual({
      sparks: 0,
      freeSparks: 1,
      sceneCost: 1,
      products: [
        { sku: 'storyquest.sparks.10', sparks: 10 },
        { sku: 'storyquest.sparks.25', sparks: 25 },
      ],
      purchasesEnabled: true,
      filmingPaused: false,
    });
    expect((await app.inject({ method: 'GET', url: '/v1/wallet' })).statusCode).toBe(400);
    const odd = await app.inject({ method: 'GET', url: '/v1/wallet', headers: { 'x-device-id': DEVICE, 'x-iap-user-id': 'has spaces' } });
    expect(odd.statusCode).toBe(400);
  });

  it('grants the welcome scene once per TV, even when an Amazon account shows up later', async () => {
    const { app } = await boot();
    expect((await wallet(app)).freeSparks).toBe(1);
    expect((await wallet(app, USER)).freeSparks).toBe(1);
    expect((await wallet(app)).freeSparks).toBe(0);
    expect((await wallet(app, 'amzn1.second.account')).freeSparks).toBe(0);
    expect((await wallet(app, USER, OTHER_DEVICE)).freeSparks).toBe(1);
  });
});

describe('spending', () => {
  it('keeps shared paths free and charges one Spark per private scene when chosen', async () => {
    const { app } = await boot();
    const story = await startIdeaStory(app);
    const root = await scene(app, story.currentNodeId);
    expect(root.choices.map((choice) => choice.sparks)).toEqual([0, 0]);

    const shared = await chooseOk(app, story.id, { kind: 'preset', fromNodeId: root.id, index: 0 });
    expect((await wallet(app)).freeSparks).toBe(1);

    const custom = await chooseOk(app, story.id, { kind: 'custom', fromNodeId: shared, text: 'a rainbow bridge appears' });
    expect(await wallet(app)).toMatchObject({ freeSparks: 0, sparks: 0 });
    const privateScene = await scene(app, custom);
    expect(privateScene.status).toBe('ready');
    expect(privateScene.choices.map((choice) => choice.sparks)).toEqual([1, 1]);

    const broke = await choose(app, story.id, { kind: 'preset', fromNodeId: custom, index: 0 });
    expect(broke.statusCode).toBe(402);
    const error = ErrorResponse.parse(broke.json()).error;
    expect(error.code).toBe('payment_required');
    expect(error.message).not.toMatch(/[-–—]/);

    expect(VerifyPurchaseResponse.parse((await buy(app, 'fake-receipt-1')).json()).credited).toBe(10);
    await chooseOk(app, story.id, { kind: 'preset', fromNodeId: custom, index: 0 }, USER);
    expect(await wallet(app, USER)).toMatchObject({ sparks: 9, freeSparks: 0 });
    expect((await scene(app, custom)).choices.map((choice) => choice.sparks)).toEqual([0, 1]);
  });

  it('charges the opening and every later scene of a story of their own', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stories',
      headers: headers(),
      payload: { kind: 'custom', prompt: 'a kite that wants to see the sea', moods: ['cozy'], audience: 'kids' },
    });
    expect(res.statusCode).toBe(200);
    const story = StoryView.parse(res.json());
    expect((await wallet(app)).freeSparks).toBe(0);
    const root = await scene(app, story.currentNodeId);
    expect(root.choices.map((choice) => choice.sparks)).toEqual([1, 1]);
    expect((await choose(app, story.id, { kind: 'preset', fromNodeId: root.id, index: 1 })).statusCode).toBe(402);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/stories',
      headers: headers(),
      payload: { kind: 'custom', prompt: 'a snail who races', moods: [], audience: 'kids' },
    });
    expect(second.statusCode).toBe(402);
  });

  it('spends today’s free Sparks first, then the welcome scene, then bought Sparks', async () => {
    rig = createRig({ ...MONEY, DAILY_FREE_SPARKS: '1' });
    const { wallet: w } = rig.services;
    await w.verifyPurchase(DEVICE, { receiptId: 'fake-order', userId: USER, sku: SKU_10 });
    const payer = { deviceId: DEVICE, userId: USER };
    expect(w.view(payer)).toMatchObject({ sparks: 10, freeSparks: 2 });
    expect(w.charge(payer)).toMatchObject({ daily: 1, welcome: 0, sparks: 0 });
    expect(w.charge(payer)).toMatchObject({ daily: 0, welcome: 1, sparks: 0 });
    expect(w.charge(payer)).toMatchObject({ daily: 0, welcome: 0, sparks: 1 });
    expect(w.view(payer)).toMatchObject({ sparks: 9, freeSparks: 0 });
  });

  it('charges nothing when a request is refused before anything is made', async () => {
    const { app, services } = await boot();
    const story = await startIdeaStory(app);
    await buy(app, 'fake-receipt-3');
    const before = await wallet(app, USER);

    const from = story.currentNodeId;
    expect((await choose(app, story.id, { kind: 'custom', fromNodeId: from, text: 'lots of gore' }, USER)).statusCode).toBe(422);
    expect((await choose(app, story.id, { kind: 'custom', fromNodeId: from, text: 'x' }, USER)).statusCode).toBe(400);
    expect((await choose(app, story.id, { kind: 'custom', fromNodeId: 'nd_0000000000000000', text: 'a picnic' }, USER)).statusCode).toBe(409);
    expect(await wallet(app, USER)).toEqual(before);
    expect(services.repo.getStory(story.id)!.path).toEqual([from]);
  });

  it('leaves the story untouched when payment is refused', async () => {
    const { app, services } = await boot({ WELCOME_FREE_SPARKS: '0' });
    const story = await startIdeaStory(app);
    expect((await choose(app, story.id, { kind: 'custom', fromNodeId: story.currentNodeId, text: 'a picnic' })).statusCode).toBe(402);
    expect(services.repo.getStory(story.id)!.path).toEqual([story.currentNodeId]);
    const custom = services.db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE custom_text IS NOT NULL').get() as { n: number };
    expect(custom.n).toBe(0);
  });

  it('gives Sparks back when a scene fails before any video is made', async () => {
    const { app, video } = await boot();
    const story = await startIdeaStory(app);
    await buy(app, 'fake-receipt-4');
    const before = await wallet(app, USER);
    expect(before).toMatchObject({ sparks: 10, freeSparks: 1 });

    video.failWith = new Error('video provider down');
    const welcome = await chooseOk(app, story.id, { kind: 'custom', fromNodeId: story.currentNodeId, text: 'a picnic' }, USER);
    expect((await scene(app, welcome)).status).toBe('failed');
    expect(await wallet(app, USER)).toEqual(before);

    video.failWith = null;
    const ok = await chooseOk(app, story.id, { kind: 'custom', fromNodeId: story.currentNodeId, text: 'a picnic' }, USER);
    expect((await scene(app, ok)).status).toBe('ready');

    video.failWith = new Error('video provider down');
    const paid = await chooseOk(app, story.id, { kind: 'custom', fromNodeId: ok, text: 'a kite race' }, USER);
    expect((await scene(app, paid)).status).toBe('failed');
    expect(await wallet(app, USER)).toMatchObject({ sparks: 10, freeSparks: 0 });
  });

  it('still applies the hard per device cap with plenty of free Sparks', () => {
    rig = createRig({ ...MONEY, DAILY_FREE_SPARKS: '5', DEVICE_DAILY_CUSTOM_LIMIT: '2' });
    const { wallet: w } = rig.services;
    const payer = { deviceId: DEVICE, userId: null };
    w.charge(payer);
    w.charge(payer);
    expect(() => w.charge(payer)).toThrow(expect.objectContaining({ code: 'rate_limited', status: 429 }));
  });

  it('resets the daily free Sparks every UTC day', () => {
    const clock = manualClock('2026-10-17T23:00:00Z');
    rig = createRig({ ...MONEY, WELCOME_FREE_SPARKS: '0', DAILY_FREE_SPARKS: '2' }, { now: clock.now });
    const { wallet: w } = rig.services;
    const payer = { deviceId: DEVICE, userId: null };
    w.charge(payer);
    w.charge(payer);
    expect(() => w.charge(payer)).toThrow(expect.objectContaining({ code: 'payment_required', status: 402 }));
    expect(w.view(payer).freeSparks).toBe(0);

    clock.advance(2 * 60 * 60_000);
    expect(w.view(payer).freeSparks).toBe(2);
    expect(w.charge(payer)).toMatchObject({ daily: 1 });
  });

  it('can hold the welcome scene back until a TV has watched enough scenes', async () => {
    const { app } = await boot({ FREE_SPARK_UNLOCK_AFTER_SCENES: '2' });
    expect((await wallet(app)).freeSparks).toBe(0);

    const story = await startIdeaStory(app);
    expect((await wallet(app)).freeSparks).toBe(0);
    expect((await choose(app, story.id, { kind: 'custom', fromNodeId: story.currentNodeId, text: 'a picnic' })).statusCode).toBe(402);

    const next = await chooseOk(app, story.id, { kind: 'preset', fromNodeId: story.currentNodeId, index: 0 });
    expect((await wallet(app)).freeSparks).toBe(1);
    await scene(app, next);
    await chooseOk(app, story.id, { kind: 'custom', fromNodeId: next, text: 'a picnic' });
    expect((await wallet(app)).freeSparks).toBe(0);
  });
});

describe('preparing private choices', () => {
  it('films a private choice ahead only when the family could pay for it, and charges on choosing', async () => {
    const { app, services } = await boot();
    const story = await startIdeaStory(app);

    const shared = await prefetch(app, story.currentNodeId, 0);
    expect(shared.statusCode).toBe(200);
    expect(SceneView.parse(shared.json()).id).toBe(story.currentNodeId);

    const custom = await chooseOk(app, story.id, { kind: 'custom', fromNodeId: story.currentNodeId, text: 'a rainbow bridge' });
    await scene(app, custom);
    await services.engine.idle();
    expect(services.repo.getPresetChildren(custom)).toHaveLength(0);

    // The welcome scene is spent, so there is nothing to prepare with.
    expect((await prefetch(app, custom, 1)).statusCode).toBe(200);
    expect(services.repo.getPresetChildren(custom)).toHaveLength(0);

    await buy(app, 'fake-receipt-5');
    await prefetch(app, custom, 1, USER);
    await prefetch(app, custom, 1, USER);
    await services.engine.idle();
    const prepared = services.repo.getPresetChildren(custom);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ choiceIndex: 1, status: 'ready', charge: null });
    expect((await wallet(app, USER)).sparks).toBe(10);

    const view = await scene(app, custom);
    expect(view.choices[1]).toMatchObject({ ready: true, sparks: 1 });
    await chooseOk(app, story.id, { kind: 'preset', fromNodeId: custom, index: 1 }, USER);
    expect((await wallet(app, USER)).sparks).toBe(9);
    expect((await scene(app, custom)).choices[1]!.sparks).toBe(0);

    expect((await prefetch(app, custom, 2, USER)).statusCode).toBe(400);
  });
});

describe('purchases', () => {
  it('credits a receipt exactly once', async () => {
    const { app } = await boot();
    const first = VerifyPurchaseResponse.parse((await buy(app, 'fake-receipt-6')).json());
    expect(first).toMatchObject({ credited: 10, alreadyProcessed: false, wallet: { sparks: 10 } });
    const again = VerifyPurchaseResponse.parse((await buy(app, 'fake-receipt-6')).json());
    expect(again).toMatchObject({ credited: 0, alreadyProcessed: true, wallet: { sparks: 10 } });

    const bigger = VerifyPurchaseResponse.parse((await buy(app, 'fake-receipt-7', USER, 'storyquest.sparks.25')).json());
    expect(bigger.wallet.sparks).toBe(35);

    const stolen = await buy(app, 'fake-receipt-6', 'amzn1.someone.else');
    expect(stolen.statusCode).toBe(422);
    expect(ErrorResponse.parse(stolen.json()).error.code).toBe('purchase_invalid');
  });

  it('accepts only fake receipts and known products in fake mode', async () => {
    const { app } = await boot();
    expect((await buy(app, 'real-looking-receipt')).statusCode).toBe(422);
    expect((await buy(app, 'fake-receipt-8', USER, 'storyquest.sparks.999')).statusCode).toBe(422);
    expect((await wallet(app, USER)).sparks).toBe(0);
  });

  it('turns purchases off when a real mode has no shared secret', async () => {
    const { app } = await boot({ IAP_MODE: 'production' });
    expect((await wallet(app)).purchasesEnabled).toBe(false);
    const res = await buy(app, 'fake-receipt-9');
    expect(res.statusCode).toBe(503);
    expect(ErrorResponse.parse(res.json()).error.message).not.toMatch(/[-–—]/);
  });

  it('reports wallet totals to admins', async () => {
    const { app } = await boot();
    const story = await startIdeaStory(app);
    await buy(app, 'fake-receipt-10');
    const first = await chooseOk(app, story.id, { kind: 'custom', fromNodeId: story.currentNodeId, text: 'a picnic' }, USER);
    await scene(app, first);
    await chooseOk(app, story.id, { kind: 'custom', fromNodeId: first, text: 'a kite race' }, USER);
    const stats = (await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: { authorization: 'Bearer wallet_admin_token_123' } })).json();
    expect(stats.wallet).toMatchObject({ purchases: 1, sparksSold: 10, sparksSpent: 1, freeSparksSpent: 1, sparksOutstanding: 9, iapMode: 'fake' });
  });
});

describe('Amazon Receipt Verification Service', () => {
  const secret = 'top_secret/shared=value';
  const receiptId = 'wE1EG1gsEZI9q9UnI5YoZ2OxeoVKPdR5bvPMqyKQq5Y=:1:11';
  const okBody = {
    productId: SKU_10,
    receiptId,
    productType: 'CONSUMABLE',
    purchaseDate: 1399070221749,
    cancelDate: null,
    quantity: 1,
    testTransaction: true,
    betaProduct: false,
  };

  function setup(responses: Array<Response | Error>, mode: 'sandbox' | 'production' = 'sandbox') {
    const { logger, entries } = captureLogger();
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      const next = responses.shift();
      if (!next) throw new Error('no more responses');
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch;
    const config = loadConfig({ IAP_MODE: mode, AMAZON_IAP_SHARED_SECRET: secret });
    const repo = new Repository(openDatabase(':memory:'));
    const verifier = new AmazonReceiptVerifier({ mode, sharedSecret: secret, retryDelayMs: 0 }, logger, fetchImpl);
    const wallet = new Wallet({ config, repo, verifier, log: logger, now: () => new Date() });
    const verify = (overrides: Partial<{ receiptId: string; userId: string; sku: string }> = {}) =>
      wallet.verifyPurchase(DEVICE, { receiptId, userId: USER, sku: SKU_10, ...overrides });
    return { verify, urls, entries, repo };
  }

  const json = (status: number, body: unknown = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function expectError(promise: Promise<unknown>, code: string, status: number) {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code, status });
  }

  it('builds the documented production and sandbox URLs', () => {
    expect(rvsUrl('production', 's', 'u', 'r')).toBe(
      'https://appstore-sdk.amazon.com/version/1.0/verifyReceiptId/developer/s/user/u/receiptId/r',
    );
    expect(rvsUrl('sandbox', 'a/b', 'u=1', 'x:1')).toBe(
      'https://appstore-sdk.amazon.com/sandbox/version/1.0/verifyReceiptId/developer/a%2Fb/user/u%3D1/receiptId/x%3A1',
    );
  });

  it('credits a valid consumable receipt and stores what Amazon said', async () => {
    const { verify, urls, repo } = setup([json(200, okBody)]);
    expect(await verify()).toMatchObject({ credited: 10, alreadyProcessed: false, wallet: { sparks: 10 } });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^https:\/\/appstore-sdk\.amazon\.com\/sandbox\/version\/1\.0\/verifyReceiptId\/developer\//);
    const stored = repo.getPurchase(receiptId)!;
    expect(stored).toMatchObject({ userId: USER, sku: SKU_10, sparks: 10, mode: 'sandbox', testTransaction: true });
    expect(JSON.parse(stored.raw)).toMatchObject({ betaProduct: false });
  });

  it.each([
    ['another product', { productId: 'storyquest.sparks.25' }],
    ['a subscription', { productType: 'SUBSCRIPTION' }],
    ['an entitlement', { productType: 'ENTITLED' }],
    ['a cancelled purchase', { cancelDate: 1399070229999 }],
  ])('rejects %s', async (_label, change) => {
    const { verify, repo } = setup([json(200, { ...okBody, ...change })]);
    await expectError(verify(), 'purchase_invalid', 422);
    expect(repo.getWallet(`user:${USER}`)).toBeNull();
  });

  it.each([400, 410, 496, 497])('maps status %i to purchase_invalid without retrying', async (status) => {
    const { verify, urls } = setup([json(status)]);
    await expectError(verify(), 'purchase_invalid', 422);
    expect(urls).toHaveLength(1);
  });

  it('retries once on a server error and then succeeds', async () => {
    const { verify, urls } = setup([json(500), json(200, okBody)]);
    expect((await verify()).credited).toBe(10);
    expect(urls).toHaveLength(2);
  });

  it('answers 503 when Amazon keeps failing or cannot be reached', async () => {
    await expectError(setup([json(503), json(500)]).verify(), 'internal', 503);
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    await expectError(setup([timeout, new TypeError('fetch failed')]).verify(), 'internal', 503);
  });

  it('never writes the shared secret to the logs', async () => {
    const { verify, entries } = setup([json(496)], 'production');
    await expectError(verify(), 'purchase_invalid', 422);
    const logged = JSON.stringify(entries);
    expect(logged).toContain('Amazon rejected the IAP shared secret');
    expect(logged).not.toContain('top_secret');
  });

  it('does not call Amazon again for a receipt it already credited', async () => {
    const { verify, urls } = setup([json(200, okBody)]);
    await verify();
    expect(await verify()).toMatchObject({ credited: 0, alreadyProcessed: true });
    expect(urls).toHaveLength(1);
  });
});
