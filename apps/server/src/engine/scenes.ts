import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Config } from '../config';
import type { Repository } from '../db/repo';
import { utcDay, type Audience, type Bible, type Character, type NodeRecord, type NodeTimings, type TreeRecord } from '../domain';
import { newFileTag } from '../ids';
import { errorDetails, type Logger } from '../log';
import type { Media } from '../media';
import { DirectorRefusal, type Director, type Scene, type SceneRequest } from '../providers/director/types';
import type { SafetyChecker } from '../providers/safety/types';
import { VideoRejected, type VideoProvider } from '../providers/video/types';
import type { MediaStore } from '../storage';
import { clipText, sanitizeUserText } from '../text';
import { GenerationError, MESSAGES } from './errors';

export interface SceneGeneratorDeps {
  config: Config;
  repo: Repository;
  director: Director;
  video: VideoProvider;
  safety: SafetyChecker;
  media: Media;
  store: MediaStore;
  log: Logger;
  now: () => Date;
}

export type GenerateOutcome = 'ready' | 'failed' | 'retry' | 'skipped';

const MAX_ATTEMPTS = 2;
const BUDGET_WARNING_SHARE = 0.8;
const FALLBACK_CHOICES = ['Follow the glowing trail', 'Ask a new friend for help'];

const clean = (text: string) => sanitizeUserText(text);

export function sanitizeBible(bible: Bible): Bible {
  return {
    ...bible,
    title: clipText(clean(bible.title), 60),
    logline: clipText(clean(bible.logline), 160),
    artStyle: clean(bible.artStyle),
    setting: clean(bible.setting),
    tone: clean(bible.tone),
    characters: bible.characters.map((character) => ({
      name: clipText(clean(character.name), 40),
      description: clean(character.description),
    })),
  };
}

export function sanitizeScene(scene: Scene, sceneNumber: number, totalScenes: number): Scene {
  const isEnding = sceneNumber >= totalScenes;
  let choices: string[] = [];
  if (!isEnding) {
    choices = scene.choices.map((label) => clipText(clean(label), 48)).filter(Boolean);
    for (const fallback of FALLBACK_CHOICES) {
      if (choices.length >= 2) break;
      if (!choices.some((label) => label.toLowerCase() === fallback.toLowerCase())) choices.push(fallback);
    }
    choices = choices.slice(0, 2);
  }
  return {
    summary: clean(scene.summary),
    caption: clipText(clean(scene.caption), 90),
    videoPrompt: clean(scene.videoPrompt),
    choices,
    isEnding,
    newCharacters: scene.newCharacters.map((character) => ({
      name: clipText(clean(character.name), 40),
      description: clean(character.description),
    })),
  };
}

/** Shared nodes inside an admin's forced warm request may go past the daily cap. */
export function forcedWarm(tree: TreeRecord, depth: number, ownerStoryId: string | null): boolean {
  return tree.warmForce && ownerStoryId === null && depth < tree.warmDepth;
}

/** Runs the pipeline for one node: director, safety, budget, video, media. */
export class SceneGenerator {
  constructor(private readonly deps: SceneGeneratorDeps) {}

