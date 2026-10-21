import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ChoiceStat, StoryStats } from '@storyquest/contracts';
import { continuesChapter, isPaid, type Audience, type Mood, type NodeRecord, type NodeStatus, type StoryRecord } from '../domain';
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
  pathClosed,
  unsafeInput,
} from './errors';
import { JobQueue, type Priority } from './queue';
import type { Wallet } from '../wallet/wallet';
import { choiceLabel, forcedWarm, SceneGenerator, type SceneGeneratorDeps } from './scenes';

export type EngineDeps = SceneGeneratorDeps & { wallet: Wallet };

export type StartStory =
  | { kind: 'idea'; ideaId: string }
  | { kind: 'custom'; prompt: string; moods: Mood[]; audience: Audience };

export type Choose =
  | { kind: 'preset'; fromNodeId: string; index: number }
  | { kind: 'custom'; fromNodeId: string; text: string };

export interface WarmProgress {
  ideaId: string;
  treeId: string;
  depth: number;
  force: boolean;
  /** Scenes in a full tree of this depth: two choices per scene, endings only on the last scene. */
  expected: number;
  counts: Record<NodeStatus, number>;
  complete: boolean;
  budgetExhausted: boolean;
}

const SHUTDOWN = Symbol('shutdown');
const RETRY_DELAY_MS = 500;

export class StoryEngine {
  private readonly events = new EventEmitter();
  private readonly queue: JobQueue;
  private readonly generator: SceneGenerator;
  private readonly movies = new Set<Promise<void>>();
  private stopping = false;

  constructor(private readonly deps: EngineDeps) {
    this.events.setMaxListeners(0);
    this.generator = new SceneGenerator(deps);
    this.queue = new JobQueue(deps.config.MAX_PARALLEL_JOBS, (id) => this.runJob(id), deps.log);
  }

