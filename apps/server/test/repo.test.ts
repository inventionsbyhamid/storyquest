import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database';
import { Repository } from '../src/db/repo';
import type { Bible, NodeRecord } from '../src/domain';

const bible: Bible = {
  title: 'Pickle the Brave Toaster',
  logline: 'A tiny toaster saves breakfast.',
  audience: 'kids',
  moods: ['funny'],
  artStyle: 'Claymation',
  setting: 'A farmhouse kitchen',
  tone: 'silly',
  characters: [{ name: 'Pickle', description: 'a small chrome toaster' }],
};

let db: Db;
let repo: Repository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new Repository(db);
});

afterEach(() => db.close());

function markReady(id: string): NodeRecord {
  repo.claimNode(id);
  repo.markReady(id, {
    summary: 's',
    caption: 'c',
    videoPrompt: 'v',
    choices: ['Left', 'Right'],
    isEnding: false,
    newCharacters: [],
    clipPath: 'nodes/x/clip.mp4',
    posterPath: 'nodes/x/poster.jpg',
    lastFramePath: 'nodes/x/last.jpg',
    durationMs: 1000,
    timings: { directorMs: 1, videoMs: 1, mediaMs: 1, totalMs: 3 },
    costSeconds: 1,
  });
  return repo.getNode(id)!;
}

function readyRoot(): NodeRecord {
  const idea = repo.createDailyIdea({ date: '2026-10-17', position: 0, bible, totalScenes: 6, warm: 1 })!;
  return markReady(idea.rootNodeId);
}

describe('daily ideas', () => {
  it('fills each date and position slot once', () => {
    const first = repo.createDailyIdea({ date: '2026-10-17', position: 0, bible, totalScenes: 6, warm: 1 });
    const again = repo.createDailyIdea({ date: '2026-10-17', position: 0, bible, totalScenes: 6, warm: 1 });
    expect(first).not.toBeNull();
    expect(again).toBeNull();
    expect(repo.listIdeas('2026-10-17')).toHaveLength(1);
    const root = repo.getNode(first!.rootNodeId)!;
    expect(root).toMatchObject({ depth: 0, status: 'pending', warm: 1, ownerStoryId: null });
    expect(repo.getTree(first!.treeId)!.bible).toEqual(bible);
  });
});

describe('preset children', () => {
  it('creates a branch exactly once even when asked twice', () => {
    const root = readyRoot();
    const a = repo.getOrCreatePresetChild(root, 1, 0);
    const b = repo.getOrCreatePresetChild(root, 1, 0);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.node.id).toBe(a.node.id);
    expect(a.node).toMatchObject({ parentId: root.id, choiceIndex: 1, depth: 1, treeId: root.treeId });
    expect(repo.getPresetChildren(root.id)).toHaveLength(1);
  });

  it('is backed by a unique index in the database', () => {
    const root = readyRoot();
    repo.getOrCreatePresetChild(root, 0, 0);
    const insert = () =>
      db
        .prepare(
          `INSERT INTO nodes (id, tree_id, parent_id, choice_index, depth, created_at, updated_at)
           VALUES ('nd_dup', ?, ?, 0, 1, 'now', 'now')`,
        )
        .run(root.treeId, root.id);
    expect(insert).toThrow(/UNIQUE/);
  });

  it('allows any number of custom children', () => {
    const root = readyRoot();
    const one = repo.createCustomChild(root, 'a dragon appears', 'st_one');
    const two = repo.createCustomChild(root, 'a dragon appears', 'st_two');
    expect(one.id).not.toBe(two.id);
    expect(one).toMatchObject({ choiceIndex: null, customText: 'a dragon appears', ownerStoryId: 'st_one' });
  });

  it('keeps private branches private', () => {
    const root = readyRoot();
    const custom = markReady(repo.createCustomChild(root, 'fly', 'st_one').id);
    const child = repo.getOrCreatePresetChild(custom, 0, 0).node;
    expect(child.ownerStoryId).toBe('st_one');
  });

  it('returns the lineage root first', () => {
    const root = readyRoot();
    const child = repo.getOrCreatePresetChild(root, 0, 0).node;
    expect(repo.getLineage(child.id).map((node) => node.id)).toEqual([root.id, child.id]);
  });
});

