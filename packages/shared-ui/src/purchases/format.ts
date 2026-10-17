import type { SparkProduct, WalletView } from '@storyquest/contracts';
import { formatCount } from '../story/format';

export function formatSparks(count: number): string {
  return count === 1 ? '1 Spark' : `${formatCount(count)} Sparks`;
}

export function formatFreeScenes(count: number): string {
  return count === 1 ? '1 free scene left' : `${formatCount(count)} free scenes left`;
}

export function spendable(wallet: WalletView): number {
  return wallet.sparks + wallet.freeSparks;
}

export function canAfford(wallet: WalletView | null, cost: number): boolean {
  if (cost <= 0 || !wallet) return true;
  return spendable(wallet) >= cost;
}

// The pill: free scenes first, because they are used first.
export function walletLabel(wallet: WalletView): string {
  if (wallet.freeSparks > 0 && wallet.sparks === 0) {
    return wallet.freeSparks === 1 ? 'Your first custom scene is on us' : formatFreeScenes(wallet.freeSparks);
  }
  if (wallet.freeSparks > 0) return `${formatSparks(wallet.sparks)} and ${formatFreeScenes(wallet.freeSparks)}`;
  return formatSparks(wallet.sparks);
}

export function costLabel(wallet: WalletView | null, cost: number): string | null {
  if (cost <= 0) return null;
  if (wallet && wallet.freeSparks >= cost) return 'This scene is on us';
  return `Uses ${formatSparks(cost)}`;
}

export function sparksExplainer(wallet: WalletView): string {
  return (
    'New scenes are filmed just for your family, so each one uses ' +
    `${formatSparks(wallet.sceneCost)}. Tonight's stories and their choices stay free.`
  );
}

export function balanceLine(wallet: WalletView): string {
  if (wallet.freeSparks > 0)
    return `You have ${formatSparks(wallet.sparks)} and ${formatFreeScenes(wallet.freeSparks)}.`;
  return `You have ${formatSparks(wallet.sparks)}.`;
}

export function packTitle(product: SparkProduct): string {
  return formatSparks(product.sparks);
}

export function packPrice(price: string | null | undefined): string {
  return price ?? 'Price shown by Amazon';
}

export function bestValueSku(products: SparkProduct[]): string | null {
  if (products.length < 2) return null;
  return products.reduce((best, product) => (product.sparks > best.sparks ? product : best)).sku;
}