  async generate(nodeId: string): Promise<GenerateOutcome> {
    const { repo, config, log } = this.deps;
    if (!repo.claimNode(nodeId)) return 'skipped';

    const started = performance.now();
    const day = utcDay(this.deps.now());
    let reservedSeconds = 0;
    let videoMade = false;
    let partialFiles: string[] = [];
    const timings: NodeTimings = { directorMs: 0, videoMs: 0, mediaMs: 0, totalMs: 0 };

    try {
      const node = repo.getNode(nodeId)!;
      const tree = repo.getTree(node.treeId)!;
      const bible = tree.bible ?? (await this.createBible(tree, timings));
      const lineage = repo.getLineage(node.id);
      const parent = lineage.length > 1 ? lineage[lineage.length - 2]! : null;
      if (parent && (parent.status !== 'ready' || !parent.lastFramePath)) {
        throw new Error(`parent ${parent.id} is not ready`);
      }
      const request = this.sceneRequest(tree, bible, lineage);
      const forced = forcedWarm(tree, node.depth, node.ownerStoryId);
      const seconds = config.SCENE_SECONDS;

      let directorStarted = performance.now();
      let draft = await this.writeSafeScene(request, tree.audience, false);
      timings.directorMs = Math.round(performance.now() - directorStarted);

      const dir = this.deps.store.nodeDir(node.id);
      await mkdir(dir, { recursive: true });
      const tag = newFileTag();
      const rawPath = join(dir, `raw-${tag}.mp4`);
      const clipPath = join(dir, `clip-${tag}.mp4`);
      const posterPath = join(dir, `poster-${tag}.jpg`);
      const lastFramePath = join(dir, `last-${tag}.jpg`);
      partialFiles = [rawPath, clipPath, posterPath, lastFramePath];

      const render = async (scene: Scene) => {
        if (!this.reserve(day, seconds, forced)) throw new GenerationError('budget_exhausted', MESSAGES.budget);
        reservedSeconds += seconds;
        return this.deps.video.render({
          prompt: scene.videoPrompt,
          caption: scene.caption,
          seconds,
          startFramePath: parent?.lastFramePath ? this.deps.store.absolute(parent.lastFramePath) : null,
          outPath: rawPath,
        });
      };

      const videoStarted = performance.now();
      let rendered;
      try {
        rendered = await render(draft.scene);
      } catch (err) {
        // The video model's own safety check said no. Ask the director for a gentler scene once.
        if (!(err instanceof VideoRejected) || draft.stricter) throw err;
        log.warn({ nodeId, error: err.message }, 'video provider rejected the scene, asking for a gentler one');
        directorStarted = performance.now();
        draft = await this.writeSafeScene(request, tree.audience, true);
        timings.directorMs += Math.round(performance.now() - directorStarted);
        rendered = await render(draft.scene);
      }
      videoMade = true;
      const scene = draft.scene;
      timings.videoMs = Math.round(performance.now() - videoStarted);
      if (rendered.inferenceMs !== null) timings.inferenceMs = rendered.inferenceMs;
      if (rendered.billedSeconds !== seconds) repo.addVideoSeconds(day, rendered.billedSeconds - seconds);
      reservedSeconds = 0;

      const mediaStarted = performance.now();
      const { media } = this.deps;
      await media.faststart(rawPath, clipPath);
      await rm(rawPath, { force: true });
      const durationMs = await media.probeDurationMs(clipPath);
      await media.poster(clipPath, posterPath, (durationMs / 1000) * 0.4);
      await media.lastFrame(clipPath, lastFramePath);
      timings.mediaMs = Math.round(performance.now() - mediaStarted);
      timings.totalMs = Math.round(performance.now() - started);

      const store = this.deps.store;
      repo.markReady(node.id, {
        ...scene,
        clipPath: store.relative(clipPath),
        posterPath: store.relative(posterPath),
        lastFramePath: store.relative(lastFramePath),
        durationMs,
        timings,
        costSeconds: rendered.billedSeconds,
      });
      log.info({ nodeId, treeId: node.treeId, depth: node.depth, timings }, 'scene ready');
      return 'ready';
    } catch (err) {
      if (reservedSeconds) repo.addVideoSeconds(day, -reservedSeconds);
      await Promise.all(partialFiles.map((file) => rm(file, { force: true })));
      const outcome = this.handleFailure(nodeId, err);
      // A family should not pay for a scene that never got as far as video.
      if (outcome === 'failed' && !videoMade) {
        const refund = repo.refundCharge(nodeId);
        if (refund) {
          log.info({ nodeId, daily: refund.daily, welcome: refund.welcome, sparks: refund.sparks }, 'refunded a failed private scene');
        }
      }
      return outcome;
    }
  }

  /** Books video seconds against today's cap and warns once spend crosses 80% of it. */
  private reserve(day: string, seconds: number, forced: boolean): boolean {
    const { repo, config, log } = this.deps;
    const cap = config.DAILY_VIDEO_SECONDS_CAP;
    const before = repo.spendSeconds(day);
    if (!repo.reserveVideoSeconds(day, seconds, forced ? Number.POSITIVE_INFINITY : cap)) return false;
    const warnAt = cap * BUDGET_WARNING_SHARE;
    if (before < warnAt && before + seconds >= warnAt) {
      log.warn({ day, spentSeconds: before + seconds, capSeconds: cap }, 'daily video spend passed 80% of the cap');
    }
    return true;
  }

