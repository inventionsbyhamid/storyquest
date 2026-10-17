import type * as Iap from '@amazon-devices/keplerscript-appstore-iap-lib';
import { SimulatedIap } from './simulatedIap';
import type { IapKind, IapProduct, IapPurchaseResult, IapReceipt, IapService, IapUser } from './types';

type IapLib = typeof Iap;

const USER_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 10000;
const PURCHASE_TIMEOUT_MS = 5 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function loadLib(): IapLib | null {
  try {
    // Loaded lazily: the native module is missing on devices without the IAP service.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@amazon-devices/keplerscript-appstore-iap-lib') as IapLib;
  } catch (error) {
    console.warn('[IAP] library unavailable', error);
    return null;
  }
}

function entriesOf<T>(data: Map<string, T> | Record<string, T> | null | undefined): Array<[string, T]> {
  if (!data) return [];
  return data instanceof Map ? Array.from(data.entries()) : Object.entries(data);
}

// Amazon In App Purchasing on Vega. Falls back to simulated purchases when the IAP service is
// missing (for example on a Virtual Device) so a server in fake mode can still be demoed.
class AmazonIap implements IapService {
  kind: IapKind = 'none';
  private lib: IapLib | null = null;
  private user: IapUser | null = null;
  private fallback: SimulatedIap | null = null;

  async init(): Promise<IapUser | null> {
    this.lib = loadLib();
    if (this.lib) {
      try {
        const { PurchasingService, UserDataResponseCode } = this.lib;
        const response = await withTimeout(PurchasingService.getUserData({}), USER_TIMEOUT_MS, 'getUserData');
        if (response.responseCode === UserDataResponseCode.SUCCESSFUL && response.userData?.userId) {
          this.kind = 'amazon';
          this.user = { userId: response.userData.userId, marketplace: response.userData.marketplace ?? null };
          console.info('[IAP] ready', this.user.marketplace ?? '');
          return this.user;
        }
        console.warn('[IAP] getUserData returned', response.responseCode);
      } catch (error) {
        console.warn('[IAP] getUserData failed', error);
      }
    }
    this.fallback = new SimulatedIap();
    this.kind = 'simulated';
    return this.fallback.init();
  }

  async getProducts(skus: string[]): Promise<Record<string, IapProduct>> {
    if (this.fallback) return this.fallback.getProducts();
    if (!this.lib || skus.length === 0) return {};
    const { PurchasingService, ProductDataResponseCode } = this.lib;
    const response = await withTimeout(PurchasingService.getProductData({ skus }), CALL_TIMEOUT_MS, 'getProductData');
    if (response.responseCode !== ProductDataResponseCode.SUCCESSFUL) return {};
    const products: Record<string, IapProduct> = {};
    for (const [sku, product] of entriesOf(response.productData)) {
      products[sku] = { sku, price: product?.price?.priceStr ?? null, title: product?.title ?? null };
    }
    return products;
  }

  async purchase(sku: string): Promise<IapPurchaseResult> {
    if (this.fallback) return this.fallback.purchase(sku);
    if (!this.lib) return { status: 'unavailable' };
    const { PurchasingService, PurchaseResponseCode } = this.lib;
    const response = await withTimeout(PurchasingService.purchase({ sku }), PURCHASE_TIMEOUT_MS, 'purchase');
    switch (response.responseCode) {
      case PurchaseResponseCode.SUCCESSFUL:
        if (!response.receipt?.receiptId) return { status: 'unavailable' };
        return {
          status: 'purchased',
          receiptId: response.receipt.receiptId,
          sku: response.receipt.sku || sku,
          userId: response.userData?.userId || this.user?.userId || '',
          marketplace: response.userData?.marketplace ?? this.user?.marketplace ?? null,
        };
      case PurchaseResponseCode.ALREADY_PURCHASED:
        return { status: 'already_purchased' };
      case PurchaseResponseCode.INVALID_SKU:
        return { status: 'invalid_sku' };
      case PurchaseResponseCode.NOT_SUPPORTED:
        return { status: 'unavailable' };
      default:
        // Amazon reports a customer backing out of the purchase screen as FAILED too.
        return { status: 'cancelled' };
    }
  }

  async pendingReceipts(): Promise<IapReceipt[]> {
    if (this.fallback || !this.lib) return [];
    const { PurchasingService, PurchaseUpdatesResponseCode, ProductType } = this.lib;
    const receipts: IapReceipt[] = [];
    for (let page = 0; page < 10; page++) {
      // reset true lists every unfulfilled consumable; the server credits each receipt only once.
      const response = await withTimeout(
        PurchasingService.getPurchaseUpdates({ reset: page === 0 }),
        CALL_TIMEOUT_MS,
        'getPurchaseUpdates',
      );
      if (response.responseCode !== PurchaseUpdatesResponseCode.SUCCESSFUL) break;
      for (const receipt of response.receiptList ?? []) {
        if (receipt.isCancelled || receipt.productType !== ProductType.CONSUMABLE) continue;
        receipts.push({
          receiptId: receipt.receiptId,
          sku: receipt.sku,
          userId: response.userData?.userId || this.user?.userId || '',
          marketplace: response.userData?.marketplace ?? this.user?.marketplace ?? null,
        });
      }
      if (!response.hasMore) break;
    }
    return receipts;
  }

  async fulfill(receiptId: string): Promise<void> {
    if (this.fallback || !this.lib) return;
    const { PurchasingService, FulfillmentResult, NotifyFulfillmentResponseCode } = this.lib;
    const response = await withTimeout(
      PurchasingService.notifyFulfillment({ receiptId, fulfillmentResult: FulfillmentResult.FULFILLED }),
      CALL_TIMEOUT_MS,
      'notifyFulfillment',
    );
    if (response.responseCode !== NotifyFulfillmentResponseCode.SUCCESSFUL) {
      throw new Error(`notifyFulfillment returned ${response.responseCode}`);
    }
  }
}

export function createIapService(): IapService {
  return new AmazonIap();
}
