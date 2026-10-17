import type { Logger } from '../log';

export type Priority = 'high' | 'low';

/**
 * In process work queue keyed by node id. A node is never queued or run twice
 * at once, and a high priority enqueue moves a waiting low priority job forward.
 */
export class JobQueue {
  private readonly high: string[] = [];
  private readonly low: string[] = [];
  private readonly queued = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  private closed = false;

  constructor(
    private readonly concurrency: number,
    private readonly worker: (id: string) => Promise<void>,
    private readonly log: Logger,
  ) {}

  enqueue(id: string, priority: Priority = 'low'): void {
    if (this.closed || this.running.has(id)) return;
    if (this.queued.has(id)) {
      if (priority === 'high') {
        const index = this.low.indexOf(id);
        if (index !== -1) {
          this.low.splice(index, 1);
          this.high.push(id);
        }
      }
      return;
    }
    this.queued.add(id);
    (priority === 'high' ? this.high : this.low).push(id);
    this.pump();
  }

  get size(): { queued: number; running: number } {
    return { queued: this.queued.size, running: this.running.size };
  }

  /** Stops starting new jobs and waits for running ones, up to the timeout. */
  async close(timeoutMs: number): Promise<boolean> {
    this.closed = true;
    this.high.length = 0;
    this.low.length = 0;
    this.queued.clear();
    if (this.running.size === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const done = Promise.allSettled([...this.running.values()]).then(() => true);
    const finished = await Promise.race([done, timeout]);
    clearTimeout(timer);
    return finished;
  }

  /** Resolves once nothing is queued or running. Used by tests and the admin endpoint. */
  async idle(pollMs = 25): Promise<void> {
    while (this.queued.size > 0 || this.running.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  private pump(): void {
    while (!this.closed && this.running.size < this.concurrency) {
      const id = this.high.shift() ?? this.low.shift();
      if (!id) return;
      this.queued.delete(id);
      const job = this.worker(id)
        .catch((err: unknown) => this.log.error({ nodeId: id, error: (err as Error).message }, 'job crashed'))
        .finally(() => {
          this.running.delete(id);
          this.pump();
        });
      this.running.set(id, job);
    }
  }
}
