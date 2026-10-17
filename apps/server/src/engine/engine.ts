import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ChoiceStat, StoryStats } from '@storyquest/contracts';
import { utcDay, type Audience, type Mood, type NodeRecord, type StoryRecord } from '../domain';
import { newFileTag, newId, newShareSlug } from '../ids';
import { errorDetails } from '../log';
import { clipText, provisionalTitle, sanitizeUserText } from '../text';
import {
  badRequest,
  budgetExhausted,
  conflict,
  MESSAGES,
  notFound,
  notReady,
  rateLimited,
  unsafeInput,
} from './errors';
import { JobQueue, type Priority } from './queue';
import { choiceLabel, SceneGenerator, type SceneGeneratorDeps } from './scenes';

export type StartStory =
  | { kind: 'idea'; ideaId: string }
  | { kind: 'custom'; prompt: string; moods: Mood[]; audience: Audience };

export type Choose =
  | { kind: 'preset'; fromNodeId: string; index: number }
  | { kind: 'custom'; fromNodeId: string; text: string };

const SHUTDOWN = Symbol('shutdown');
const RETRY_DELAY_MS = 500;

export class StoryEngine {
  private readonly events = new EventEmitter();
  private readonly queue: JobQueue;
  private readonly generator: SceneGenerator;
  private readonly movies = new Set<Promise<void>>();
  private stopping = false;

  constructor(private readonly deps: SceneGeneratorDeps) {
    this.events.setMaxListeners(0);
    this.generator = new SceneGenerator(deps);
    this.queue = new JobQueue(deps.config.MAX_PARALLEL_JOBS, (id) => this.runJob(id), deps.log);
  }

  /** Picks up work left over from the last run. */
  start(): void {
    const { repo, log } = this.deps;
    const reset = repo.resetGenerating();
    const pending = repo.listPendingIds();
    for (const id of pending) this.queue.enqueue(id, 'low');
    const movies = repo.listStoriesWithPendingMovie();
    for (const story of movies) this.trackMovie(story.id);
    log.info({ reset, pending: pending.length, movies: movies.length }, 'engine started');
  }

  /** Stops taking new work, releases long polls and lets running jobs finish. */
  async stop(timeoutMs = 20_000): Promise<void> {
    this.stopping = true;
    this.events.emit(SHUTDOWN);
    const finished = await this.queue.close(timeoutMs);
    this.deps.log.info({ finished }, 'engine stopped');
  }

  get queueSize() {
    return this.queue.size;
  }

  /** Resolves when no scene jobs or movie stitches are left. Mostly for tests. */
  async idle(): Promise<void> {
    await this.queue.idle();
    while (this.movies.size) await Promise.allSettled([...this.movies]);
  }

  enqueue(nodeId: string, priority: Priority = 'low'): void {
    if (!this.stopping) this.queue.enqueue(nodeId, priority);
  }

  budgetExhausted(): boolean {
    const { config, repo } = this.deps;
    return repo.spendSeconds(utcDay(this.deps.now())) + config.SCENE_SECONDS > config.DAILY_VIDEO_SECONDS_CAP;
  }

  // Stories

  async startStory(deviceId: string, request: StartStory): Promise<StoryRecord> {
    const { repo, config } = this.deps;
    if (request.kind === 'idea') {
      const idea = repo.getIdea(request.ideaId);
      if (!idea) throw notFound();
      const root = repo.getNode(idea.rootNodeId)!;
      if (root.status === 'failed' && this.budgetExhausted()) throw budgetExhausted();
      const story = repo.transaction(() => {
        repo.incrementIdeaPlays(idea.id);
        return repo.insertStory({ deviceId, treeId: idea.treeId, ideaId: idea.id, path: [root.id] });
      });
      this.arrive(root.id);
      return story;
    }

    const prompt = clipText(sanitizeUserText(request.prompt), 240);
    await this.assertSafeInput(prompt, request.audience);
    if (this.budgetExhausted()) throw budgetExhausted();
    this.consumeCustom(deviceId);

    const story = repo.transaction(() => {
      const tree = repo.insertTree({
        title: provisionalTitle(prompt),
        logline: clipText(prompt, 160),
        audience: request.audience,
        moods: request.moods,
        bible: null,
        prompt,
        totalScenes: config.SCENES_PER_STORY,
        isPrivate: true,
      });
      const storyId = newId('st');
      const root = repo.insertNode({
        treeId: tree.id,
        parentId: null,
        choiceIndex: null,
        customText: null,
        ownerStoryId: storyId,
        depth: 0,
        wantChildren: true,
      });
      return repo.insertStory({ id: storyId, deviceId, treeId: tree.id, ideaId: null, path: [root.id] });
    });
    this.enqueue(story.path[0]!, 'high');
    return story;
  }

