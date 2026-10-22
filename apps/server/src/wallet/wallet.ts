import type { VerifyPurchaseRequest, VerifyPurchaseResponse, WalletView } from '@storyquest/contracts';
import type { Config } from '../config';
import type { Repository } from '../db/repo';
import { utcDay, type Charge, type WalletRecord } from '../domain';
import { AppError, MESSAGES, paymentRequired, purchaseInvalid, rateLimited } from '../engine/errors';
import type { Logger } from '../log';
import {
  ReceiptRejected,
  ReceiptServiceUnavailable,
  shortReceipt,
  type AmazonReceipt,
  type ReceiptVerifier,
} from './receipts';

export interface WalletDeps {
  config: Config;
  repo: Repository;
  verifier: ReceiptVerifier | null;
  log: Logger;
  now: () => Date;
  /** Whether the free filming budget has room. Free Sparks are only spent while it does; past it, families buy Sparks. */
  freeFilming?: () => boolean;
}

/** Who is paying: the TV, and the Amazon account on it when the app knows it. */
export interface Payer {
  deviceId: string | null;
  userId: string | null;
}

/**
 * Sparks belong to the Amazon IAP user id, so they follow a family to every TV
 * on that account. A TV without one gets a device wallet. The welcome scene is
 * granted once per TV: when an Amazon account first shows up on a TV, whatever
 * is left of that TV's welcome scene moves into the account's wallet.
 */
export class Wallet {
  constructor(private readonly deps: WalletDeps) {}

  private today(): string {
    return utcDay(this.deps.now());
  }

  private walletFor(payer: Payer): WalletRecord {
    const { repo, config } = this.deps;
    return repo.transaction(() => {
      const deviceKey = payer.deviceId ? `device:${payer.deviceId}` : null;
      if (!payer.userId) {
        if (!deviceKey) throw new Error('a wallet needs a device id or an Amazon user id');
        return repo.getWallet(deviceKey) ?? repo.createWallet(deviceKey, config.WELCOME_FREE_SPARKS);
      }
      const userKey = `user:${payer.userId}`;
      const existing = repo.getWallet(userKey);
      if (existing) return existing;
      if (!deviceKey) return repo.createWallet(userKey, config.WELCOME_FREE_SPARKS);
      const device = repo.getWallet(deviceKey) ?? repo.createWallet(deviceKey, config.WELCOME_FREE_SPARKS);
      if (device.freeSparks > 0) repo.changeWallet(deviceKey, { freeSparks: -device.freeSparks });
      return repo.createWallet(userKey, device.freeSparks);
    });
  }

  private freeOpen(): boolean {
    return this.deps.freeFilming?.() ?? true;
  }

  private dailyFreeLeft(deviceId: string | null): number {
    if (!deviceId || !this.freeOpen()) return 0;
    const used = this.deps.repo.getUsage(this.today(), deviceId).freeUsed;
    return Math.max(0, this.deps.config.DAILY_FREE_SPARKS - used);
  }

  /** The welcome scene can be held back until a TV has watched a few shared scenes. */
  private welcomeLeft(wallet: WalletRecord, deviceId: string | null): number {
    if (!this.freeOpen()) return 0;
    const needed = this.deps.config.FREE_SPARK_UNLOCK_AFTER_SCENES;
    if (needed > 0 && (!deviceId || this.deps.repo.scenesSeen(deviceId) < needed)) return 0;
    return wallet.freeSparks;
  }

  view(payer: Payer): WalletView {
    const { config } = this.deps;
    const wallet = this.walletFor(payer);
    return {
      sparks: wallet.sparks,
      freeSparks: this.welcomeLeft(wallet, payer.deviceId) + this.dailyFreeLeft(payer.deviceId),
      sceneCost: config.SCENE_COST_SPARKS,
      products: config.sparkProducts,
      purchasesEnabled: config.purchasesEnabled,
    };
  }

  canAfford(payer: Payer): boolean {
    const wallet = this.walletFor(payer);
    const available = wallet.sparks + this.welcomeLeft(wallet, payer.deviceId) + this.dailyFreeLeft(payer.deviceId);
    return available >= this.deps.config.SCENE_COST_SPARKS;
  }

