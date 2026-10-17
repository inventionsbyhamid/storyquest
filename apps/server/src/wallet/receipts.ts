import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import type { Logger } from '../log';

export interface AmazonReceipt {
  productId: string;
  receiptId: string;
  productType: string;
  purchaseDate: number | null;
  cancelDate: number | null;
  quantity: number | null;
  testTransaction: boolean;
}

export interface VerifiedReceipt {
  receipt: AmazonReceipt;
  /** The response body as Amazon sent it, kept with the purchase for support questions. */
  raw: string;
}

export interface ReceiptVerifier {
  readonly mode: 'fake' | 'sandbox' | 'production';
  verify(input: { userId: string; receiptId: string; sku: string }): Promise<VerifiedReceipt>;
}

/** Amazon says the receipt is not good: invalid, cancelled, wrong user or a bad shared secret. */
export class ReceiptRejected extends Error {
  override name = 'ReceiptRejected';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Amazon could not be reached or kept failing. The app keeps the purchase and tries again later. */
export class ReceiptServiceUnavailable extends Error {
  override name = 'ReceiptServiceUnavailable';
}

const ReceiptSchema = z
  .object({
    productId: z.string(),
    receiptId: z.string(),
    productType: z.string(),
    purchaseDate: z.number().nullish(),
    cancelDate: z.number().nullish(),
    quantity: z.number().nullish(),
    testTransaction: z.boolean().nullish(),
  })
  .passthrough();

const REJECTIONS: Record<number, string> = {
  400: 'the receipt is invalid or unknown',
  410: 'the receipt was cancelled',
  496: 'the shared secret was rejected',
  497: 'the user id was rejected',
};

export const RVS_HOST = 'https://appstore-sdk.amazon.com';

// https://developer.amazon.com/docs/vega/0.22/vega-rvs-overview
// https://developer.amazon.com/docs/vega/0.21/rvs-cloud (App Tester sandbox)
export function rvsUrl(mode: 'sandbox' | 'production', sharedSecret: string, userId: string, receiptId: string): string {
  const base = mode === 'sandbox' ? `${RVS_HOST}/sandbox` : RVS_HOST;
  const part = encodeURIComponent;
  return `${base}/version/1.0/verifyReceiptId/developer/${part(sharedSecret)}/user/${part(userId)}/receiptId/${part(receiptId)}`;
}

/** Enough of a receipt id to find it in logs without printing the whole thing. */
export const shortReceipt = (receiptId: string) => `${receiptId.slice(0, 10)}\u2026`;

/** Development and test mode: accepts receipts whose id starts with "fake-" and nothing else. */
export class FakeReceiptVerifier implements ReceiptVerifier {
  readonly mode = 'fake';

  constructor(private readonly now: () => Date = () => new Date()) {}

  async verify(input: { userId: string; receiptId: string; sku: string }): Promise<VerifiedReceipt> {
    if (!input.receiptId.startsWith('fake-')) throw new ReceiptRejected(400, 'fake mode only accepts fake receipts');
    const receipt: AmazonReceipt = {
      productId: input.sku,
      receiptId: input.receiptId,
      productType: 'CONSUMABLE',
      purchaseDate: this.now().getTime(),
      cancelDate: null,
      quantity: 1,
      testTransaction: true,
    };
    return { receipt, raw: JSON.stringify(receipt) };
  }
}

export interface AmazonReceiptVerifierOptions {
  mode: 'sandbox' | 'production';
  sharedSecret: string;
  timeoutMs?: number;
  retryDelayMs?: number;
}

/** Calls the Amazon Receipt Verification Service. The shared secret is part of the URL, so the URL is never logged. */
export class AmazonReceiptVerifier implements ReceiptVerifier {
  readonly mode: 'sandbox' | 'production';

  constructor(
    private readonly options: AmazonReceiptVerifierOptions,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.mode = options.mode;
  }

  async verify(input: { userId: string; receiptId: string }): Promise<VerifiedReceipt> {
    const url = rvsUrl(this.mode, this.options.sharedSecret, input.userId, input.receiptId);
    const receipt = shortReceipt(input.receiptId);
    let lastProblem = 'no response';

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await sleep(this.options.retryDelayMs ?? 1_000);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        });
      } catch (err) {
        lastProblem = (err as Error).name === 'TimeoutError' ? 'timed out' : 'network error';
        this.log.warn({ mode: this.mode, receipt, attempt, problem: lastProblem }, 'receipt verification call failed');
        continue;
      }

      if (response.status === 200) {
        const raw = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new ReceiptServiceUnavailable('receipt service answered with something that is not JSON');
        }
        const parsed = ReceiptSchema.safeParse(body);
        if (!parsed.success) throw new ReceiptServiceUnavailable('receipt service answered with an unexpected shape');
        const data = parsed.data;
        this.log.info(
          { mode: this.mode, receipt, productId: data.productId, testTransaction: data.testTransaction ?? false },
          'receipt verified',
        );
        return {
          raw,
          receipt: {
            productId: data.productId,
            receiptId: data.receiptId,
            productType: data.productType,
            purchaseDate: data.purchaseDate ?? null,
            cancelDate: data.cancelDate ?? null,
            quantity: data.quantity ?? null,
            testTransaction: data.testTransaction ?? false,
          },
        };
      }

      await response.body?.cancel().catch(() => {});
      if (response.status >= 500 || response.status === 429) {
        lastProblem = `status ${response.status}`;
        this.log.warn({ mode: this.mode, receipt, attempt, status: response.status }, 'receipt service unavailable');
        continue;
      }

      const reason = REJECTIONS[response.status] ?? `unexpected status ${response.status}`;
      if (response.status === 496) this.log.error({ mode: this.mode }, 'Amazon rejected the IAP shared secret');
      else this.log.warn({ mode: this.mode, receipt, status: response.status, reason }, 'receipt rejected');
      throw new ReceiptRejected(response.status, reason);
    }

    throw new ReceiptServiceUnavailable(`receipt service unavailable: ${lastProblem}`);
  }
}