  getStory(storyId: string): StoryRecord {
    const story = this.deps.repo.getStory(storyId);
    if (!story) throw notFound();
    return story;
  }

  async choose(storyId: string, deviceId: string | null, request: Choose): Promise<{ story: StoryRecord; nextNodeId: string }> {
    const { repo } = this.deps;
    const story = this.ownedStory(storyId, deviceId);
    if (story.status !== 'active') throw conflict(MESSAGES.storyFinished);

    const currentId = story.path[story.path.length - 1]!;
    let replaced: NodeRecord | null = null;
    if (request.fromNodeId !== currentId) {
      // When a scene fails to generate, the family may choose again from the scene before it.
      const current = repo.getNode(currentId)!;
      if (current.status !== 'failed' || current.parentId !== request.fromNodeId) throw conflict(MESSAGES.staleChoice);
      replaced = current;
    }

    const from = repo.getNode(request.fromNodeId)!;
    if (from.status !== 'ready') throw notReady();
    if (from.isEnding) throw conflict(MESSAGES.atEnding);

    let next: NodeRecord;
    if (request.kind === 'preset') {
      if (request.index >= from.choices.length) throw badRequest(MESSAGES.noSuchChoice);
      const existing = repo.getPresetChildren(from.id).find((child) => child.choiceIndex === request.index);
      if ((!existing || existing.status === 'failed') && this.budgetExhausted()) throw budgetExhausted();
      next = repo.getOrCreatePresetChild(from, request.index, 0).node;
    } else {
      const text = clipText(sanitizeUserText(request.text), 200);
      const tree = repo.getTree(from.treeId)!;
      await this.assertSafeInput(text, tree.audience);
      if (this.budgetExhausted()) throw budgetExhausted();
      this.consumeCustom(story.deviceId);
      next = repo.createCustomChild(from, text, story.id);
    }

    const path = replaced ? [...story.path.slice(0, -1), next.id] : [...story.path, next.id];
    repo.transaction(() => {
      repo.setStoryPath(story.id, path);
      const repeat = replaced?.id === next.id;
      if (next.choiceIndex !== null && !repeat) repo.addPicks(next.id, 1);
      if (replaced && replaced.choiceIndex !== null && !repeat) repo.addPicks(replaced.id, -1);
    });
    this.arrive(next.id);
    return { story: repo.getStory(story.id)!, nextNodeId: next.id };
  }

  async finish(storyId: string, deviceId: string | null): Promise<StoryRecord> {
    const { repo } = this.deps;
    const story = this.ownedStory(storyId, deviceId);
    if (story.status === 'finished') return story;

    const current = repo.getNode(story.path[story.path.length - 1]!)!;
    if (current.status !== 'ready' || !current.isEnding) throw notReady(MESSAGES.notAnEnding);

    let slug = newShareSlug();
    while (repo.slugTaken(slug)) slug = newShareSlug();
    if (repo.finishStory(story.id, slug)) this.trackMovie(story.id);
    return repo.getStory(story.id)!;
  }

  stats(story: StoryRecord): StoryStats {
    const { repo } = this.deps;
    const nodes = story.path.map((id) => repo.getNode(id)).filter((node): node is NodeRecord => node !== null);
    const choices: ChoiceStat[] = [];
    for (let i = 1; i < nodes.length; i++) {
      const parent = nodes[i - 1]!;
      const node = nodes[i]!;
      const label = choiceLabel(parent, node) ?? '';
      if (node.customText !== null) {
        choices.push({ sceneNumber: parent.depth + 1, label, percent: 0, custom: true });
        continue;
      }
      const total = repo.getPresetChildren(parent.id).reduce((sum, sibling) => sum + sibling.picks, 0);
      const percent = total > 0 ? Math.round((node.picks / total) * 100) : 100;
      choices.push({ sceneNumber: parent.depth + 1, label, percent: Math.min(100, Math.max(0, percent)), custom: false });
    }

    const presets = choices.filter((choice) => !choice.custom);
    const rarestChoice = presets.reduce<ChoiceStat | null>(
      (rarest, choice) => (rarest === null || choice.percent < rarest.percent ? choice : rarest),
      null,
    );
    const idea = story.ideaId ? repo.getIdea(story.ideaId) : null;
    return {
      choices,
      rarestChoice,
      endingsDiscovered: repo.countReadyEndings(story.treeId),
      familiesPlayed: idea ? idea.plays : repo.countStoriesForTree(story.treeId),
    };
  }

