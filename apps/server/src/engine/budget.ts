import type { Config } from '../config';
import type { Repository, SpendSums } from '../db/repo';
import { utcDay } from '../domain';
import type { Logger } from '../log';
import type { DirectorCallContext, DirectorMeter } from '../providers/director/types';

export type BudgetLimit = 'daily_video' | 'total_video' | 'director_calls';

export class BudgetExhausted extends Error {
  override name = 'BudgetExhausted';

  constructor(readonly limit: BudgetLimit) {
    super(`budget exhausted: ${limit}`);
  }
}

export interface VideoReservation {
  day: string;
  seconds: number;
  nodeId: string | null;
  treeId: string | null;
  task: string;
  started: number;
}

export interface BudgetDeps {
  config: Config;
  repo: Repository;
  log: Logger;
  now: () => Date;
}

const WARNING_SHARE = 0.8;
const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Every paid call goes through here. Video seconds are reserved before a
 * render starts, against today's cap and the lifetime cap at once, and
 * director requests are counted before they are sent. The counters live in
 * SQLite, so a restart cannot reset what was spent.
 */
export class Budget implements DirectorMeter {
  constructor(private readonly deps: BudgetDeps) {}

  private today(): string {
    return utcDay(this.deps.now());
  }

  /** Which limit would stop the next scene, if any. Request handlers check this before creating work. */
  exhausted(options: { ignoreDaily?: boolean } = {}): BudgetLimit | null {
    const { config, repo } = this.deps;
    if (config.DIRECTOR_CALL_CAP > 0 && repo.getTotal('director_calls') >= config.DIRECTOR_CALL_CAP) return 'director_calls';
    const seconds = config.SCENE_SECONDS;
    if (config.TOTAL_VIDEO_SECONDS_CAP > 0 && repo.getTotal('video_seconds') + seconds > config.TOTAL_VIDEO_SECONDS_CAP) {
      return 'total_video';
    }
    if (!options.ignoreDaily && repo.spendSeconds(this.today()) + seconds > config.DAILY_VIDEO_SECONDS_CAP) return 'daily_video';
    return null;
  }

  /** Forced warming may go past the daily cap, never past the lifetime cap. */
  reserveVideo(
    seconds: number,
    context: { task: string; nodeId?: string | null; treeId?: string | null; forced?: boolean },
  ): VideoReservation {
    const { config, repo, log } = this.deps;
    const day = this.today();
    const dailyBefore = repo.spendSeconds(day);
    const totalBefore = repo.getTotal('video_seconds');
    const dailyCap = context.forced ? Number.POSITIVE_INFINITY : config.DAILY_VIDEO_SECONDS_CAP;
    const totalCap = config.TOTAL_VIDEO_SECONDS_CAP || Number.POSITIVE_INFINITY;
    const result = repo.reserveVideo(day, seconds, dailyCap, totalCap);
    if (result !== 'ok') {
      const limit: BudgetLimit = result === 'daily' ? 'daily_video' : 'total_video';
      log.warn({ limit, nodeId: context.nodeId, task: context.task }, 'video budget reached, nothing was rendered');
      throw new BudgetExhausted(limit);
    }
    this.warnPast('daily video seconds', dailyBefore, seconds, config.DAILY_VIDEO_SECONDS_CAP);
    this.warnPast('lifetime video seconds', totalBefore, seconds, config.TOTAL_VIDEO_SECONDS_CAP);
    return {
      day,
      seconds,
      nodeId: context.nodeId ?? null,
      treeId: context.treeId ?? null,
      task: context.task,
      started: Date.now(),
    };
  }

  /** The render finished, or failed after the provider started work, so it counts. */
  settleVideo(reservation: VideoReservation, billedSeconds: number, status: 'ok' | 'failed' | 'rejected'): void {
    const { repo } = this.deps;
    if (billedSeconds !== reservation.seconds) repo.adjustVideo(reservation.day, billedSeconds - reservation.seconds);
    repo.logSpend({
      kind: 'video',
      task: reservation.task,
      status,
      day: reservation.day,
      nodeId: reservation.nodeId,
      treeId: reservation.treeId,
      videoSeconds: billedSeconds,
      ms: Date.now() - reservation.started,
    });
  }

