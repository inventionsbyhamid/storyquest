import { existsSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoryRecord } from '../src/domain';
import { StoryEngine } from '../src/engine/engine';
import { AppError } from '../src/engine/errors';
import { silentLogger } from '../src/log';
import { FakeDirector } from '../src/providers/director/fake';
import type { Scene, SceneRequest } from '../src/providers/director/types';
import type { SafetyChecker } from '../src/providers/safety/types';
import { WordlistSafety } from '../src/providers/safety/wordlist';
import { hasDash } from '../src/text';
import { createRig, DEVICE, OTHER_DEVICE, type TestRig } from './helpers';

let rig: TestRig | null = null;

afterEach(async () => {
  await rig?.close();
  rig = null;
});

function setup(env: Record<string, string> = {}, overrides: Parameters<typeof createRig>[1] = {}) {
  rig = createRig(env, overrides);
  rig.services.engine.start();
  return rig;
}

async function firstIdea(r: TestRig) {
  await r.services.daily.ensure();
  return r.services.repo.listIdeas(r.services.daily.today())[0]!;
}

async function expectAppError(promise: Promise<unknown>, code: string, status: number) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  expect((err as AppError).status).toBe(status);
}

async function readyNode(r: TestRig, id: string) {
  const node = await r.services.engine.waitForNode(id, 20_000);
  expect(node?.status, node?.error ?? '').toBe('ready');
  return node!;
}

async function playToEnding(r: TestRig, story: StoryRecord, pick: (step: number) => number = () => 0) {
  let current = story;
  for (let step = 0; step < 20; step++) {
    const nodeId = current.path[current.path.length - 1]!;
    const node = await readyNode(r, nodeId);
    if (node.isEnding) return current;
    const result = await r.services.engine.choose(current.id, current.deviceId, {
      kind: 'preset',
      fromNodeId: nodeId,
      index: pick(step),
    });
    expect(result.nextNodeId).toBe(result.story.path[result.story.path.length - 1]);
    current = result.story;
  }
  throw new Error('story never ended');
}

describe('daily ideas', () => {
  it('creates today ideas once and warms one level below each root', async () => {
    const r = setup();
    const [created, again] = await Promise.all([r.services.daily.ensure(), r.services.daily.ensure()]);
    expect(created).toBe(2);
    expect(again).toBe(2);
    expect(await r.services.daily.ensure()).toBe(0);

    const ideas = r.services.repo.listIdeas(r.services.daily.today());
    expect(ideas).toHaveLength(2);
    await r.services.engine.idle();
    for (const idea of ideas) {
      const root = r.services.repo.getNode(idea.rootNodeId)!;
      expect(root.status).toBe('ready');
      const children = r.services.repo.getPresetChildren(root.id);
      expect(children).toHaveLength(2);
      expect(children.every((child) => child.status === 'ready')).toBe(true);
      expect(r.services.repo.getPresetChildren(children[0]!.id)).toHaveLength(0);
    }
  });
});

