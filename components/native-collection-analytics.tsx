'use client';

import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { useMemo, useState } from 'react';
import { buildNativeAnalytics, nativeValueNote } from '@/lib/collection/native-analytics';
import {
  navigationIndex,
  type CollectionNavigationRead,
  type CollectionNavigationScope,
} from '@/lib/collection-navigation';
import { useInventoryPrices } from '@/hooks/use-inventory-prices';
import type { PricingRegion } from '@/lib/pricing-region';
import { Select } from '@/components/ui/select';

type Props = {
  scope: CollectionNavigationScope;
  read: CollectionNavigationRead;
  collectionId?: string;
  region?: PricingRegion;
};
const money = (n: number | null) =>
  n === null ? 'Unknown' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);

export default function NativeCollectionAnalytics(props: Props) {
  return <ScopedAnalytics key={JSON.stringify([props.scope, props.collectionId])} {...props} />;
}
function ScopedAnalytics({ scope, read, collectionId, region = 'UK' }: Props) {
  const [all, setAll] = useState(!collectionId);
  const [page, setPage] = useState(0);
  const selected = all ? undefined : collectionId;
  const index = useMemo(() => navigationIndex(scope, read), [scope, read]);
  const prices = useInventoryPrices(index.projection?.priceRequests ?? []);
  const summary = useMemo(
    () => buildNativeAnalytics(scope, read, selected, prices, region),
    [scope, read, selected, prices, region],
  );
  if (!summary)
    return (
      <section aria-label="Collection analytics" className="shrink-0 p-3" role="status">
        <h2>Your totals couldn&apos;t be loaded</h2>
        <p>Check your connection and try again. This doesn&apos;t mean you own no cards.</p>
      </section>
    );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(summary.rows.length / 40) - 1));
  const saved = summary.kind === 'cached';
  const value = (
    <>
      <span className="block text-xl font-semibold tabular-nums">Collection value: {money(summary.rawValueGbp)}</span>
      <span className="text-muted-foreground block text-sm">
        {summary.pricedCopies} of {summary.physicalCopies} cards priced
        {nativeValueNote(summary)}
        {summary.gradedUnknownCopies > 0 ? ` · ${summary.gradedUnknownCopies} graded not valued` : ''}
      </span>
      <span className="text-muted-foreground block text-sm">
        {summary.physicalCopies} {summary.physicalCopies === 1 ? 'card' : 'cards'} · {summary.uniqueSpecies} Pokémon ·{' '}
        {summary.actualSlots} pockets
      </span>
      <span className="text-muted-foreground block text-sm">
        {summary.targetCount
          ? `${summary.completedTargets} of ${summary.targetCount} collected`
          : 'Nothing to collect yet'}{' '}
        · {summary.explicitWants} wanted
      </span>
    </>
  );
  return (
    <section
      aria-label="Collection analytics"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[max(0.75rem,calc((100%-72rem)/2+1rem))] pt-3 pb-[var(--dock-clearance)] sm:pt-4"
    >
      <>
        <h1 className="text-xl font-bold tracking-tight">Collection analytics</h1>
        <label className="my-3 block text-sm">
          Show
          <Select
            aria-label="Analytics storage scope"
            className="ml-2"
            value={all ? 'all' : 'selected'}
            onChange={(e) => {
              setAll(e.target.value === 'all');
              setPage(0);
            }}
          >
            {collectionId && <option value="selected">This collection</option>}
            <option value="all">Everything, including cards not in a binder</option>
          </Select>
        </label>
      </>
      {saved && (
        <p role="status" className="text-muted-foreground mb-2 text-sm">
          Showing what was last saved on this device.
        </p>
      )}
      {value}
      <>
        <p className="text-muted-foreground mt-3 text-sm">
          {summary.rawValueGbp !== null && summary.pricedCopies < summary.physicalCopies ? 'A partial estimate. ' : ''}
          From saved prices for the exact version of each card, the same prices the card details show. Low confidence
          prices are included and counted above. Graded cards and cards without a price are left out.
        </p>
        <p className="text-muted-foreground text-sm">
          {summary.oldestQuoteAt ? `Oldest price used: ${summary.oldestQuoteAt.slice(0, 10)}.` : 'No saved prices yet.'}
        </p>
        {summary.unknownSpeciesCopies > 0 && (
          <p className="mt-2 text-sm">{summary.unknownSpeciesCopies} cards aren&apos;t linked to a Pokémon.</p>
        )}
        {summary.unknownTargets > 0 && (
          <p className="text-sm">
            {summary.unknownTargets} placed cards couldn&apos;t be checked against their pocket.
          </p>
        )}
        <section aria-label="Current target completion" className="mt-6 border-t pt-4">
          <h2 className="font-semibold">Progress</h2>
          <ul>
            {summary.goals.map((g) => (
              <li key={g.collectionId} className="py-2 text-sm break-words">
                {g.name}:{' '}
                {g.targetCount ? `${g.completedTargetCount} of ${g.targetCount} collected` : 'Nothing to collect yet'} ·{' '}
                {g.assignedCount} cards placed · {g.slots} pockets
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">Progress counts the pockets each binder is set up for.</p>
        </section>
        <section aria-label="Saved copy values" className="mt-6 border-t pt-4">
          <h2 className="font-semibold">Your cards</h2>
          <ul>
            {summary.rows.slice(currentPage * 40, (currentPage + 1) * 40).map((row) => {
              const copy = summary.copies.find((c) => c.itemId === row.itemId)!;
              return (
                <li key={row.itemId} className="border-b py-3 text-sm break-words">
                  <p className="font-medium">{row.name ?? (row.speciesNames.join(', ') || 'Unknown card')}</p>
                  <p>
                    {[
                      row.language ? formatCardLanguageLabel(row.language) : null,
                      row.finish ? formatCardFinishLabel(row.finish) : null,
                      row.graded ? 'Graded, not valued' : money(copy.amountGbp),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="text-muted-foreground">
                    {row.location.kind === 'assigned'
                      ? row.location.collectionName
                      : row.location.kind === 'unassigned'
                        ? 'Not in a binder'
                        : 'Location unknown'}
                  </p>
                  {copy.quote && (
                    <p className="text-muted-foreground">
                      {copy.quote.confidence} confidence · {copy.quote.updatedAt?.slice(0, 10) ?? 'date unknown'}
                      {copy.basis === 'raw-reference' ? ' · ungraded price, not counted for this graded card' : ''}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex gap-4 py-2">
            {currentPage > 0 && (
              <button className="min-h-9 underline" onClick={() => setPage(currentPage - 1)}>
                Previous
              </button>
            )}
            {summary.rows.length > (currentPage + 1) * 40 && (
              <button className="min-h-9 underline" onClick={() => setPage(currentPage + 1)}>
                Next
              </button>
            )}
          </div>
        </section>
      </>
    </section>
  );
}
