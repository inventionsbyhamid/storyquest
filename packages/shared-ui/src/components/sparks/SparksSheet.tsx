import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { DefaultFocus, SpatialNavigationRoot, SpatialNavigationView } from 'react-tv-space-navigation';
import type { SparkProduct } from '@storyquest/contracts';
import { colors, radii, space, type, useTone } from '../../theme';
import { scaledPixels } from '../../hooks/useScale';
import { SPARKS_EXPLAINER, bestValueSku, formatSparks, packPrice, packTitle, sparks, useSparks } from '../../purchases';
import { messages } from '../../story/messages';
import { Button } from '../Button';
import { Focusable, FocusFrame, FocusScale } from '../Focusable';
import { SparkCoin } from '../Icons';
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
  const tone = useTone();
  const buy = useCallback(() => {
    if (!busy) onBuy(product.sku);
  }, [busy, onBuy, product.sku]);
  const priceText = packPrice(price);
  return (
    <Focusable
      label={packTitle(product)}
      hint={`${priceText}. Amazon handles the payment`}
      position={position}
      onSelect={buy}
      style={styles.packSlot}
    >
      {(focused) => (
        <FocusScale focused={focused}>
          <View style={[styles.pack, { backgroundColor: tone.night, borderColor: tone.line }, busy && styles.packBusy]}>
            {focused && <FocusFrame radius={radii.card} />}
            <View style={styles.amountRow}>
              <SparkCoin size={30} />
              <Text style={styles.amount}>{packTitle(product)}</Text>
            </View>
            <Text style={styles.price}>{priceText}</Text>
            <Text style={styles.best}>{best ? 'Best value' : ' '}</Text>
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
  const { wallet, prices, canBuy } = useSparks();
  const tone = useTone();
  const [status, setStatus] = useState<SheetStatus>({ kind: 'idle', message: null });
  const mounted = useRef(true);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    mounted.current = true;
    sparks.refreshWallet();
    const animation = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true });
    animation.start();
    return () => {
      mounted.current = false;
      animation.stop();
    };
  }, [opacity]);

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
      <Animated.View style={[styles.cover, { backgroundColor: tone.scrim, opacity }]}>
        <View style={[styles.sheet, { backgroundColor: tone.raised }]}>
          {status.kind === 'done' ? (
            <>
              <View style={styles.amountRow}>
                <SparkCoin size={40} />
                <Text style={[styles.title, styles.doneTitle]}>{`${formatSparks(status.credited)} added`}</Text>
              </View>
              <Text style={styles.body}>Back to your story.</Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>Keep your story going</Text>
              <Text style={styles.body}>{SPARKS_EXPLAINER}</Text>
              {showPacks ? (
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
                  <WaitingDots />
                  <Text style={styles.status}>Waiting for Amazon</Text>
                </View>
              ) : status.kind === 'idle' && status.message ? (
                <Text style={styles.message}>{status.message}</Text>
              ) : null}
              <View style={styles.footer}>
                <Text style={styles.note}>{showPacks ? 'Amazon handles the payment.' : ''}</Text>
                <DefaultFocus enable={!showPacks}>
                  <Button label="Not now" onSelect={onClose} />
                </DefaultFocus>
              </View>
            </>
          )}
        </View>
      </Animated.View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  sheet: {
    width: scaledPixels(1120),
    paddingHorizontal: space.xxl,
    paddingVertical: space.xl,
    borderRadius: radii.card,
  },
  title: {
    ...type.title,
    color: colors.paper,
  },
  doneTitle: {
    marginLeft: space.md,
  },
  body: {
    ...type.body,
    color: colors.paper,
    marginTop: space.sm,
  },
  packs: {
    marginTop: space.xl,
  },
  packSlot: {
    marginRight: space.lg,
  },
  pack: {
    width: scaledPixels(472),
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radii.card,
    borderWidth: scaledPixels(2),
  },
  packBusy: {
    opacity: 0.6,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  amount: {
    ...type.heading,
    color: colors.paper,
    marginLeft: space.sm,
  },
  price: {
    ...type.body,
    color: colors.paper,
    marginTop: space.sm,
  },
  best: {
    ...type.small,
    color: colors.paperDim,
    marginTop: space.xs,
  },
  unavailable: {
    ...type.body,
    color: colors.paper,
    marginTop: space.xl,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
  },
  status: {
    ...type.body,
    color: colors.paperDim,
    marginLeft: space.sm,
  },
  message: {
    ...type.body,
    color: colors.paper,
    marginTop: space.lg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xl,
  },
  note: {
    ...type.small,
    color: colors.paperDim,
    flexShrink: 1,
    marginRight: space.lg,
  },
});
