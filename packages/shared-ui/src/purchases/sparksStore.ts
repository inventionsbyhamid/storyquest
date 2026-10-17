import type { VerifyPurchaseRequest, VerifyPurchaseResponse, WalletView } from '@storyquest/contracts';
import type { RequestOptions } from '../api/client';
import { isTransient, toApiError } from '../api/errors';
import { sleep as defaultSleep } from '../api/sleep';
import { messages } from '../story/messages';
import type { IapKind, IapPurchaseResult, IapReceipt, IapService } from './types';

export interface SparksApi {
  getWallet(opts?: RequestOptions): Promise<WalletView>;
  verifyPurchase(input: VerifyPurchaseRequest, opts?: RequestOptions): Promise<VerifyPurchaseResponse>;
}

export interface SparksDeps {
  api: SparksApi;
  iap: IapService;
  setIdentity: (userId: string | null) => void;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface SparksSnapshot {
  ready: boolean;
  wallet: WalletView | null;
  prices: Record<string, string>;
  store: IapKind;
  canBuy: boolean;
}

export type BuyOutcome =
  | { kind: 'credited'; credited: number; wallet: WalletView }
  | { kind: 'cancelled'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'pending'; message: string };

const VERIFY_ATTEMPTS = 3;

export class SparksStore {
  private snapshot: SparksSnapshot = { ready: false, wallet: null, prices: {}, store: 'none', canBuy: false };
  private listeners = new Set<() => void>();
  private starting: Promise<void> | null = null;
  private simulatedRejected = false;
  private buying = false;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: SparksDeps) {
    this.sleep = deps.sleep ?? ((ms) => defaultSleep(ms));
    this.log = deps.log ?? ((message) => console.info(message));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SparksSnapshot => this.snapshot;

  start(): Promise<void> {
    if (!this.starting) this.starting = this.boot();
    return this.starting;
  }

  async resume(): Promise<void> {
    if (!this.starting) return;
    await this.starting;
    await this.processPending();
    await this.refreshWallet();
  }

  async refreshWallet(): Promise<WalletView | null> {
    try {
      const wallet = await this.deps.api.getWallet({ retries: 1 });
      this.setWallet(wallet);
      return wallet;
    } catch (error) {
      this.log(`[Sparks] wallet unavailable ${String(error)}`);
      return this.snapshot.wallet;
    }
  }

  // Picks up purchases that were paid for but never confirmed, for example after the app closed.
  async processPending(): Promise<void> {
    if (this.deps.iap.kind !== 'amazon') return;
    let receipts: IapReceipt[] = [];
    try {
      receipts = await this.deps.iap.pendingReceipts();
    } catch (error) {
      this.log(`[Sparks] purchase updates failed ${String(error)}`);
      return;
    }
    for (const receipt of receipts) await this.verifyAndFulfill(receipt);
  }

  async buy(sku: string): Promise<BuyOutcome> {
    if (!this.snapshot.canBuy) return { kind: 'failed', message: messages.purchasesUnavailable };
    if (this.buying) return { kind: 'failed', message: messages.purchaseStillOpen };
    this.buying = true;
    try {
      let result: IapPurchaseResult;
      try {
        result = await this.deps.iap.purchase(sku);
      } catch (error) {
        this.log(`[Sparks] purchase failed ${String(error)}`);
        return { kind: 'failed', message: messages.purchaseCancelled };
      }
      switch (result.status) {
        case 'purchased':
          return await this.verifyAndFulfill(result);
        case 'cancelled':
          return { kind: 'cancelled', message: messages.purchaseCancelled };
        case 'already_purchased':
          await this.processPending();
          return { kind: 'failed', message: messages.purchaseStillOpen };
        default:
          return { kind: 'failed', message: messages.purchasesUnavailable };
      }
    } finally {
      this.buying = false;
    }
  }

  // Sparks are credited by the server first; Amazon only hears "fulfilled" after that succeeds.
  private async verifyAndFulfill(receipt: IapReceipt): Promise<BuyOutcome> {
    const request: VerifyPurchaseRequest = {
      receiptId: receipt.receiptId,
      userId: receipt.userId,
      sku: receipt.sku,
      ...(receipt.marketplace ? { marketplace: receipt.marketplace } : {}),
    };
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.deps.api.verifyPurchase(request);
        this.setWallet(response.wallet);
        try {
          await this.deps.iap.fulfill(receipt.receiptId);
        } catch (error) {
          // Credited already; the receipt comes back on the next launch and is fulfilled then.
          this.log(`[Sparks] fulfillment not confirmed ${String(error)}`);
        }
        this.log(`[Sparks] credited ${response.credited}${response.alreadyProcessed ? ' (already processed)' : ''}`);
        return { kind: 'credited', credited: response.credited, wallet: response.wallet };
      } catch (error) {
        const apiError = toApiError(error);
        if (apiError.code === 'purchase_invalid') {
          if (this.deps.iap.kind === 'simulated') {
            this.simulatedRejected = true;
            this.publish({});
            return { kind: 'failed', message: messages.purchasesUnavailable };
          }
          // Left unfulfilled on purpose so a fixed server can still credit it later.
          return { kind: 'failed', message: messages.purchaseInvalid };
        }
        if (!isTransient(apiError) || attempt >= VERIFY_ATTEMPTS) {
          return { kind: 'pending', message: messages.sparksPending };
        }
        await this.sleep(800 * attempt);
      }
    }
  }

  private async boot(): Promise<void> {
    const { iap } = this.deps;
    let userId: string | null = null;
    try {
      userId = (await iap.init())?.userId ?? null;
    } catch (error) {
      this.log(`[Sparks] store unavailable ${String(error)}`);
    }
    this.deps.setIdentity(userId);
    this.publish({ store: iap.kind });
    const wallet = await this.refreshWallet();
    if (wallet && iap.kind === 'amazon') {
      try {
        const products = await iap.getProducts(wallet.products.map((product) => product.sku));
        const prices: Record<string, string> = {};
        for (const product of Object.values(products)) if (product.price) prices[product.sku] = product.price;
        this.publish({ prices });
      } catch (error) {
        this.log(`[Sparks] product data unavailable ${String(error)}`);
      }
    }
    this.publish({ ready: true });
    await this.processPending();
  }

  private setWallet(wallet: WalletView): void {
    this.publish({ wallet });
  }

  private publish(change: Partial<SparksSnapshot>): void {
    const next = { ...this.snapshot, ...change };
    next.canBuy =
      !!next.wallet?.purchasesEnabled &&
      next.wallet.products.length > 0 &&
      next.store !== 'none' &&
      !(next.store === 'simulated' && this.simulatedRejected);
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
