import type { SparkProduct, WalletView } from '@storyquest/contracts';
import { formatCount } from '../story/format';

export function formatSparks(count: number): string {
  return count === 1 ? '1 Spark' : `${formatCount(count)} Sparks`;
}

export function formatFreeScenes(count: number): string {
  return count === 1 ? '1 free scene' : `${formatCount(count)} free scenes`;
}

export function spendable(wallet: WalletView): number {
  return wallet.sparks + wallet.freeSparks;
}

export function canAfford(wallet: WalletView | null, cost: number): boolean {
  if (cost <= 0 || !wallet) return true;
  return spendable(wallet) >= cost;
}

export function walletLabel(wallet: WalletView): string {
  if (wallet.freeSparks > 0 && wallet.sparks === 0) {
    return wallet.freeSparks === 1 ? 'Your first scene is free' : formatFreeScenes(wallet.freeSparks);
  }
  if (wallet.freeSparks > 0) return `${formatSparks(wallet.sparks)} and ${formatFreeScenes(wallet.freeSparks)}`;
  return formatSparks(wallet.sparks);
}

export function costLabel(wallet: WalletView | null, cost: number): string | null {
  if (cost <= 0) return null;
  if (wallet && wallet.freeSparks >= cost) return 'Uses your free scene';
  return `Uses ${formatSparks(cost)}`;
}

export const SPARKS_EXPLAINER = "Scenes made only for your family use Sparks. Tonight's stories stay free.";

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