  // Scenes

  /** Resolves when the node is ready or failed, or when the timeout passes. */
  waitForNode(nodeId: string, timeoutMs: number, signal?: AbortSignal): Promise<NodeRecord | null> {
    const { repo } = this.deps;
    const settled = (node: NodeRecord) => node.status === 'ready' || node.status === 'failed';
    const current = repo.getNode(nodeId);
    if (!current || settled(current) || timeoutMs <= 0 || this.stopping || signal?.aborted) {
      return Promise.resolve(current);
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.events.off(nodeId, finish);
        this.events.off(SHUTDOWN, finish);
        signal?.removeEventListener('abort', finish);
        resolve(repo.getNode(nodeId));
      };
      const timer = setTimeout(finish, timeoutMs);
      this.events.on(nodeId, finish);
      this.events.on(SHUTDOWN, finish);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  /** A family reached this node: generate it if needed and get its children going. */
  private arrive(nodeId: string): void {
    const { repo } = this.deps;
    repo.setWantChildren(nodeId);
    const node = repo.getNode(nodeId)!;
    if (node.status === 'ready') this.prefetch(node.id);
    else if (node.status === 'pending') this.enqueue(node.id, 'high');
    else if (node.status === 'failed' && repo.resetFailed(node.id)) this.enqueue(node.id, 'high');
  }

  /**
   * Starts the two preset children of a ready node when a family is there or
   * the node is being warmed. Only one level at a time, never whole trees.
   */
  private prefetch(nodeId: string): void {
    const { repo } = this.deps;
    const node = repo.getNode(nodeId);
    if (!node || node.status !== 'ready' || node.isEnding) return;
    if (!node.wantChildren && node.warm <= 0) return;
    const tree = repo.getTree(node.treeId)!;
    if (node.depth + 1 >= tree.totalScenes || this.budgetExhausted()) return;

    node.choices.forEach((_label, index) => {
      const { node: child } = repo.getOrCreatePresetChild(node, index, Math.max(0, node.warm - 1));
      if (child.status === 'pending') this.enqueue(child.id, 'low');
      else if (child.status === 'ready' && child.warm > 0) this.prefetch(child.id);
    });
  }

  private async runJob(nodeId: string): Promise<void> {
    let outcome = await this.generator.generate(nodeId);
    while (outcome === 'retry' && !this.stopping) {
      await sleep(RETRY_DELAY_MS);
      outcome = await this.generator.generate(nodeId);
    }
    if (outcome === 'ready' || outcome === 'failed') this.events.emit(nodeId);
    if (outcome === 'ready') this.prefetch(nodeId);
  }

  private trackMovie(storyId: string): void {
    const job = this.stitchMovie(storyId).finally(() => this.movies.delete(job));
    this.movies.add(job);
  }

  private async stitchMovie(storyId: string): Promise<void> {
    const { repo, store, media, log } = this.deps;
    const story = repo.getStory(storyId);
    if (!story) return;
    try {
      const clips = story.path.map((id) => {
        const node = repo.getNode(id);
        if (!node?.clipPath) throw new Error(`scene ${id} has no clip`);
        return store.absolute(node.clipPath);
      });
      await mkdir(store.moviesDir(), { recursive: true });
      const output = join(store.moviesDir(), `${story.id}-${newFileTag()}.mp4`);
      const started = Date.now();
      await media.stitch(clips, output);
      repo.setMovie(story.id, 'ready', store.relative(output));
      log.info({ storyId, scenes: clips.length, ms: Date.now() - started }, 'movie ready');
    } catch (err) {
      repo.setMovie(story.id, 'failed', null);
      log.warn({ storyId, ...errorDetails(err) }, 'movie stitching failed');
    }
  }

  private ownedStory(storyId: string, deviceId: string | null): StoryRecord {
    const story = this.deps.repo.getStory(storyId);
    if (!story || (deviceId !== null && story.deviceId !== deviceId)) throw notFound();
    return story;
  }

  private consumeCustom(deviceId: string): void {
    const { repo, config } = this.deps;
    const allowed = repo.tryConsumeCustom(utcDay(this.deps.now()), deviceId, config.DEVICE_DAILY_CUSTOM_LIMIT);
    if (!allowed) throw rateLimited(MESSAGES.customLimit);
  }

  private async assertSafeInput(text: string, audience: Audience): Promise<void> {
    const verdict = await this.deps.safety.check(text, { source: 'input', audience });
    if (!verdict.ok) {
      this.deps.log.info({ reason: verdict.reason }, 'custom text rejected by the safety check');
      throw unsafeInput();
    }
  }
}