  /** Picks up work left over from the last run. */
  start(): void {
    const { repo, log } = this.deps;
    const reset = repo.resetGenerating();
    // Without auto prefetch, scenes prepared ahead before a restart wait until someone chooses them.
    const pending = this.deps.config.AUTO_PREFETCH ? repo.listPendingIds() : repo.listWantedPendingIds();
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

  get isStopping(): boolean {
    return this.stopping;
  }

  /** Films a ready scene again for a better take. See SceneGenerator.redo. */
  redo(nodeId: string) {
    return this.generator.redo(nodeId);
  }

  /** Resolves when no scene jobs or movie stitches are left. Mostly for tests. */
  async idle(): Promise<void> {
    await this.queue.idle();
    while (this.movies.size) await Promise.allSettled([...this.movies]);
  }

  enqueue(nodeId: string, priority: Priority = 'low'): void {
    if (!this.stopping) this.queue.enqueue(nodeId, priority);
  }

  /** True when the next scene could not be paid for under the daily or lifetime caps. */
  budgetExhausted(): boolean {
    return this.deps.budget.exhausted() !== null;
  }

  // Stories

  async startStory(deviceId: string, request: StartStory, iapUserId: string | null = null): Promise<StoryRecord> {
    const { repo, config, wallet } = this.deps;
    if (request.kind === 'idea') {
      const idea = repo.getIdea(request.ideaId);
      if (!idea) throw notFound();
      const root = repo.getNode(idea.rootNodeId)!;
      if (root.hiddenAt) throw pathClosed();
      if (root.status === 'failed' && this.budgetExhausted()) throw budgetExhausted();
      const story = repo.transaction(() => {
        repo.incrementIdeaPlays(idea.id);
        repo.addSceneSeen(deviceId);
        return repo.insertStory({ deviceId, treeId: idea.treeId, ideaId: idea.id, path: [root.id] });
      });
      this.arrive(root.id);
      return story;
    }

    const prompt = clipText(sanitizeUserText(request.prompt), 240);
    await this.assertSafeInput(prompt, request.audience);
    if (this.budgetExhausted()) throw budgetExhausted();

    const story = repo.transaction(() => {
      const charge = wallet.charge({ deviceId, userId: iapUserId });
      const tree = repo.insertTree({
        title: provisionalTitle(prompt),
        logline: clipText(prompt, 160),
        audience: request.audience,
        moods: request.moods,
        bible: null,
        prompt,
        totalScenes: config.SCENES_PER_STORY,
        clipsPerChapter: config.CLIPS_PER_CHAPTER,
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
        charge,
      });
      repo.addSceneSeen(deviceId);
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

  async choose(
    storyId: string,
    deviceId: string | null,
    request: Choose,
    iapUserId: string | null = null,
  ): Promise<{ story: StoryRecord; nextNodeId: string }> {
    const { repo, wallet } = this.deps;
    const story = this.ownedStory(storyId, deviceId);
    if (story.status !== 'active') throw conflict(MESSAGES.storyFinished);

    const currentId = story.path[story.path.length - 1]!;
    let replaced: NodeRecord | null = null;
    if (request.fromNodeId !== currentId) {
      // When a scene fails to generate or is taken down, the family may choose again from the scene before it.
      const current = repo.getNode(currentId)!;
      const stuck = current.status === 'failed' || current.hiddenAt !== null;
      if (!stuck || current.parentId !== request.fromNodeId) throw conflict(MESSAGES.staleChoice);
      replaced = current;
    }

    const from = repo.getNode(request.fromNodeId)!;
    if (from.hiddenAt) throw pathClosed();
    if (from.status !== 'ready') throw notReady();
    if (from.isEnding) throw conflict(MESSAGES.atEnding);

    let customText: string | null = null;
    const continuing = continuesChapter(from);
    if (continuing && (request.kind !== 'preset' || request.index !== 0)) throw badRequest(MESSAGES.noSuchChoice);
    if (request.kind === 'preset') {
      if (request.index >= from.choices.length) throw badRequest(MESSAGES.noSuchChoice);
      const existing = repo.getPresetChildren(from.id).find((child) => child.choiceIndex === request.index);
      if (existing?.hiddenAt) throw pathClosed();
      if ((!existing || existing.status === 'failed') && this.budgetExhausted()) throw budgetExhausted();
    } else {
      customText = clipText(sanitizeUserText(request.text), 200);
      const tree = repo.getTree(from.treeId)!;
      await this.assertSafeInput(customText, tree.audience);
      if (this.budgetExhausted()) throw budgetExhausted();
    }

    // Paying, creating the scene and moving the story forward happen together or not at all.
    // Shared scenes are free; a scene filmed only for this family costs Sparks the first time it is chosen.
    const payer = { deviceId: story.deviceId, userId: iapUserId };
    const next = repo.transaction(() => {
      let node: NodeRecord;
      if (continuing) {
        // The next clip of the chapter the family already chose, paid for when the chapter began.
        node = repo.getOrCreateContinuation(from).node;
      } else if (request.kind === 'preset') {
        node = repo.getOrCreatePresetChild(from, request.index, 0).node;
        if (node.ownerStoryId !== null && !isPaid(node)) repo.setNodeCharge(node.id, wallet.charge(payer));
      } else {
        node = repo.createCustomChild(from, customText!, story.id, wallet.charge(payer));
      }
      repo.setStoryPath(story.id, replaced ? [...story.path.slice(0, -1), node.id] : [...story.path, node.id]);
      repo.addSceneSeen(story.deviceId);
      const repeat = replaced?.id === node.id;
      if (node.choiceIndex !== null && !repeat && !continuing) repo.addPicks(node.id, 1);
      if (replaced && replaced.choiceIndex !== null && !repeat) repo.addPicks(replaced.id, -1);
      return node;
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
      if (continuesChapter(parent)) continue;
      const label = choiceLabel(parent, node) ?? '';
      // Anything on a private path was seen by this family only, so it has no share of families.
      if (node.customText !== null || node.ownerStoryId !== null) {
        choices.push({ sceneNumber: parent.chapter + 1, label, percent: 0, custom: true });
        continue;
      }
      const total = repo.getPresetChildren(parent.id).reduce((sum, sibling) => sum + sibling.picks, 0);
      const percent = total > 0 ? Math.round((node.picks / total) * 100) : 100;
      choices.push({ sceneNumber: parent.chapter + 1, label, percent: Math.min(100, Math.max(0, percent)), custom: false });
    }

    const presets = choices.filter((choice) => !choice.custom);
    const rarestChoice =
      choices.find((choice) => choice.custom) ??
      presets.reduce<ChoiceStat | null>(
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

  /**
   * Films one private choice ahead of time while the family looks at it, but
   * only if they could pay for it. Nothing is charged until they choose it.
   * Shared scenes are already prepared, so this does nothing for them.
   */
  prepareChoice(nodeId: string, index: number, deviceId: string | null, iapUserId: string | null): NodeRecord {
    const { repo, wallet } = this.deps;
    const node = repo.getNode(nodeId);
    if (!node) throw notFound();
    if (!this.deps.config.AUTO_PREFETCH || node.ownerStoryId === null || node.hiddenAt) return node;
    const story = repo.getStory(node.ownerStoryId);
    if (!story || (deviceId !== null && story.deviceId !== deviceId)) throw notFound();
    if (node.status !== 'ready') throw notReady();
    if (node.isEnding || index >= node.choices.length) throw badRequest(MESSAGES.noSuchChoice);

    const existing = repo.getPresetChildren(node.id).find((child) => child.choiceIndex === index);
    if (existing) return node;
    if (this.budgetExhausted() || !wallet.canAfford({ deviceId: story.deviceId, userId: iapUserId })) return node;
    const { node: child, created } = repo.getOrCreatePresetChild(node, index, 0);
    if (created) this.enqueue(child.id, 'high');
    return node;
  }

  // Warming

  /**
   * Generates every shared preset path of an idea down to `depth` scenes, one
   * level at a time as parents become ready. Jobs run at low priority so
   * families playing right now still go first.
   */
  warmTree(ideaId: string, depth: number | undefined, force: boolean): WarmProgress {
    const { repo, log } = this.deps;
    const idea = repo.getIdea(ideaId);
    if (!idea) throw notFound();
    if (!this.deps.config.AUTO_PREFETCH) throw conflict(MESSAGES.warmingOff);
    const tree = repo.getTree(idea.treeId)!;
    const target = Math.min(Math.max(1, Math.floor(depth ?? tree.totalScenes)), tree.totalScenes);
    repo.setTreeWarm(tree.id, target, force);

    for (const node of repo.listSharedNodes(tree.id, target)) {
      if (node.status === 'pending') this.enqueue(node.id, 'low');
      else if (node.status === 'ready') this.prefetch(node.id);
      else if (node.status === 'failed' && (force || !this.budgetExhausted()) && repo.resetFailed(node.id)) {
        this.enqueue(node.id, 'low');
      }
    }
    log.info({ ideaId, treeId: tree.id, depth: target, force }, 'warming tree');
    return this.warmProgress(ideaId);
  }

  warmProgress(ideaId: string): WarmProgress {
    const { repo } = this.deps;
    const idea = repo.getIdea(ideaId);
    if (!idea) throw notFound();
    const tree = repo.getTree(idea.treeId)!;
    const depth = tree.warmDepth || tree.totalScenes;
    const counts = repo.countSharedByStatus(tree.id, depth);
    const expected = 2 ** depth - 1;
    return {
      ideaId,
      treeId: tree.id,
      depth,
      force: tree.warmForce,
      expected,
      counts,
      complete: counts.ready >= expected,
      budgetExhausted: this.budgetExhausted(),
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
    if (this.continueChapter(nodeId)) return;
    if (!this.deps.config.AUTO_PREFETCH) return;
    const node = repo.getNode(nodeId);
    if (!node || node.status !== 'ready' || node.isEnding || node.hiddenAt) return;
    // Private scenes cost real money, so they are only prepared on request through prepareChoice.
    if (node.ownerStoryId !== null) return;
    if (!node.wantChildren && node.warm <= 0) return;
    const tree = repo.getTree(node.treeId)!;
    if (node.depth + 1 >= tree.totalScenes) return;
    if (this.deps.budget.exhausted({ ignoreDaily: forcedWarm(tree, node.depth + 1, node.ownerStoryId) })) return;

    node.choices.forEach((_label, index) => {
      const { node: child } = repo.getOrCreatePresetChild(node, index, Math.max(0, node.warm - 1));
      if (child.status === 'pending') this.enqueue(child.id, 'low');
      else if (child.status === 'ready' && child.warm > 0) this.prefetch(child.id);
    });
  }

  /**
   * Films the next clip of a chapter as soon as the clip before it is ready, whatever the
   * prefetch settings, once a family is on this chapter: it plays as one piece, so its clips are made back to back.
   * Returns true when the node is part way through a chapter.
   */
  private continueChapter(nodeId: string): boolean {
    const { repo } = this.deps;
    const node = repo.getNode(nodeId);
    if (!node || !continuesChapter(node)) return false;
    // Only once someone is watching this chapter; a choice's preview films just its first clip.
    if (node.status !== 'ready' || node.hiddenAt || !node.wantChildren) return true;
    const { node: next } = repo.getOrCreateContinuation(node);
    if (next.status === 'pending') this.enqueue(next.id, 'high');
    else if (next.status === 'failed' && !this.budgetExhausted() && repo.resetFailed(next.id)) this.enqueue(next.id, 'high');
    return true;
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

  private async assertSafeInput(text: string, audience: Audience): Promise<void> {
    const verdict = await this.deps.safety.check(text, { source: 'input', audience });
    if (!verdict.ok) {
      this.deps.log.info({ reason: verdict.reason }, 'custom text rejected by the safety check');
      throw unsafeInput();
    }
  }
}
