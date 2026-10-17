import type { Config } from '../config';
import type { Repository } from '../db/repo';
import { utcDay, type IdeaRecord } from '../domain';
import { errorDetails, type Logger } from '../log';
import type { Director } from '../providers/director/types';
import type { SafetyChecker } from '../providers/safety/types';
import type { StoryEngine } from './engine';
import { sanitizeBible } from './scenes';

export interface DailyIdeasDeps {
  config: Config;
  repo: Repository;
  director: Director;
  safety: SafetyChecker;
  engine: StoryEngine;
  log: Logger;
  now: () => Date;
}

const REFRESH_MS = 10 * 60_000;

/**
 * Makes sure today's shared stories exist. Safe to call as often as you like:
 * concurrent calls share one run, and each (date, position) slot is filled once.
 */
export class DailyIdeas {
  private readonly inflight = new Map<string, Promise<number>>();
  private timer: NodeJS.Timeout | null = null;
  private lastKick = 0;

  constructor(private readonly deps: DailyIdeasDeps) {}

  today(): string {
    return utcDay(this.deps.now());
  }

  ensure(date: string = this.today()): Promise<number> {
    const running = this.inflight.get(date);
    if (running) return running;
    const run = this.fill(date).finally(() => this.inflight.delete(date));
    this.inflight.set(date, run);
    return run;
  }

  /** A cheap nudge from request handlers, at most once a minute. */
  kick(): void {
    if (Date.now() - this.lastKick < 60_000) return;
    this.lastKick = Date.now();
    this.ensure().catch((err: unknown) => this.deps.log.error(errorDetails(err), 'daily ideas run failed'));
  }

  start(): void {
    const tick = () => {
      this.ensure().catch((err: unknown) => this.deps.log.error(errorDetails(err), 'daily ideas run failed'));
    };
    tick();
    this.timer = setInterval(tick, REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async fill(date: string): Promise<number> {
    const { config, repo, director, safety, engine, log } = this.deps;
    const existing = repo.listIdeas(date);
    this.retryRoots(existing);

    const taken = new Set(existing.map((idea) => idea.position));
    const missing = Array.from({ length: config.DAILY_IDEAS }, (_, i) => i).filter((position) => !taken.has(position));
    if (missing.length === 0) return 0;

    const started = Date.now();
    const plans = await director.planIdeas(
      date,
      missing.length,
      existing.map((idea) => idea.title),
    );

    let created = 0;
    for (const [i, plan] of plans.slice(0, missing.length).entries()) {
      const bible = sanitizeBible(plan);
      const verdict = await safety.check(
        [bible.title, bible.logline, bible.setting, ...bible.characters.map((c) => c.description)].join('\n'),
        { source: 'output', audience: bible.audience },
      );
      if (!verdict.ok) {
        log.warn({ date, title: bible.title, reason: verdict.reason }, 'planned idea failed the safety check');
        continue;
      }
      const idea = repo.createDailyIdea({
        date,
        position: missing[i]!,
        bible,
        totalScenes: config.SCENES_PER_STORY,
        warm: config.WARM_DEPTH,
      });
      if (!idea) continue;
      created++;
      engine.enqueue(idea.rootNodeId, 'high');
    }
    log.info({ date, created, ms: Date.now() - started }, 'daily ideas created');
    return created;
  }

  private retryRoots(ideas: IdeaRecord[]): void {
    const { repo, engine } = this.deps;
    for (const idea of ideas) {
      const root = repo.getNode(idea.rootNodeId);
      if (!root) continue;
      if (root.status === 'pending') engine.enqueue(root.id, 'high');
      else if (root.status === 'failed' && !engine.budgetExhausted() && repo.resetFailed(root.id)) {
        engine.enqueue(root.id, 'high');
      }
    }
  }
}
