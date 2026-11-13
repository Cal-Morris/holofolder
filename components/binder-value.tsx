'use client';

import { useMemo } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { buildCollectionAnalytics } from '@/lib/collection-analytics';
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import type { CollectedPokemon } from '@/lib/domain/cards';
import { buildNativeAnalytics } from '@/lib/collection/native-analytics';
import { selectInventoryCollection } from '@/lib/collection/inventory-projection';
import {
  navigationIndex,
  type CollectionNavigationRead,
  type CollectionNavigationScope,
} from '@/lib/collection-navigation';
import { useInventoryPriceState } from '@/hooks/use-inventory-prices';
import type { PricingRegion } from '@/lib/pricing-region';

const GBP_FORMAT = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function BinderValue({
  collection,
  prices,
  loading,
  onOpen,
  onDismiss,
}: {
  collection: CollectedPokemon[];
  prices: Record<string, CardPriceSnapshot>;
  loading: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const summary = useMemo(() => buildCollectionAnalytics(collection, prices), [collection, prices]);
  if (summary.assignedCards === 0) return null;
  return (
    <section
      aria-label="Binder value"
      className="holo-panel border-border/60 relative mb-2 shrink-0 rounded-2xl border"
    >
      <button
        type="button"
        aria-label="View binder value in Analytics"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl py-2 pr-14 pl-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Binder value{' '}
            <span className="ml-1 text-lg font-semibold tabular-nums">
              {summary.pricedCards ? GBP_FORMAT.format(summary.valueGbp) : loading ? 'Loading…' : 'Unknown'}
            </span>
          </span>
          <span className="text-muted-foreground block text-xs">
            All price sources · {summary.pricedCards} of {summary.assignedCards} owned cards priced
            {summary.pricedCards < summary.assignedCards ? ' · partial estimate' : ''}
          </span>
          {summary.estimatedFinishCards > 0 && (
            <span className="text-muted-foreground block text-xs">
              Includes {summary.estimatedFinishCards} finish estimate{summary.estimatedFinishCards === 1 ? '' : 's'}
            </span>
          )}
          {summary.oldestQuoteAt && (
            <span className="text-muted-foreground block text-xs">
              Oldest quote {new Date(summary.oldestQuoteAt).toLocaleDateString('en-GB')}
              {summary.staleCards > 0 ? ` · ${summary.staleCards} stale` : ''}
            </span>
          )}
        </span>
        <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Hide binder value"
        onClick={onDismiss}
        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full focus-visible:outline-2"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}

/** One binder's value from saved prices: the header, page total and inside cover all read this. */
export function useNativeBinderValue(
  analytics: { scope: CollectionNavigationScope; read: CollectionNavigationRead } | undefined,
  collectionId: string | undefined,
  region: PricingRegion,
) {
  const requests = useMemo(() => {
    const projection = analytics && navigationIndex(analytics.scope, analytics.read).projection;
    return projection ? selectInventoryCollection(projection, collectionId).priceRequests : [];
  }, [analytics, collectionId]);
  const { prices, status } = useInventoryPriceState(requests);
  const summary = useMemo(
    () => (analytics ? buildNativeAnalytics(analytics.scope, analytics.read, collectionId, prices, region) : null),
    [analytics, collectionId, prices, region],
  );
  return { summary, status };
}