describe('a full story', () => {
  it('plays from the opening to a shared ending with stats and a movie', async () => {
    const r = setup();
    const idea = await firstIdea(r);
    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    expect(story.path).toEqual([idea.rootNodeId]);

    const root = await readyNode(r, idea.rootNodeId);
    expect(root.choices).toHaveLength(2);
    expect(root.timings).toMatchObject({ directorMs: expect.any(Number), videoMs: expect.any(Number) });
    expect(existsSync(r.services.store.absolute(root.clipPath!))).toBe(true);
    expect(existsSync(r.services.store.absolute(root.posterPath!))).toBe(true);
    expect(existsSync(r.services.store.absolute(root.lastFramePath!))).toBe(true);

    const ended = await playToEnding(r, story, (step) => step % 2);
    expect(ended.path).toHaveLength(6);
    const nodes = ended.path.map((id) => r.services.repo.getNode(id)!);
    nodes.forEach((node, depth) => {
      expect(node.depth).toBe(depth);
      expect(hasDash(`${node.caption} ${node.summary} ${node.choices.join(' ')}`)).toBe(false);
    });
    expect(nodes[5]!.isEnding).toBe(true);

    // Each scene after the first starts from its parent's last frame.
    const renders = r.video.calls.filter((call) => nodes.some((node) => call.prompt === node.videoPrompt));
    expect(renders.filter((call) => call.startFramePath === null)).toHaveLength(1);

    const finished = await r.services.engine.finish(ended.id, DEVICE);
    expect(finished.status).toBe('finished');
    expect(finished.shareSlug).toMatch(/^[2-9a-hjkmnp-z]{8}$/);
    expect(await r.services.engine.finish(ended.id, DEVICE)).toMatchObject({ shareSlug: finished.shareSlug });

    await r.services.engine.idle();
    const withMovie = r.services.repo.getStory(ended.id)!;
    expect(withMovie.movieStatus).toBe('ready');
    expect(statSync(r.services.store.absolute(withMovie.moviePath!)).size).toBeGreaterThan(1000);

    const stats = r.services.engine.stats(withMovie);
    expect(stats.choices).toHaveLength(5);
    expect(stats.choices.map((choice) => choice.sceneNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(stats.choices.every((choice) => choice.percent === 100 && !choice.custom)).toBe(true);
    expect(stats.rarestChoice).not.toBeNull();
    expect(stats.endingsDiscovered).toBeGreaterThanOrEqual(1);
    expect(stats.familiesPlayed).toBe(1);
  });

  it('only prefetches the children of scenes a family reached', async () => {
    const r = setup({ WARM_DEPTH: '0', DAILY_IDEAS: '1' });
    const idea = await firstIdea(r);
    await r.services.engine.idle();
    expect(r.services.repo.getPresetChildren(idea.rootNodeId)).toHaveLength(0);

    await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    await r.services.engine.idle();
    const children = r.services.repo.getPresetChildren(idea.rootNodeId);
    expect(children).toHaveLength(2);
    expect(r.services.repo.getPresetChildren(children[0]!.id)).toHaveLength(0);
  });

  it('shares one generation when two families pick the same new branch', async () => {
    const r = setup({ WARM_DEPTH: '0', DAILY_IDEAS: '1' });
    const idea = await firstIdea(r);
    await r.services.engine.idle();
    const a = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    const b = await r.services.engine.startStory(OTHER_DEVICE, { kind: 'idea', ideaId: idea.id });
    await readyNode(r, idea.rootNodeId);

    const [ra, rb] = await Promise.all([
      r.services.engine.choose(a.id, DEVICE, { kind: 'preset', fromNodeId: idea.rootNodeId, index: 1 }),
      r.services.engine.choose(b.id, OTHER_DEVICE, { kind: 'preset', fromNodeId: idea.rootNodeId, index: 1 }),
    ]);
    expect(ra.nextNodeId).toBe(rb.nextNodeId);
    await readyNode(r, ra.nextNodeId);
    await r.services.engine.idle();

    const child = r.services.repo.getNode(ra.nextNodeId)!;
    expect(r.video.calls.filter((call) => call.prompt === child.videoPrompt)).toHaveLength(1);
    expect(child.picks).toBe(2);
    expect(r.services.repo.getIdea(idea.id)!.plays).toBe(2);
  });

  it('computes how many families chose each option', async () => {
    const r = setup({ WARM_DEPTH: '0', DAILY_IDEAS: '1' });
    const idea = await firstIdea(r);
    const stories = [];
    for (const device of ['device_aaaa_0001', 'device_aaaa_0002', 'device_aaaa_0003', 'device_aaaa_0004']) {
      stories.push(await r.services.engine.startStory(device, { kind: 'idea', ideaId: idea.id }));
    }
    await readyNode(r, idea.rootNodeId);
    for (const [i, story] of stories.entries()) {
      await r.services.engine.choose(story.id, story.deviceId, { kind: 'preset', fromNodeId: idea.rootNodeId, index: i === 0 ? 1 : 0 });
    }
    const rare = r.services.engine.stats(r.services.repo.getStory(stories[0]!.id)!);
    expect(rare.choices[0]).toMatchObject({ sceneNumber: 1, percent: 25, custom: false });
    expect(rare.rarestChoice?.percent).toBe(25);
    expect(rare.familiesPlayed).toBe(4);
    const common = r.services.engine.stats(r.services.repo.getStory(stories[1]!.id)!);
    expect(common.choices[0]!.percent).toBe(75);
  });
});

describe('custom choices', () => {
  it('creates a private scene that weaves in the family idea', async () => {
    const r = setup({ DAILY_IDEAS: '1' });
    const idea = await firstIdea(r);
    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    await readyNode(r, idea.rootNodeId);

    const result = await r.services.engine.choose(story.id, DEVICE, {
      kind: 'custom',
      fromNodeId: idea.rootNodeId,
      text: 'the puppy learns to fly—with a jet-pack',
    });
    const node = await readyNode(r, result.nextNodeId);
    expect(node).toMatchObject({ choiceIndex: null, ownerStoryId: story.id, customText: 'the puppy learns to fly, with a jet pack' });
    expect(node.caption).toContain('the puppy learns to fly');

    // Private scenes cost money, so nothing below them is filmed until the TV asks for one choice.
    await r.services.engine.idle();
    expect(r.services.repo.getPresetChildren(node.id)).toHaveLength(0);
    r.services.engine.prepareChoice(node.id, 1, DEVICE, null);
    r.services.engine.prepareChoice(node.id, 1, DEVICE, null);
    await r.services.engine.idle();
    const prepared = r.services.repo.getPresetChildren(node.id);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ choiceIndex: 1, ownerStoryId: story.id, status: 'ready', charge: null });

    const stats = r.services.engine.stats(r.services.repo.getStory(story.id)!);
    expect(stats.choices[0]).toMatchObject({ custom: true, label: 'the puppy learns to fly, with a jet pack' });
    expect(stats.rarestChoice).toMatchObject({ custom: true, label: 'the puppy learns to fly, with a jet pack' });
  });

  it('turns away unsafe text with unsafe_input', async () => {
    const r = setup({ DAILY_IDEAS: '1' });
    const idea = await firstIdea(r);
    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    await readyNode(r, idea.rootNodeId);
    await expectAppError(
      r.services.engine.choose(story.id, DEVICE, { kind: 'custom', fromNodeId: idea.rootNodeId, text: 'a scene full of gore' }),
      'unsafe_input',
      422,
    );
    expect(r.services.repo.getStory(story.id)!.path).toHaveLength(1);
  });

  it('enforces the per device daily limit', async () => {
    const r = setup({ DAILY_IDEAS: '1', DEVICE_DAILY_CUSTOM_LIMIT: '1' });
    const idea = await firstIdea(r);
    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    await readyNode(r, idea.rootNodeId);
    const first = await r.services.engine.choose(story.id, DEVICE, { kind: 'custom', fromNodeId: idea.rootNodeId, text: 'a rainbow bridge' });
    const node = await readyNode(r, first.nextNodeId);
    await expectAppError(
      r.services.engine.choose(story.id, DEVICE, { kind: 'custom', fromNodeId: node.id, text: 'a singing whale' }),
      'rate_limited',
      429,
    );
  });

  it('starts a story from a family prompt and writes its bible in the background', async () => {
    const r = setup({ DAILY_IDEAS: '0' });
    const story = await r.services.engine.startStory(DEVICE, {
      kind: 'custom',
      prompt: 'A robot who wants to learn ballet',
      moods: ['funny'],
      audience: 'kids',
    });
    const tree = r.services.repo.getTree(story.treeId)!;
    expect(tree).toMatchObject({ isPrivate: true, bible: null, title: 'A Robot Who Wants to' });
    await readyNode(r, story.path[0]!);
    const withBible = r.services.repo.getTree(story.treeId)!;
    expect(withBible.bible?.audience).toBe('kids');
    expect(withBible.bible?.moods).toEqual(['funny']);
    expect(r.services.repo.getNode(story.path[0]!)!.ownerStoryId).toBe(story.id);
    expect(r.services.repo.getNode(story.path[0]!)!.timings?.bibleMs).toBeGreaterThanOrEqual(0);
  });
});