  private handleFailure(nodeId: string, err: unknown): GenerateOutcome {
    const { repo, log } = this.deps;
    if (err instanceof GenerationError) {
      log.warn({ nodeId, code: err.code, error: err.message }, 'scene failed');
      repo.markFailed(nodeId, err.code === 'budget_exhausted' ? 'budget_exhausted' : 'generation_failed', err.userMessage);
      return 'failed';
    }
    if (err instanceof VideoRejected) {
      log.warn({ nodeId, error: err.message }, 'video provider rejected the gentler scene too');
      repo.markFailed(nodeId, 'generation_failed', MESSAGES.sceneUnsafe);
      return 'failed';
    }
    const outcome = repo.recordFailure(nodeId, MAX_ATTEMPTS, 'generation_failed', MESSAGES.sceneFailed);
    log.warn({ nodeId, outcome, ...errorDetails(err) }, outcome === 'retry' ? 'scene attempt failed, retrying' : 'scene failed');
    return outcome;
  }

  private async createBible(tree: TreeRecord, timings: NodeTimings): Promise<Bible> {
    const started = performance.now();
    const draft = await this.deps.director.createBible({
      prompt: tree.prompt ?? tree.logline,
      moods: tree.moods,
      audience: tree.audience,
      totalScenes: tree.totalScenes,
    });
    const bible = sanitizeBible({ ...draft, audience: tree.audience, moods: tree.moods });
    const verdict = await this.deps.safety.check(
      [bible.title, bible.logline, bible.setting, ...bible.characters.map((c) => `${c.name}: ${c.description}`)].join('\n'),
      { source: 'output', audience: tree.audience },
    );
    if (!verdict.ok) throw new GenerationError('unsafe_output', MESSAGES.sceneUnsafe, `bible failed safety: ${verdict.reason}`);
    this.deps.repo.setTreeBible(tree.id, bible);
    timings.bibleMs = Math.round(performance.now() - started);
    return bible;
  }

  private sceneRequest(tree: TreeRecord, bible: Bible, lineage: NodeRecord[]): SceneRequest {
    const node = lineage[lineage.length - 1]!;
    const ancestors = lineage.slice(0, -1);
    const cast: Character[] = [...bible.characters];
    for (const ancestor of ancestors) {
      for (const character of ancestor.newCharacters) {
        if (!cast.some((c) => c.name.toLowerCase() === character.name.toLowerCase())) cast.push(character);
      }
    }
    const history = ancestors.map((ancestor, i) => ({
      sceneNumber: ancestor.depth + 1,
      summary: ancestor.summary ?? '',
      caption: ancestor.caption ?? '',
      choiceTaken: choiceLabel(ancestor, lineage[i + 1]!),
    }));
    const parent = ancestors[ancestors.length - 1];
    let choice: SceneRequest['choice'] = null;
    if (node.customText) choice = { kind: 'custom', text: node.customText };
    else if (parent && node.choiceIndex !== null) {
      choice = { kind: 'preset', text: parent.choices[node.choiceIndex] ?? '' };
    }
    return {
      treeId: tree.id,
      pathKey: lineage.map((n) => n.id).join('/'),
      bible,
      cast,
      history,
      choice,
      sceneNumber: node.depth + 1,
      totalScenes: tree.totalScenes,
      sceneSeconds: this.deps.config.SCENE_SECONDS,
    };
  }

  private async writeSafeScene(
    request: SceneRequest,
    audience: Audience,
    startStricter: boolean,
  ): Promise<{ scene: Scene; stricter: boolean }> {
    const { director, safety, log } = this.deps;
    for (const stricter of startStricter ? [true] : [false, true]) {
      let draft: Scene;
      try {
        draft = await director.writeScene({ ...request, stricter });
      } catch (err) {
        if (err instanceof DirectorRefusal) {
          log.warn({ treeId: request.treeId, sceneNumber: request.sceneNumber, stricter }, 'director refused the scene');
          continue;
        }
        throw err;
      }
      const scene = sanitizeScene(draft, request.sceneNumber, request.totalScenes);
      const text = [scene.caption, scene.summary, ...scene.choices, scene.videoPrompt].join('\n');
      const verdict = await safety.check(text, { source: 'output', audience });
      if (verdict.ok) return { scene, stricter };
      log.warn({ treeId: request.treeId, sceneNumber: request.sceneNumber, stricter, reason: verdict.reason }, 'scene failed the safety check');
    }
    throw new GenerationError('unsafe_output', MESSAGES.sceneUnsafe);
  }
}

export function choiceLabel(parent: NodeRecord, child: NodeRecord): string | null {
  if (child.customText) return child.customText;
  if (child.choiceIndex === null) return null;
  return parent.choices[child.choiceIndex] ?? null;
}
