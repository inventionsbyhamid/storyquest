import type { Config } from '../config';
import type { Repository } from '../db/repo';
import { utcDay, type Bible, type IdeaRecord } from '../domain';
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

const CHECK_MS = 60_000;
const REFRESH_MS = 10 * 60_000;
const RETRY_MIN_MS = 10 * 60_000;
const RETRY_MAX_MS = 60 * 60_000;
const FEATURED_EXTRA = 3;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Makes sure today's shared stories exist. Concurrent calls share one run and
 * each (date, position) slot is filled once. When a run comes up short the
 * next one waits 10 minutes, doubling up to an hour, and requests never wait
 * on any of it.
 */
export class DailyIdeas {
  private readonly inflight = new Map<string, Promise<number>>();
  private timer: NodeJS.Timeout | null = null;
  private nextAttemptAt = 0;
  private failures = 0;
  private lastHealthyDate: string | null = null;

  constructor(private readonly deps: DailyIdeasDeps) {}

  today(): string {
    return utcDay(this.deps.now());
  }

  get retryState() {
    return {
      failures: this.failures,
      nextAttemptAt: this.nextAttemptAt ? new Date(this.nextAttemptAt).toISOString() : null,
    };
  }

  /** Runs now, ignoring the schedule. Used at boot, by the admin endpoint and by tests. */
  ensure(date: string = this.today()): Promise<number> {
    const running = this.inflight.get(date);
    if (running) return running;
    const run = this.attempt(date).finally(() => this.inflight.delete(date));
    this.inflight.set(date, run);
    return run;
  }

  /** A cheap nudge that only starts a run when the schedule allows one. Never awaited by requests. */
  kick(): void {
    if (!this.deps.config.DAILY_PLANNER) return;
    const date = this.today();
    if (this.inflight.has(date)) return;
    const newDay = this.failures === 0 && this.lastHealthyDate !== date;
    if (!newDay && this.deps.now().getTime() < this.nextAttemptAt) return;
    this.ensure(date).catch(() => {
      // Already logged and scheduled for a retry by attempt().
    });
  }

