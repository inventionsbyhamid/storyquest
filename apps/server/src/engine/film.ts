import type { Repository } from '../db/repo';
import { continuesChapter, type NodeRecord, type NodeStatus } from '../domain';
import { newId } from '../ids';
import { errorDetails, type Logger } from '../log';
import type { Budget } from './budget';
import type { StoryEngine } from './engine';
import { badRequest, conflict, MESSAGES, notFound, notReady, pathClosed } from './errors';

export interface FilmStep {
  nodeId: string;
  depth: number;
  choiceIndex: number | null;
  sibling: boolean;
  /** Already filmed before this job, so it cost nothing now. */
  reused: boolean;
  status: NodeStatus | 'closed';
  error: string | null;
}

interface Job {
  id: string;
  kind: 'film' | 'redo';
  status: 'running' | 'done' | 'failed';
  ideaId: string | null;
  nodeId: string | null;
  path: number[];
  siblings: boolean;
  previews: boolean;
  steps: FilmStep[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AdminJobsDeps {
  repo: Repository;
  engine: StoryEngine;
  budget: Budget;
  log: Logger;
  now: () => Date;
}

const WAIT_MS = 15_000;

/**
 * Admin jobs that film chosen paths or film one scene again. They run in the
 * background through the normal scene queue, so every cap still applies, and
 * report progress and cost while they run.
 */
export class AdminJobs {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly deps: AdminJobsDeps) {}

  get(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw notFound();
    return this.view(job);
  }

  startFilm(ideaId: string, path: number[], siblings: boolean, previews = false) {
    const { repo } = this.deps;
    const idea = repo.getIdea(ideaId);
    if (!idea) throw notFound();
    const tree = repo.getTree(idea.treeId)!;
    if (path.length > tree.totalScenes - 1) throw badRequest(`${MESSAGES.badRequest} The path is longer than the story.`);
    const root = repo.getNode(idea.rootNodeId)!;
    if (root.hiddenAt) throw pathClosed();

    const job = this.create('film', { ideaId, path, siblings, previews });
    this.run(job, () => this.film(job, root));
    return this.view(job);
  }

  startRedo(nodeId: string) {
    const { repo, engine } = this.deps;
    const node = repo.getNode(nodeId);
    if (!node) throw notFound();
    if (node.status !== 'ready' || node.deletedAt) throw notReady();
    if (repo.countFilmedChildren(node.id) > 0) throw conflict(MESSAGES.redoRefused);

    const job = this.create('redo', { nodeId });
    const step = this.step(job, node, node.choiceIndex, false);
    step.reused = false;
    step.status = 'generating';
    this.run(job, async () => {
      const { node: redone } = await engine.redo(nodeId);
      step.status = redone.status;
    });
    return this.view(job);
  }

  private create(kind: Job['kind'], fields: { ideaId?: string; nodeId?: string; path?: number[]; siblings?: boolean; previews?: boolean }): Job {
    const job: Job = {
      id: newId('jb'),
      kind,
      status: 'running',
      ideaId: fields.ideaId ?? null,
      nodeId: fields.nodeId ?? null,
      path: fields.path ?? [],
      siblings: fields.siblings ?? false,
      previews: fields.previews ?? false,
      steps: [],
      error: null,
      startedAt: this.deps.now().toISOString(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private run(job: Job, work: () => Promise<void>): void {
    const { log } = this.deps;
    work()
      .then(() => {
        job.status = 'done';
      })
      .catch((err: unknown) => {
        job.status = 'failed';
        job.error = errorDetails(err).message;
        log.warn({ jobId: job.id, kind: job.kind, error: job.error }, 'admin job stopped');
      })
      .finally(() => {
        job.finishedAt = this.deps.now().toISOString();
        log.info({ jobId: job.id, kind: job.kind, status: job.status, cost: this.view(job).cost }, 'admin job finished');
      });
  }

  /** Films the rest of the chapter that starts at this node, clip after clip. */
  private async finishChapter(job: Job, start: NodeRecord): Promise<NodeRecord> {
    let node = start;
    while (continuesChapter(node)) {
      node = await this.make(job, this.deps.repo.getOrCreateContinuation(node).node, 0, false);
    }
    return node;
  }

  /**
   * Films the path: whole chapters along it, and with siblings only the first clip of
   * each other choice, so its card has a picture. With previews the choices where the
   * path stops get their first clip too. The rest is filmed when a family picks them.
   */
  private async film(job: Job, root: NodeRecord): Promise<void> {
    const { repo } = this.deps;
    const siblings: Promise<NodeRecord>[] = [];
    let node = await this.finishChapter(job, await this.make(job, root, null, false));
    for (const index of job.path) {
      if (node.isEnding) throw new Error('the story ends before this path does');
      if (index >= node.choices.length) throw new Error(`scene ${node.depth + 1} has no choice ${index}`);
      if (job.siblings) {
        for (let other = 0; other < node.choices.length; other++) {
          if (other === index) continue;
          const sibling = this.make(job, repo.getOrCreatePresetChild(node, other, 0).node, other, true);
          sibling.catch(() => {});
          siblings.push(sibling);
        }
      }
      node = await this.finishChapter(job, await this.make(job, repo.getOrCreatePresetChild(node, index, 0).node, index, false));
    }
    if (job.previews && !node.isEnding) {
      node.choices.forEach((_label, index) => {
        const preview = this.make(job, repo.getOrCreatePresetChild(node, index, 0).node, index, true);
        preview.catch(() => {});
        siblings.push(preview);
      });
    }
    const results = await Promise.allSettled(siblings);
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed) throw new Error(`${failed} of the other choices could not be filmed`);
  }

  /** Makes sure one scene is filmed, waiting for it through the queue. */
  private async make(job: Job, node: NodeRecord, choiceIndex: number | null, sibling: boolean): Promise<NodeRecord> {
    const { repo, engine } = this.deps;
    const step = this.step(job, node, choiceIndex, sibling);
    if (node.hiddenAt) {
      step.status = 'closed';
      throw new Error('that path is closed');
    }
    if (node.status === 'ready') return node;
    if (node.status === 'failed') repo.resetFailed(node.id);
    engine.enqueue(node.id, 'high');
    for (;;) {
      const current = await engine.waitForNode(node.id, WAIT_MS);
      if (!current) throw new Error('the scene disappeared');
      step.status = current.status;
      if (current.status === 'ready') return current;
      if (current.status === 'failed') {
        step.error = current.error;
        throw new Error(current.error ?? 'the scene could not be made');
      }
      if (engine.isStopping) throw new Error('the server is shutting down');
    }
  }

  private step(job: Job, node: NodeRecord, choiceIndex: number | null, sibling: boolean): FilmStep {
    const step: FilmStep = {
      nodeId: node.id,
      depth: node.depth,
      choiceIndex,
      sibling,
      reused: node.status === 'ready',
      status: node.status,
      error: null,
    };
    job.steps.push(step);
    return step;
  }

  private view(job: Job) {
    const { repo, budget } = this.deps;
    const made = job.steps.filter((step) => !step.reused).map((step) => step.nodeId);
    const sums = repo.sumSpend({ nodeIds: made, since: job.startedAt });
    return {
      ...job,
      path: [...job.path],
      steps: job.steps.map((step) => ({ ...step })),
      cost: { ...sums, ...budget.dollars(sums) },
    };
  }
}
