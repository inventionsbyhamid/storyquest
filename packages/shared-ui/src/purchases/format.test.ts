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
  SPARKS_EXPLAINER,
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
    expect(formatFreeScenes(1)).toBe('1 free scene');
    expect(formatFreeScenes(3)).toBe('3 free scenes');
  });

  it('counts free Sparks as chapters when a chapter costs several', () => {
    expect(walletLabel(wallet({ freeSparks: 6, sceneCost: 3 }))).toBe('2 free chapters');
    expect(walletLabel(wallet({ freeSparks: 3, sceneCost: 3 }))).toBe('Your first chapter is free');
    expect(walletLabel(wallet({ sparks: 10, freeSparks: 3, sceneCost: 3 }))).toBe('10 Sparks and 1 free chapter');
    expect(costLabel(wallet({ freeSparks: 3, sceneCost: 3 }), 3)).toBe('Uses your free chapter');
  });

  it('welcomes new families and otherwise shows the balance', () => {
    expect(walletLabel(wallet({ freeSparks: 1 }))).toBe('Your first scene is free');
    expect(walletLabel(wallet({ freeSparks: 3 }))).toBe('3 free scenes');
    expect(walletLabel(wallet({ sparks: 12 }))).toBe('12 Sparks');
    expect(walletLabel(wallet({ sparks: 12, freeSparks: 1 }))).toBe('12 Sparks and 1 free scene');
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
    expect(costLabel(wallet({ freeSparks: 1 }), 1)).toBe('Uses your free scene');
    expect(costLabel(wallet({ sparks: 4 }), 1)).toBe('Uses 1 Spark');
    expect(costLabel(wallet(), 0)).toBeNull();
    expect(balanceLine(wallet({ sparks: 2 }))).toBe('You have 2 Sparks.');
    expect(balanceLine(wallet({ freeSparks: 1 }))).toBe('You have 0 Sparks and 1 free scene.');
    expect(SPARKS_EXPLAINER).toBe("Stories filmed only for your family use Sparks. Tonight's stories stay free.");
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
      SPARKS_EXPLAINER,
      packPrice(null),
    ];
    for (const text of texts) expect(text).not.toMatch(dash);
  });
});