  /** The provider turned the request down before doing any work, so nothing is owed. */
  releaseVideo(reservation: VideoReservation): void {
    const { repo } = this.deps;
    repo.adjustVideo(reservation.day, -reservation.seconds);
    repo.logSpend({
      kind: 'video',
      task: reservation.task,
      status: 'released',
      day: reservation.day,
      nodeId: reservation.nodeId,
      treeId: reservation.treeId,
      ms: Date.now() - reservation.started,
    });
  }

  beginCall(context: DirectorCallContext): void {
    const { config, repo, log } = this.deps;
    const before = repo.getTotal('director_calls');
    if (!repo.reserveDirectorCall(config.DIRECTOR_CALL_CAP)) {
      log.warn({ task: context.task, nodeId: context.nodeId }, 'director call cap reached, nothing was sent');
      throw new BudgetExhausted('director_calls');
    }
    this.warnPast('director calls', before, 1, config.DIRECTOR_CALL_CAP);
  }

  endCall(context: DirectorCallContext, result: { inputTokens: number; outputTokens: number; ms: number; ok: boolean }): void {
    const { repo } = this.deps;
    repo.addTotal('input_tokens', result.inputTokens);
    repo.addTotal('output_tokens', result.outputTokens);
    repo.logSpend({
      kind: 'director',
      task: context.task,
      status: result.ok ? 'ok' : 'error',
      nodeId: context.nodeId,
      treeId: context.treeId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ms: result.ms,
    });
  }

  dollars(sums: SpendSums) {
    const { config } = this.deps;
    const video = sums.videoSeconds * config.VIDEO_PRICE_PER_SECOND;
    const director =
      (sums.inputTokens / 1_000_000) * config.BEDROCK_INPUT_PRICE_PER_MTOK +
      (sums.outputTokens / 1_000_000) * config.BEDROCK_OUTPUT_PRICE_PER_MTOK;
    return { videoUsd: round(video), directorUsd: round(director), totalUsd: round(video + director) };
  }

  summary(recent = 50) {
    const { config, repo } = this.deps;
    const day = this.today();
    const lifetime: SpendSums = {
      videoSeconds: repo.getTotal('video_seconds'),
      directorCalls: repo.getTotal('director_calls'),
      inputTokens: repo.getTotal('input_tokens'),
      outputTokens: repo.getTotal('output_tokens'),
    };
    // Today's video seconds come from the daily counter, which also holds renders in flight.
    const today: SpendSums = { ...repo.sumSpend({ day }), videoSeconds: repo.spendSeconds(day) };
    const left = (cap: number, used: number) => (cap > 0 ? Math.max(0, round(cap - used)) : null);
    return {
      lifetime: { ...lifetime, ...this.dollars(lifetime) },
      today: { date: day, ...today, ...this.dollars(today) },
      caps: {
        totalVideoSeconds: config.TOTAL_VIDEO_SECONDS_CAP || null,
        totalVideoSecondsLeft: left(config.TOTAL_VIDEO_SECONDS_CAP, lifetime.videoSeconds),
        directorCalls: config.DIRECTOR_CALL_CAP || null,
        directorCallsLeft: left(config.DIRECTOR_CALL_CAP, lifetime.directorCalls),
        dailyVideoSeconds: config.DAILY_VIDEO_SECONDS_CAP,
        dailyVideoSecondsLeft: Math.max(0, round(config.DAILY_VIDEO_SECONDS_CAP - today.videoSeconds)),
        exhausted: this.exhausted(),
      },
      prices: {
        videoPerSecond: config.VIDEO_PRICE_PER_SECOND,
        inputPerMillionTokens: config.BEDROCK_INPUT_PRICE_PER_MTOK,
        outputPerMillionTokens: config.BEDROCK_OUTPUT_PRICE_PER_MTOK,
      },
      recent: repo.listSpend(recent),
    };
  }

  private warnPast(what: string, before: number, added: number, cap: number): void {
    if (cap <= 0) return;
    const warnAt = cap * WARNING_SHARE;
    if (before < warnAt && before + added >= warnAt) {
      this.deps.log.warn({ what, used: before + added, cap }, `${what} passed 80% of the cap`);
    }
  }
}