describe('guards', () => {
  it('rejects a choice from a scene that is not current', async () => {
    const r = setup({ DAILY_IDEAS: '1' });
    const idea = await firstIdea(r);
    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    await readyNode(r, idea.rootNodeId);
    const next = await r.services.engine.choose(story.id, DEVICE, { kind: 'preset', fromNodeId: idea.rootNodeId, index: 0 });
    await readyNode(r, next.nextNodeId);
    await expectAppError(
      r.services.engine.choose(story.id, DEVICE, { kind: 'preset', fromNodeId: idea.rootNodeId, index: 1 }),
      'bad_request',
      409,
    );
    await expectAppError(r.services.engine.finish(story.id, DEVICE), 'not_ready', 409);
    await expectAppError(
      r.services.engine.choose(story.id, OTHER_DEVICE, { kind: 'preset', fromNodeId: next.nextNodeId, index: 0 }),
      'not_found',
      404,
    );
  });

  it('stops new generation when the daily budget is spent but keeps cached scenes playing', async () => {
    const r = setup({ DAILY_IDEAS: '1', WARM_DEPTH: '1', DAILY_VIDEO_SECONDS_CAP: '3' });
    const idea = await firstIdea(r);
    await r.services.engine.idle();
    const root = r.services.repo.getNode(idea.rootNodeId)!;
    expect(root.status).toBe('ready');
    expect(r.services.repo.getPresetChildren(root.id).every((child) => child.status === 'ready')).toBe(true);

    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    const cached = await r.services.engine.choose(story.id, DEVICE, { kind: 'preset', fromNodeId: root.id, index: 0 });
    expect(r.services.repo.getNode(cached.nextNodeId)!.status).toBe('ready');
    await expectAppError(
      r.services.engine.choose(story.id, DEVICE, { kind: 'preset', fromNodeId: cached.nextNodeId, index: 0 }),
      'budget_exhausted',
      429,
    );
    await expectAppError(
      r.services.engine.choose(story.id, DEVICE, { kind: 'custom', fromNodeId: cached.nextNodeId, text: 'a kite race' }),
      'budget_exhausted',
      429,
    );
  });
});

