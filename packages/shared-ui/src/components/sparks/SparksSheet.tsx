import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { SparkProduct } from '@storyquest/contracts';
import { colors, radii, type } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import {
  balanceLine,
  bestValueSku,
  formatSparks,
  packPrice,
  packTitle,
  sparks,
  sparksExplainer,
  useSparks,
} from '../../purchases';
import { messages } from '../../story/messages';
import { Button } from '../Button';
import { Focusable, FocusGlow, FocusScale } from '../Focusable';
import { SparkleIcon } from '../Icons';
import { Pill } from '../Pill';
import { WaitingDots } from '../WaitingDots';

type SheetStatus =
  | { kind: 'idle'; message: string | null }
  | { kind: 'buying'; sku: string }
  | { kind: 'done'; credited: number };

interface PackCardProps {
  product: SparkProduct;
  price: string | null;
  best: boolean;
  busy: boolean;
  position: number;
  onBuy: (sku: string) => void;
}

const PackCard = React.memo(({ product, price, best, busy, position, onBuy }: PackCardProps) => {
  const buy = useCallback(() => {
    if (!busy) onBuy(product.sku);
  }, [busy, onBuy, product.sku]);
  const priceText = packPrice(price);
  return (
    <Focusable
      label={packTitle(product)}
      hint={`${priceText}. Amazon handles the purchase`}
      position={position}
      onSelect={buy}
      style={styles.packSlot}
    >
      {(focused) => (
        <FocusScale focused={focused}>
          <View style={[styles.pack, focused && styles.packFocused, busy && styles.packBusy]}>
            {focused && <FocusGlow radius={radii.lg} />}
            {best && (
              <View style={styles.bestBadge}>
                <Pill text="Best value" tone="violet" />
              </View>
            )}
            <SparkleIcon size={scaledPixels(64)} color={colors.accent} />
            <Text style={styles.packTitle}>{packTitle(product)}</Text>
            <Text style={[styles.packPrice, !price && styles.packPriceMuted]}>{priceText}</Text>
          </View>
        </FocusScale>
      )}
    </Focusable>
  );
});

interface SparksSheetProps {
  active: boolean;
  onDone: () => void;
  onClose: () => void;
}