  start(): void {
    if (!this.deps.config.DAILY_PLANNER) {
      this.deps.log.info({}, 'daily planner is off, serving the stories that already exist');
      return;
    }
    this.kick();
    this.timer = setInterval(() => this.kick(), CHECK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * What Home shows: ideas from the last IDEA_LIFETIME_DAYS days, newest
   * first. If none of them can be played yet, the latest day that has playable
   * ones stands in. Featured ideas from earlier days follow.
   */
  listForHome(): { date: string; ideas: IdeaRecord[] } {
    const { repo, config } = this.deps;
    const today = this.today();
    const ready = (idea: IdeaRecord) => {
      const root = repo.getNode(idea.rootNodeId);
      return root?.status === 'ready' && !root.hiddenAt;
    };
    const hidden = (idea: IdeaRecord) => Boolean(repo.getNode(idea.rootNodeId)?.hiddenAt);
    // With the planner off nothing new arrives, so every playable story stays up whatever its age.
    const oldest = config.DAILY_PLANNER
      ? utcDay(new Date(this.deps.now().getTime() - (config.IDEA_LIFETIME_DAYS - 1) * DAY_MS))
      : '0000-01-01';

    let date = today;
    // Today's ideas show while their opening is still being made; older ones only once playable.
    let ideas = repo
      .listIdeasBetween(oldest, today)
      .filter((idea) => !idea.unlistedAt)
      .filter((idea) => (idea.date === today && !hidden(idea)) || ready(idea));
    if (!ideas.some(ready)) {
      const fallback = repo.latestDateWithReadyIdeas();
      if (fallback && fallback < oldest) {
        date = fallback;
        ideas = repo.listIdeas(fallback).filter((idea) => !idea.unlistedAt && ready(idea));
      }
    }

    if (!config.DAILY_PLANNER && ideas[0] && ideas[0].date !== today) date = ideas[0].date;

    const listed = new Set(ideas.map((idea) => idea.id));
    const featured = repo
      .listFeatured()
      .filter((idea) => idea.date < today && !listed.has(idea.id) && !idea.unlistedAt && ready(idea));
    const cap = config.DAILY_IDEAS * config.IDEA_LIFETIME_DAYS + FEATURED_EXTRA;
    return { date, ideas: [...ideas, ...featured].slice(0, cap) };
  }

  private async attempt(date: string): Promise<number> {
    try {
      const { created, problems } = await this.fill(date);
      if (problems.length) this.scheduleRetry(date, problems.join('; '));
      else {
        this.failures = 0;
        this.lastHealthyDate = date;
        this.nextAttemptAt = this.deps.now().getTime() + REFRESH_MS;
      }
      return created;
    } catch (err) {
      this.scheduleRetry(date, errorDetails(err).message);
      throw err;
    }
  }

  /** Story plans to choose from, written but not filmed. */
  async draftPlans(count: number, brief?: string): Promise<Bible[]> {
    const { config, director } = this.deps;
    const titles = this.listForHome().ideas.map((idea) => idea.title);
    return (await director.planIdeas(this.today(), count, titles, config.SCENES_PER_STORY, brief)).map(sanitizeBible);
  }

  /** Puts a chosen story plan on Home today and starts filming its opening. */
  async addIdea(plan: Bible): Promise<IdeaRecord> {
    const { config, repo, safety, engine, log } = this.deps;
    const bible = sanitizeBible(plan);
    const verdict = await safety.check(
      [bible.title, bible.logline, bible.setting, ...bible.characters.map((c) => c.description), ...(bible.outline ?? [])].join('\n'),
      { source: 'output', audience: bible.audience },
    );
    if (!verdict.ok) throw new Error(`the story plan failed the safety check: ${verdict.reason}`);
    const date = this.today();
    const idea = repo.createDailyIdea({
      date,
      position: repo.nextIdeaPosition(date),
      bible,
      totalScenes: bible.outline?.length || config.SCENES_PER_STORY,
      clipsPerChapter: config.CLIPS_PER_CHAPTER,
      warm: 0,
    });
    if (!idea) throw new Error('the story could not be added');
    engine.enqueue(idea.rootNodeId, 'high');
    log.info({ ideaId: idea.id, title: idea.title }, 'story added by an admin');
    return idea;
  }

  private scheduleRetry(date: string, reason: string): void {
    this.failures++;
    const delay = Math.min(RETRY_MIN_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
    this.nextAttemptAt = this.deps.now().getTime() + delay;
    this.deps.log.warn({ date, reason, failures: this.failures, retryInMs: delay }, 'daily ideas incomplete, will retry');
  }

  private async fill(date: string): Promise<{ created: number; problems: string[] }> {
    const { config, repo, director, safety, engine, log } = this.deps;
    const problems: string[] = [];
    const existing = repo.listIdeas(date);
    const failedRoots = this.retryRoots(existing);
    if (failedRoots) problems.push(`${failedRoots} opening scenes failed`);

    const taken = new Set(existing.map((idea) => idea.position));
    const missing = Array.from({ length: config.DAILY_IDEAS }, (_, i) => i).filter((position) => !taken.has(position));
    if (missing.length === 0) return { created: 0, problems };

    const started = Date.now();
    const plans = await director.planIdeas(
      date,
      missing.length,
      existing.map((idea) => idea.title),
      config.SCENES_PER_STORY,
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
        clipsPerChapter: config.CLIPS_PER_CHAPTER,
        warm: config.WARM_DEPTH,
      });
      if (!idea) continue;
      created++;
      engine.enqueue(idea.rootNodeId, 'high');
    }
    if (created < missing.length) problems.push(`${missing.length - created} ideas missing`);
    log.info({ date, created, ms: Date.now() - started }, 'daily ideas created');
    return { created, problems };
  }

  /** Requeues opening scenes that failed last time. Returns how many had failed. */
  private retryRoots(ideas: IdeaRecord[]): number {
    const { repo, engine } = this.deps;
    let failed = 0;
    for (const idea of ideas) {
      const root = repo.getNode(idea.rootNodeId);
      if (!root) continue;
      if (root.status === 'pending') engine.enqueue(root.id, 'high');
      else if (root.status === 'failed') {
        failed++;
        if (!engine.budgetExhausted() && repo.resetFailed(root.id)) engine.enqueue(root.id, 'high');
      }
    }
    return failed;
  }
}