describe('failures', () => {
  it('retries once, then fails, and lets the family choose again', async () => {
    const r = setup({ DAILY_IDEAS: '1', WARM_DEPTH: '0' });
    const idea = await firstIdea(r);
    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    await readyNode(r, idea.rootNodeId);
    await r.services.engine.idle();

    r.video.failWith = new Error('provider down');
    const children = r.services.repo.getPresetChildren(idea.rootNodeId);
    // Prefetched children already exist, so force a fresh branch through a custom choice.
    const result = await r.services.engine.choose(story.id, DEVICE, { kind: 'custom', fromNodeId: idea.rootNodeId, text: 'a picnic' });
    const failed = await r.services.engine.waitForNode(result.nextNodeId, 20_000);
    expect(failed).toMatchObject({ status: 'failed', attempts: 2, error: expect.stringContaining('another choice') });
    expect(hasDash(failed!.error!)).toBe(false);

    r.video.failWith = null;
    const retry = await r.services.engine.choose(story.id, DEVICE, { kind: 'preset', fromNodeId: idea.rootNodeId, index: 0 });
    expect(retry.nextNodeId).toBe(children[0]!.id);
    expect(retry.story.path).toEqual([idea.rootNodeId, children[0]!.id]);
  });

  it('asks again with a stricter note when the draft fails safety, then gives up kindly', async () => {
    const drafts: boolean[] = [];
    class StubbornDirector extends FakeDirector {
      override async writeScene(request: SceneRequest): Promise<Scene> {
        drafts.push(Boolean(request.stricter));
        return { ...(await super.writeScene(request)), caption: 'FORBIDDEN caption' };
      }
    }
    const director = new StubbornDirector();
    const wordlist = new WordlistSafety();
    const safety: SafetyChecker = {
      name: 'test',
      async check(text, context) {
        if (context.source === 'output' && text.includes('FORBIDDEN')) return { ok: false, reason: 'test' };
        return wordlist.check(text, context);
      },
    };
    const r = setup({ DAILY_IDEAS: '1' }, { director, safety });
    const idea = await firstIdea(r);
    const root = await r.services.engine.waitForNode(idea.rootNodeId, 20_000);
    expect(root).toMatchObject({ status: 'failed', error: expect.stringContaining('did not turn out right') });
    expect(drafts).toEqual([false, true]);
    expect(r.video.calls).toHaveLength(0);
  });

  it('picks up unfinished work after a restart', async () => {
    const r = setup({ DAILY_IDEAS: '1', WARM_DEPTH: '0' });
    await r.services.engine.stop(5_000);
    const idea = r.services.repo.createDailyIdea({
      date: '2026-01-01',
      position: 0,
      bible: (await new FakeDirector().planIdeas('2026-01-01', 1))[0]!,
      totalScenes: 6,
      warm: 0,
    })!;
    r.services.repo.claimNode(idea.rootNodeId);
    expect(r.services.repo.getNode(idea.rootNodeId)!.status).toBe('generating');

    // A fresh engine over the same database, as after a crash.
    const engine = new StoryEngine({
      config: r.config,
      repo: r.services.repo,
      director: r.services.director,
      video: r.video,
      safety: r.services.safety,
      media: r.services.media,
      store: r.services.store,
      log: silentLogger,
      now: () => new Date(),
      wallet: r.services.wallet,
    });
    engine.start();
    const node = await engine.waitForNode(idea.rootNodeId, 20_000);
    expect(node?.status).toBe('ready');
    await engine.stop(5_000);
  });
});

describe('long polling', () => {
  it('returns as soon as the scene is ready, or at the timeout', async () => {
    const r = setup({ DAILY_IDEAS: '1', WARM_DEPTH: '0' });
    const idea = await firstIdea(r);
    const started = Date.now();
    const node = await r.services.engine.waitForNode(idea.rootNodeId, 15_000);
    expect(node?.status).toBe('ready');
    expect(Date.now() - started).toBeLessThan(15_000);

    const story = await r.services.engine.startStory(DEVICE, { kind: 'idea', ideaId: idea.id });
    const result = await r.services.engine.choose(story.id, DEVICE, { kind: 'custom', fromNodeId: idea.rootNodeId, text: 'a snowball fight' });
    const quick = await r.services.engine.waitForNode(result.nextNodeId, 1);
    expect(['pending', 'generating']).toContain(quick?.status);

    const abort = new AbortController();
    const waiting = r.services.engine.waitForNode(result.nextNodeId, 15_000, abort.signal);
    abort.abort();
    expect((await waiting)?.id).toBe(result.nextNodeId);
  });
});
