import { describe, expect, it, vi } from 'vitest';
import type { WalletView } from '@storyquest/contracts';
import { ApiError } from '../api/errors';
import { messages } from '../story/messages';
import { SparksStore } from './sparksStore';
import type { IapKind, IapPurchaseResult, IapReceipt, IapService } from './types';

const wallet = (overrides: Partial<WalletView> = {}): WalletView => ({
  sparks: 0,
  freeSparks: 0,
  sceneCost: 1,
  products: [
    { sku: 'sparks_10', sparks: 10 },
    { sku: 'sparks_30', sparks: 30 },
  ],
  purchasesEnabled: true,
  ...overrides,
});

function fakeIap(kind: IapKind, purchase: IapPurchaseResult, pending: IapReceipt[] = []) {
  const calls: string[] = [];
  const iap: IapService = {
    kind,
    init: vi.fn(async () => {
      calls.push('init');
      return kind === 'none' ? null : { userId: 'amzn-user', marketplace: 'US' };
    }),
    getProducts: vi.fn(async () => ({ sparks_10: { sku: 'sparks_10', price: '$1.99', title: '10 Sparks' } })),
    purchase: vi.fn(async (sku: string) => {
      calls.push(`purchase ${sku}`);
      return purchase;
    }),
    pendingReceipts: vi.fn(async () => pending),
    fulfill: vi.fn(async (receiptId: string) => {
      calls.push(`fulfill ${receiptId}`);
    }),
  };
  return { iap, calls };
}

function fakeApi(calls: string[], verify: Array<WalletView | ApiError>) {
  return {
    getWallet: vi.fn(async () => wallet()),
    verifyPurchase: vi.fn(async (input: { receiptId: string }) => {
      calls.push(`verify ${input.receiptId}`);
      const next = verify.shift();
      if (!next) throw new Error('no response');
      if (next instanceof ApiError) throw next;
      return { wallet: next, credited: 10, alreadyProcessed: false };
    }),
  };
}

const receipt: IapReceipt = { receiptId: 'r1', sku: 'sparks_10', userId: 'amzn-user', marketplace: 'US' };
const purchased: IapPurchaseResult = { status: 'purchased', ...receipt };
const noWait = async () => undefined;

