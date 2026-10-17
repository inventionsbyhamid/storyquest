import { describe, expect, it } from 'vitest';
import type { WalletView } from '@storyquest/contracts';
import {
  balanceLine,
  bestValueSku,
  canAfford,
  costLabel,
  formatFreeScenes,
  formatSparks,
  packPrice,
  sparksExplainer,
  walletLabel,
} from './format';

const wallet = (overrides: Partial<WalletView> = {}): WalletView => ({
  sparks: 0,
  freeSparks: 0,
  sceneCost: 1,
  products: [
    { sku: 'storyquest.sparks.10', sparks: 10 },
    { sku: 'storyquest.sparks.25', sparks: 25 },
  ],
  purchasesEnabled: true,
  ...overrides,
});

describe('wallet formatting', () => {
  it('counts sparks and free scenes', () => {
    expect(formatSparks(1)).toBe('1 Spark');
    expect(formatSparks(1204)).toBe('1,204 Sparks');
    expect(formatFreeScenes(1)).toBe('1 free scene left');
    expect(formatFreeScenes(3)).toBe('3 free scenes left');
  });

  it('welcomes new families and otherwise shows the balance', () => {
    expect(walletLabel(wallet({ freeSparks: 1 }))).toBe('Your first custom scene is on us');
    expect(walletLabel(wallet({ freeSparks: 3 }))).toBe('3 free scenes left');
    expect(walletLabel(wallet({ sparks: 12 }))).toBe('12 Sparks');
    expect(walletLabel(wallet({ sparks: 12, freeSparks: 1 }))).toBe('12 Sparks and 1 free scene left');
    expect(walletLabel(wallet())).toBe('0 Sparks');
  });

  it('knows what the family can afford', () => {
    expect(canAfford(wallet({ freeSparks: 1 }), 1)).toBe(true);
    expect(canAfford(wallet({ sparks: 1 }), 1)).toBe(true);
    expect(canAfford(wallet(), 1)).toBe(false);
    expect(canAfford(wallet(), 0)).toBe(true);
    expect(canAfford(null, 1)).toBe(true);
  });

  it('describes costs, balance and packs', () => {
    expect(costLabel(wallet({ freeSparks: 1 }), 1)).toBe('This scene is on us');
    expect(costLabel(wallet({ sparks: 4 }), 1)).toBe('Uses 1 Spark');
    expect(costLabel(wallet(), 0)).toBeNull();
    expect(balanceLine(wallet({ sparks: 2 }))).toBe('You have 2 Sparks.');
    expect(balanceLine(wallet({ freeSparks: 1 }))).toBe('You have 0 Sparks and 1 free scene left.');
    expect(sparksExplainer(wallet())).toContain('each one uses 1 Spark');
    expect(packPrice('$11.99')).toBe('$11.99');
    expect(packPrice(null)).toBe('Price shown by Amazon');
    expect(bestValueSku(wallet().products)).toBe('storyquest.sparks.25');
    expect(bestValueSku([{ sku: 'only', sparks: 10 }])).toBeNull();
  });

  it('never uses dashes in wallet copy', () => {
    const dash = /[-‐‑‒–—―−]/;
    const texts = [
      walletLabel(wallet({ sparks: 12, freeSparks: 1 })),
      walletLabel(wallet({ freeSparks: 1 })),
      costLabel(wallet(), 1)!,
      costLabel(wallet({ freeSparks: 1 }), 1)!,
      balanceLine(wallet({ freeSparks: 2 })),
      sparksExplainer(wallet()),
      packPrice(null),
    ];
    for (const text of texts) expect(text).not.toMatch(dash);
  });
});
