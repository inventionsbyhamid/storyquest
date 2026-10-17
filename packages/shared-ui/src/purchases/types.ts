export type IapKind = 'amazon' | 'simulated' | 'none';

export interface IapUser {
  userId: string;
  marketplace: string | null;
}

export interface IapProduct {
  sku: string;
  price: string | null;
  title: string | null;
}

export interface IapReceipt {
  receiptId: string;
  sku: string;
  userId: string;
  marketplace: string | null;
}

export type IapPurchaseResult =
  | ({ status: 'purchased' } & IapReceipt)
  | { status: 'cancelled' | 'already_purchased' | 'invalid_sku' | 'unavailable' };

export interface IapService {
  readonly kind: IapKind;
  init(): Promise<IapUser | null>;
  getProducts(skus: string[]): Promise<Record<string, IapProduct>>;
  purchase(sku: string): Promise<IapPurchaseResult>;
  pendingReceipts(): Promise<IapReceipt[]>;
  fulfill(receiptId: string): Promise<void>;
}
