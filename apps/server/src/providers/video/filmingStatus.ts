import type { Logger } from '../../log';

const CHECK_MS = 60_000;
const OUT_OF_CREDIT_MS = 10 * 60_000;

export interface FilmingStatusOptions {
  /** A fal key allowed to read billing. Without one the balance is unknown and only render errors count. */
  billingKey?: string;
  minBalance: number;
  now: () => number;
  log: Logger;
  fetch?: typeof fetch;
}

/** Whether new clips can be filmed at all: the video account has credit left. */
export class FilmingStatus {
  private balance: number | null = null;
  private outUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: FilmingStatusOptions) {}

  available(): boolean {
    if (this.options.now() < this.outUntil) return false;
    return this.balance === null || this.balance >= this.options.minBalance;
  }

  /** The provider turned a render away for lack of credit, so stop taking new filming for a while. */
  markOutOfCredit(): void {
    this.outUntil = this.options.now() + OUT_OF_CREDIT_MS;
    this.options.log.warn({}, 'video account is out of credit, new filming is off for a while');
  }

  async refresh(): Promise<void> {
    const { billingKey, log } = this.options;
    if (!billingKey) return;
    try {
      const res = await (this.options.fetch ?? fetch)('https://api.fal.ai/v1/account/billing?expand=credits', {
        headers: { authorization: `Key ${billingKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { credits?: { current_balance?: number } };
      const balance = body.credits?.current_balance;
      if (typeof balance === 'number') this.balance = balance;
    } catch (err) {
      log.warn({ error: (err as Error).message }, 'could not read the video account balance');
    }
  }

  start(): void {
    if (!this.options.billingKey || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), CHECK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