describe('SparksStore', () => {
  it('starts by sending the iap user id, loading the wallet and localized prices', async () => {
    const { iap } = fakeIap('amazon', purchased);
    const setIdentity = vi.fn();
    const store = new SparksStore({ api: fakeApi([], []), iap, setIdentity, log: () => undefined });
    await store.start();
    expect(setIdentity).toHaveBeenCalledWith('amzn-user');
    const snapshot = store.getSnapshot();
    expect(snapshot.ready).toBe(true);
    expect(snapshot.store).toBe('amazon');
    expect(snapshot.wallet?.products).toHaveLength(2);
    expect(snapshot.prices).toEqual({ sparks_10: '$1.99' });
    expect(snapshot.canBuy).toBe(true);
    expect(iap.getProducts).toHaveBeenCalledWith(['sparks_10', 'sparks_30']);
  });

  it('verifies with the server before telling Amazon the purchase is fulfilled', async () => {
    const { iap, calls } = fakeIap('amazon', purchased);
    const store = new SparksStore({
      api: fakeApi(calls, [wallet({ sparks: 10 })]),
      iap,
      setIdentity: vi.fn(),
      log: () => undefined,
    });
    await store.start();
    const outcome = await store.buy('sparks_10');
    expect(outcome).toMatchObject({ kind: 'credited', credited: 10 });
    expect(calls).toEqual(['init', 'purchase sparks_10', 'verify r1', 'fulfill r1']);
    expect(store.getSnapshot().wallet?.sparks).toBe(10);
  });

  it('treats a cancelled purchase kindly and never verifies it', async () => {
    const { iap, calls } = fakeIap('amazon', { status: 'cancelled' });
    const api = fakeApi(calls, []);
    const store = new SparksStore({ api, iap, setIdentity: vi.fn(), log: () => undefined });
    await store.start();
    await expect(store.buy('sparks_10')).resolves.toEqual({ kind: 'cancelled', message: messages.purchaseCancelled });
    expect(api.verifyPurchase).not.toHaveBeenCalled();
  });

  it('keeps an unverified purchase unfulfilled so it is retried on the next launch', async () => {
    const { iap, calls } = fakeIap('amazon', purchased);
    const down = new ApiError('network', 'down');
    const store = new SparksStore({
      api: fakeApi(calls, [down, down, down]),
      iap,
      setIdentity: vi.fn(),
      sleep: noWait,
      log: () => undefined,
    });
    await store.start();
    await expect(store.buy('sparks_10')).resolves.toEqual({ kind: 'pending', message: messages.sparksPending });
    expect(calls.filter((call) => call.startsWith('verify'))).toHaveLength(3);
    expect(iap.fulfill).not.toHaveBeenCalled();
  });

  it('does not fulfill a receipt the server calls invalid', async () => {
    const { iap } = fakeIap('amazon', purchased);
    const store = new SparksStore({
      api: fakeApi([], [new ApiError('purchase_invalid', 'no')]),
      iap,
      setIdentity: vi.fn(),
      log: () => undefined,
    });
    await store.start();
    await expect(store.buy('sparks_10')).resolves.toEqual({ kind: 'failed', message: messages.purchaseInvalid });
    expect(iap.fulfill).not.toHaveBeenCalled();
    expect(store.getSnapshot().canBuy).toBe(true);
  });

  it('turns simulated purchases off when the server is not in fake mode', async () => {
    const { iap } = fakeIap('simulated', {
      status: 'purchased',
      receiptId: 'fake-1',
      sku: 'sparks_10',
      userId: 'fake-user-tv',
      marketplace: null,
    });
    const store = new SparksStore({
      api: fakeApi([], [new ApiError('purchase_invalid', 'no')]),
      iap,
      setIdentity: vi.fn(),
      log: () => undefined,
    });
    await store.start();
    expect(store.getSnapshot().canBuy).toBe(true);
    expect(iap.getProducts).not.toHaveBeenCalled();
    await expect(store.buy('sparks_10')).resolves.toEqual({ kind: 'failed', message: messages.purchasesUnavailable });
    expect(store.getSnapshot().canBuy).toBe(false);
  });

  it('finishes purchases left over from an earlier session', async () => {
    const { iap, calls } = fakeIap('amazon', purchased, [receipt, { ...receipt, receiptId: 'r2' }]);
    const store = new SparksStore({
      api: fakeApi(calls, [wallet({ sparks: 10 }), wallet({ sparks: 20 })]),
      iap,
      setIdentity: vi.fn(),
      log: () => undefined,
    });
    await store.start();
    expect(calls).toEqual(['init', 'verify r1', 'fulfill r1', 'verify r2', 'fulfill r2']);
    expect(store.getSnapshot().wallet?.sparks).toBe(20);
  });

  it('works without a store: free ideas still count, purchases stay off', async () => {
    const { iap } = fakeIap('none', purchased);
    const setIdentity = vi.fn();
    const store = new SparksStore({ api: fakeApi([], []), iap, setIdentity, log: () => undefined });
    await store.start();
    expect(setIdentity).toHaveBeenCalledWith(null);
    expect(store.getSnapshot().wallet).not.toBeNull();
    expect(store.getSnapshot().canBuy).toBe(false);
    await expect(store.buy('sparks_10')).resolves.toEqual({ kind: 'failed', message: messages.purchasesUnavailable });
  });

  it('respects a server that turned purchases off', async () => {
    const { iap } = fakeIap('amazon', purchased);
    const api = { ...fakeApi([], []), getWallet: vi.fn(async () => wallet({ purchasesEnabled: false })) };
    const store = new SparksStore({ api, iap, setIdentity: vi.fn(), log: () => undefined });
    await store.start();
    expect(store.getSnapshot().canBuy).toBe(false);
  });

  it('notifies subscribers', async () => {
    const { iap } = fakeIap('amazon', purchased);
    const store = new SparksStore({ api: fakeApi([], []), iap, setIdentity: vi.fn(), log: () => undefined });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.start();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