  /**
   * Pays for one private scene: today's free Sparks first, then the welcome
   * scene, then bought Sparks. Call it inside the transaction that puts the
   * scene on the story, so either both happen or neither does.
   */
  charge(payer: Payer & { deviceId: string }): Charge {
    const { config, repo } = this.deps;
    return repo.transaction(() => {
      const day = this.today();
      if (repo.getUsage(day, payer.deviceId).customCount >= config.DEVICE_DAILY_CUSTOM_LIMIT) {
        throw rateLimited(MESSAGES.customLimit);
      }
      const wallet = this.walletFor(payer);
      let due = config.SCENE_COST_SPARKS;
      const daily = Math.min(this.dailyFreeLeft(payer.deviceId), due);
      due -= daily;
      const welcome = Math.min(this.welcomeLeft(wallet, payer.deviceId), due);
      due -= welcome;
      if (wallet.sparks < due) throw paymentRequired();

      repo.addUsage(day, payer.deviceId, { custom: 1, freeUsed: daily });
      if (welcome || due) repo.changeWallet(wallet.key, { freeSparks: -welcome, freeSpent: welcome, sparks: -due, spent: due });
      return { day, deviceId: payer.deviceId, walletKey: wallet.key, daily, welcome, sparks: due };
    });
  }

  /**
   * Credits Sparks for a receipt exactly once. A receipt that was already
   * credited answers with alreadyProcessed, so the app can safely mark the
   * purchase fulfilled again after a crash or a lost response.
   */
  async verifyPurchase(deviceId: string | null, request: VerifyPurchaseRequest): Promise<VerifyPurchaseResponse> {
    const { config, repo, verifier, log } = this.deps;
    if (!config.purchasesEnabled || !verifier) throw new AppError('purchase_invalid', 503, MESSAGES.purchasesOff);
    const payer: Payer = { deviceId, userId: request.userId };

    const product = config.sparkProducts.find((candidate) => candidate.sku === request.sku);
    if (!product) {
      log.warn({ sku: request.sku }, 'purchase for an unknown product');
      throw purchaseInvalid();
    }

    const existing = repo.getPurchase(request.receiptId);
    if (existing) {
      if (existing.userId !== request.userId || existing.sku !== request.sku) throw purchaseInvalid();
      return { wallet: this.view(payer), credited: 0, alreadyProcessed: true };
    }

    let verified;
    try {
      verified = await verifier.verify(request);
    } catch (err) {
      if (err instanceof ReceiptRejected) throw purchaseInvalid();
      if (err instanceof ReceiptServiceUnavailable) throw new AppError('internal', 503, MESSAGES.purchaseUnreachable);
      throw err;
    }

    const problem = receiptProblem(verified.receipt, request);
    if (problem) {
      log.warn({ receipt: shortReceipt(request.receiptId), sku: request.sku, problem }, 'receipt does not match the purchase');
      throw purchaseInvalid();
    }

    const wallet = this.walletFor(payer);
    const credited = repo.creditPurchase(wallet.key, {
      receiptId: request.receiptId,
      userId: request.userId,
      sku: product.sku,
      sparks: product.sparks,
      mode: verifier.mode,
      testTransaction: verified.receipt.testTransaction,
      raw: verified.raw,
    });
    log.info(
      { receipt: shortReceipt(request.receiptId), sku: product.sku, sparks: product.sparks, mode: verifier.mode, credited },
      credited ? 'sparks credited' : 'receipt was already credited',
    );
    return { wallet: this.view(payer), credited: credited ? product.sparks : 0, alreadyProcessed: !credited };
  }
}

export function receiptProblem(receipt: AmazonReceipt, request: VerifyPurchaseRequest): string | null {
  if (receipt.productId !== request.sku) return `product ${receipt.productId} does not match ${request.sku}`;
  if (receipt.productType !== 'CONSUMABLE') return `product type is ${receipt.productType}`;
  if (receipt.cancelDate !== null) return 'purchase was cancelled';
  if (receipt.quantity !== null && receipt.quantity !== 1) return `quantity is ${receipt.quantity}`;
  return null;
}