describe('job claiming', () => {
  it('lets only one worker claim a node', () => {
    const idea = repo.createDailyIdea({ date: '2026-10-17', position: 1, bible, totalScenes: 6, warm: 0 })!;
    expect(repo.claimNode(idea.rootNodeId)).toBe(true);
    expect(repo.claimNode(idea.rootNodeId)).toBe(false);
    expect(repo.resetGenerating()).toBe(1);
    expect(repo.listPendingIds()).toContain(idea.rootNodeId);
  });

  it('retries once and then fails', () => {
    const idea = repo.createDailyIdea({ date: '2026-10-17', position: 2, bible, totalScenes: 6, warm: 0 })!;
    const id = idea.rootNodeId;
    repo.claimNode(id);
    expect(repo.recordFailure(id, 2, 'generation_failed', 'oops')).toBe('retry');
    expect(repo.getNode(id)).toMatchObject({ status: 'pending', attempts: 1, error: null });
    repo.claimNode(id);
    expect(repo.recordFailure(id, 2, 'generation_failed', 'oops')).toBe('failed');
    expect(repo.getNode(id)).toMatchObject({ status: 'failed', attempts: 2, error: 'oops' });
    expect(repo.resetFailed(id)).toBe(true);
    expect(repo.getNode(id)).toMatchObject({ status: 'pending', attempts: 0 });
  });
});

describe('budget and usage', () => {
  it('reserves video seconds up to the cap', () => {
    expect(repo.reserveVideoSeconds('2026-10-17', 8, 20)).toBe(true);
    expect(repo.reserveVideoSeconds('2026-10-17', 8, 20)).toBe(true);
    expect(repo.reserveVideoSeconds('2026-10-17', 8, 20)).toBe(false);
    expect(repo.spendSeconds('2026-10-17')).toBe(16);
    repo.addVideoSeconds('2026-10-17', -8);
    expect(repo.spendSeconds('2026-10-17')).toBe(8);
    expect(repo.spendSeconds('2026-10-18')).toBe(0);
  });

  it('keeps usage per device per day and never below zero', () => {
    repo.addUsage('2026-10-17', 'tv1', { custom: 1, freeUsed: 1 });
    repo.addUsage('2026-10-17', 'tv1', { custom: 1, freeUsed: 0 });
    expect(repo.getUsage('2026-10-17', 'tv1')).toEqual({ customCount: 2, freeUsed: 1 });
    expect(repo.getUsage('2026-10-18', 'tv1')).toEqual({ customCount: 0, freeUsed: 0 });
    repo.addUsage('2026-10-17', 'tv2', { custom: -1, freeUsed: -1 });
    expect(repo.getUsage('2026-10-17', 'tv2')).toEqual({ customCount: 0, freeUsed: 0 });
  });

  it('credits a receipt once and refuses to overdraw a wallet', () => {
    repo.createWallet('user:amzn1', 1);
    const purchase = { receiptId: 'fake-1', userId: 'amzn1', sku: 'storyquest.sparks.10', sparks: 10, mode: 'fake', testTransaction: true, raw: '{}' };
    expect(repo.creditPurchase('user:amzn1', purchase)).toBe(true);
    expect(repo.creditPurchase('user:amzn1', purchase)).toBe(false);
    expect(repo.getWallet('user:amzn1')).toMatchObject({ sparks: 10, freeSparks: 1, purchased: 10, spent: 0 });
    expect(() => repo.changeWallet('user:amzn1', { sparks: -11 })).toThrow(/CHECK/);
    expect(() => repo.changeWallet('user:amzn1', { freeSparks: -2 })).toThrow(/CHECK/);
    expect(repo.getWallet('user:amzn1')!.sparks).toBe(10);
  });
});
