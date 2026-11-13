import {
  navigationIndex,
  type CollectionNavigationRead,
  type CollectionNavigationScope,
} from '@/lib/collection-navigation';
import { selectInventoryCollection, valueInventoryCollection } from '@/lib/collection/inventory-projection';
import { browserHostCatalog } from '@/lib/collection/browser-host-catalog';
import { getBinderGoalPresentation } from '@/lib/binder-goals';
import { normalizeInventorySnapshot } from '@/lib/domain/inventory';
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import type { PricingRegion } from '@/lib/pricing-region';

/** Presentation only, from the same fenced complete/cached read as Inventory. Never merge legacy rows. */
export function buildNativeAnalytics(
  scope: CollectionNavigationScope,
  read: CollectionNavigationRead,
  collectionId: string | undefined,
  prices: readonly CardPriceSnapshot[],
  region: PricingRegion = 'UK',
  now = Date.now(),
) {
  const index = navigationIndex(scope, read);
  const snapshot = read.evidence.kind !== 'unavailable' ? normalizeInventorySnapshot(read.evidence.snapshot) : null;
  if (!index.projection || !snapshot || (collectionId && !index.collections.some((c) => c.id === collectionId)))
    return null;
  const projection = selectInventoryCollection(index.projection, collectionId);
  const value = valueInventoryCollection(projection, prices, region, now);
  // Every known price counts, the same amount the card sheet shows. Confidence only labels the total; signals stay gated elsewhere.
  const copies = value.copies;
  const priced = copies.filter((c) => c.amountGbp !== null);
  const dates = priced.flatMap((c) => (c.quote?.updatedAt ? [c.quote.updatedAt] : [])).sort();
  const goals = snapshot.binders.flatMap((b) =>
    !collectionId || b.collectionId === collectionId
      ? [
          {
            collectionId: b.collectionId,
            name: index.collections.find((c) => c.id === b.collectionId)!.name,
            slots: b.slots.length,
            ...getBinderGoalPresentation(snapshot, b, browserHostCatalog(read.catalog)),
          },
        ]
      : [],
  );
  const itemIds = new Set(projection.owned.map((i) => i.itemId));
  return {
    kind: index.kind,
    projection,
    copies,
    goals,
    rows: index.rows.filter((r) => itemIds.has(r.itemId)),
    collections: index.collections,
    requests: projection.priceRequests,
    physicalCopies: projection.owned.length,
    uniqueSpecies: projection.speciesIds.length,
    unknownSpeciesCopies: projection.unknownSpeciesCopies,
    explicitWants: projection.wants.length,
    actualSlots: goals.reduce((n, g) => n + g.slots, 0),
    targetCount: goals.reduce((n, g) => n + g.targetCount, 0),
    completedTargets: goals.reduce((n, g) => n + g.completedTargetCount, 0),
    unknownTargets: goals.reduce((n, g) => n + g.unknownTargetCount, 0),
    rawValueGbp: priced.length ? Math.round(priced.reduce((n, c) => n + c.amountGbp!, 0) * 100) / 100 : null,
    pricedCopies: priced.length,
    lowConfidenceCopies: priced.filter((c) => !['high', 'medium'].includes(c.quote?.confidence ?? 'unknown')).length,
    unpricedRawCopies: copies.filter((c) => c.basis === 'raw' && c.amountGbp === null).length,
    gradedUnknownCopies: value.gradedUnknownCopies,
    oldestQuoteAt: dates[0] ?? null,
  };
}

/** Total of the copies in `itemIds` (e.g. the pockets on the open page), from the same amounts. Unpriced stays unpriced. */
export function sumCopyValues(
  copies: readonly { itemId: string; amountGbp: number | null }[],
  itemIds: ReadonlySet<string>,
) {
  const onPage = copies.filter((c) => itemIds.has(c.itemId));
  const priced = onPage.filter((c) => c.amountGbp !== null);
  return {
    valueGbp: priced.length ? Math.round(priced.reduce((n, c) => n + c.amountGbp!, 0) * 100) / 100 : null,
    priced: priced.length,
    total: onPage.length,
  };
}

/** "· partial · 3 low confidence" style suffix shared by every native value line. */
export function nativeValueNote(summary: {
  pricedCopies: number;
  physicalCopies: number;
  lowConfidenceCopies: number;
}) {
  return [
    summary.pricedCopies > 0 && summary.pricedCopies < summary.physicalCopies ? 'partial' : '',
    summary.lowConfidenceCopies > 0 ? `${summary.lowConfidenceCopies} low confidence` : '',
  ]
    .filter(Boolean)
    .map((part) => ` · ${part}`)
    .join('');
}

const gbpFormat = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** The binder value as one line ("£9.80 · 2 low confidence"), or undefined when nothing is priced. */
export function nativeValueLabel(summary: ReturnType<typeof buildNativeAnalytics>) {
  return summary?.rawValueGbp != null
    ? `${gbpFormat.format(summary.rawValueGbp)}${nativeValueNote(summary)}`
    : undefined;
}