// Shown when a new scene needs Sparks the family does not have. After a purchase it hands back
// to the screen so the original action can carry on.
export function SparksSheet({ active, onDone, onClose }: SparksSheetProps) {
  const snapshot = useSparks();
  const { wallet, prices, canBuy } = snapshot;
  const [status, setStatus] = useState<SheetStatus>({ kind: 'idle', message: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    sparks.refreshWallet();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (status.kind !== 'done') return;
    const timer = setTimeout(onDone, 1200);
    return () => clearTimeout(timer);
  }, [status, onDone]);

  const buy = useCallback(async (sku: string) => {
    setStatus({ kind: 'buying', sku });
    const outcome = await sparks.buy(sku);
    if (!mounted.current) return;
    if (outcome.kind === 'credited') setStatus({ kind: 'done', credited: outcome.credited });
    else setStatus({ kind: 'idle', message: outcome.message });
  }, []);

  const products = wallet?.products ?? [];
  const best = bestValueSku(products);
  const busy = status.kind === 'buying';
  const showPacks = canBuy && products.length > 0 && status.kind !== 'done';

  return (
    <SpatialNavigationRoot isActive={active}>
      <View style={styles.dim}>
        <View style={styles.panel}>
          <View style={styles.eyebrowRow}>
            <SparkleIcon size={scaledPixels(28)} color={colors.accent} />
            <Text style={styles.eyebrow}>Sparks</Text>
          </View>
          <Text style={styles.title}>
            {status.kind === 'done' ? `${formatSparks(status.credited)} added` : 'Get more Sparks'}
          </Text>
          {wallet && status.kind !== 'done' ? (
            <>
              <Text style={styles.body}>{sparksExplainer(wallet)}</Text>
              <Text style={styles.balance}>{balanceLine(wallet)}</Text>
            </>
          ) : null}

          {status.kind === 'done' ? (
            <View style={styles.statusRow}>
              <SparkleIcon size={scaledPixels(40)} color={colors.accent} />
              <Text style={styles.done}>Thank you! Back to your story.</Text>
            </View>
          ) : showPacks ? (
            <SpatialNavigationView direction="horizontal" style={styles.packs}>
              {products.map((product, i) => (
                <DefaultFocus key={product.sku} enable={i === 0}>
                  <PackCard
                    product={product}
                    price={prices[product.sku] ?? null}
                    best={product.sku === best}
                    busy={busy}
                    position={i + 1}
                    onBuy={buy}
                  />
                </DefaultFocus>
              ))}
            </SpatialNavigationView>
          ) : (
            <Text style={styles.unavailable}>{messages.purchasesUnavailable}</Text>
          )}

          {busy ? (
            <View style={styles.statusRow}>
              <WaitingDots size={12} />
              <Text style={styles.statusInline}>Finishing up with Amazon</Text>
            </View>
          ) : status.kind === 'idle' && status.message ? (
            <Text style={styles.statusText}>{status.message}</Text>
          ) : null}

          {status.kind !== 'done' && (
            <View style={styles.footer}>
              <Text style={styles.footnote}>
                {showPacks ? 'Amazon handles the purchase. Your Sparks follow your Amazon account to every TV.' : ''}
              </Text>
              <DefaultFocus enable={!showPacks}>
                <Button label="Not now" onSelect={onClose} />
              </DefaultFocus>
            </View>
          )}
        </View>
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrimStrong,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  panel: {
    width: scaledPixels(1280),
    paddingHorizontal: scaledPixels(72),
    paddingVertical: scaledPixels(56),
    borderRadius: radii.lg,
    backgroundColor: colors.backgroundRaised,
    borderWidth: scaledPixels(2),
    borderColor: 'rgba(255, 181, 71, 0.35)',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyebrow: {
    ...type.meta,
    color: colors.accent,
    letterSpacing: scaledPixels(2),
    textTransform: 'uppercase',
    marginLeft: scaledPixels(10),
  },
  title: {
    ...type.title,
    color: colors.text,
    marginTop: scaledPixels(8),
  },
  body: {
    ...type.body,
    color: colors.textMuted,
    marginTop: scaledPixels(14),
  },
  balance: {
    ...type.body,
    color: colors.text,
    marginTop: scaledPixels(6),
  },
  packs: {
    marginTop: scaledPixels(36),
  },
  packSlot: {
    marginRight: scaledPixels(36),
  },
  pack: {
    width: scaledPixels(440),
    height: scaledPixels(250),
    borderRadius: radii.lg,
    borderWidth: scaledPixels(4),
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceHigh,
  },
  packBusy: {
    opacity: 0.6,
  },
  bestBadge: {
    position: 'absolute',
    top: scaledPixels(16),
    right: scaledPixels(16),
  },
  packTitle: {
    ...type.heading,
    color: colors.text,
    marginTop: scaledPixels(10),
  },
  packPrice: {
    ...type.bodyLarge,
    color: colors.accent,
    marginTop: scaledPixels(4),
  },
  packPriceMuted: {
    color: colors.textFaint,
    fontSize: scaledPixels(26),
  },
  unavailable: {
    ...type.bodyLarge,
    color: colors.text,
    marginTop: scaledPixels(36),
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaledPixels(28),
  },
  statusText: {
    ...type.body,
    color: colors.textMuted,
    marginTop: scaledPixels(24),
  },
  statusInline: {
    ...type.body,
    color: colors.textMuted,
    marginLeft: scaledPixels(12),
  },
  done: {
    ...type.heading,
    color: colors.text,
    marginLeft: scaledPixels(16),
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: scaledPixels(36),
  },
  footnote: {
    ...type.meta,
    fontWeight: '500',
    color: colors.textFaint,
    flexShrink: 1,
    marginRight: scaledPixels(32),
  },
});
