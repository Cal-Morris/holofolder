'use client';

import { useMemo } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { buildCollectionAnalytics } from '@/lib/collection-analytics';
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import type { CollectedPokemon } from '@/lib/domain/cards';
import { buildNativeAnalytics, sumCopyValues } from '@/lib/collection/native-analytics';
import { selectInventoryCollection } from '@/lib/collection/inventory-projection';
import {
  navigationIndex,
  type CollectionNavigationRead,
  type CollectionNavigationScope,
} from '@/lib/collection-navigation';
import { useInventoryPriceState } from '@/hooks/use-inventory-prices';
import type { PricingRegion } from '@/lib/pricing-region';

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
              {summary.pricedCards
                ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(summary.valueGbp)
                : loading
                  ? 'Loading…'
                  : 'Unknown'}
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

const gbp = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);

/**
 * Signed-in (native) binder: whole-binder and open-page totals from saved high/medium confidence prices, the same
 * evidence as Analytics. Unpriced and graded copies are counted as unpriced, never guessed.
 */
export function NativeBinderTotals({
  analytics,
  collectionId,
  pageItemIds,
  pageLabel,
  region,
  priceMode,
  onOpen,
  onDismiss,
}: {
  analytics: { scope: CollectionNavigationScope; read: CollectionNavigationRead };
  collectionId: string;
  pageItemIds: readonly string[];
  pageLabel: string;
  region: PricingRegion;
  /** The pocket price labels toggle (View → Prices on the legacy binder). */
  priceMode?: { on: boolean; loading: boolean; toggle: () => void };
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const requests = useMemo(() => {
    const projection = navigationIndex(analytics.scope, analytics.read).projection;
    return projection ? selectInventoryCollection(projection, collectionId).priceRequests : [];
  }, [analytics, collectionId]);
  const { prices, status } = useInventoryPriceState(requests);
  const summary = useMemo(
    () => buildNativeAnalytics(analytics.scope, analytics.read, collectionId, prices, region),
    [analytics, collectionId, prices, region],
  );
  const page = useMemo(
    () => (summary ? sumCopyValues(summary.copies, new Set(pageItemIds)) : null),
    [summary, pageItemIds],
  );
  if (!summary || !page || summary.physicalCopies === 0) return null;
  const amount = (value: number | null) =>
    value !== null
      ? gbp(value)
      : status === 'loading'
        ? 'Loading…'
        : status === 'unavailable'
          ? 'Unavailable'
          : 'Unknown';
  return (
    <section
      aria-label="Binder value"
      className="holo-panel border-border/60 relative mb-2 shrink-0 rounded-2xl border"
    >
      <button
        type="button"
        aria-label="View binder value in Analytics"
        onClick={onOpen}
        className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl py-2 pl-3 text-left ${priceMode ? 'pr-[7.5rem]' : 'pr-14'}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Binder <span className="ml-1 text-lg font-semibold tabular-nums">{amount(summary.rawValueGbp)}</span>
          </span>
          <span className="text-muted-foreground block text-xs">
            {summary.pricedCopies} of {summary.physicalCopies} cards priced
            {summary.rawValueGbp !== null && summary.pricedCopies < summary.physicalCopies ? ' · partial' : ''}
          </span>
          <span data-testid="binder-page-total" className="block text-xs font-medium tabular-nums">
            {pageLabel}: {page.total ? `${amount(page.valueGbp)} · ${page.priced} of ${page.total} priced` : 'no cards'}
          </span>
        </span>
        <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      <span className="absolute top-1 right-1 flex items-center">
        {priceMode && (
          <button
            type="button"
            aria-pressed={priceMode.on}
            onClick={priceMode.toggle}
            className={`min-h-11 rounded-full px-3 text-xs font-semibold ${priceMode.on ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
          >
            {priceMode.on && priceMode.loading ? 'Loading' : 'Prices'}
          </button>
        )}
        <button
          type="button"
          aria-label="Hide binder value"
          onClick={onDismiss}
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </section>
  );
}
