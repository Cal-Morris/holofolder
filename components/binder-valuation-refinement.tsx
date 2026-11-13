'use client';

import { useBillingContext } from '@/hooks/use-billing';
import { useEffect, useMemo, useState } from 'react';
import CollectionPriceCheck from '@/components/collection-price-check';
import { buildRefinedValuation } from '@/lib/binder-valuation';
import { priceCheckKey, readPinnedCardPriceCheck, formatPriceCheckAge } from '@/lib/card-price-check-cache';
import type { CardPriceCheck } from '@/lib/card-price-checks';
import type { AnalyticsCard } from '@/lib/collection-analytics';
import type { CollectedPokemon } from '@/lib/domain/cards';

const GBP_FORMAT = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function BinderValuationRefinement({
  cards,
  collection,
  isOnline,
  readOnly,
  isAllBinders,
  ownerId,
}: {
  ownerId: string | null;
  cards: AnalyticsCard[];
  collection: CollectedPokemon[];
  isOnline: boolean;
  readOnly: boolean;
  isAllBinders: boolean;
}) {
  const billing = useBillingContext();
  const premium = billing?.premium !== false;
  const [checks, setChecks] = useState<Record<string, CardPriceCheck | null>>({});
  // oxlint-disable-next-line react-doctor/rerender-state-only-in-handlers -- `revision` re-runs the saved-checks effect
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!premium) return;
    let cancelled = false;
    const targets = new Map(
      cards.flatMap(({ scope, card }) =>
        scope === 'owned' && (card.card_language ?? 'en') === 'en'
          ? [[priceCheckKey(card.card_id, card.card_finish ?? 'normal', 'soldcomps'), card] as const]
          : [],
      ),
    );
    void Promise.all(
      [...targets].map(
        async ([key, card]) =>
          [key, await readPinnedCardPriceCheck(card.card_id, card.card_finish ?? 'normal', 'soldcomps')] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setChecks(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [cards, revision, premium]);
  const refined = useMemo(() => buildRefinedValuation(cards, checks), [cards, checks]);
  if (billing && !billing.premium) return null;
  return (
    <section aria-label="Refine binder valuation" className="bg-muted/40 mt-4 space-y-3 rounded-xl p-3 text-sm">
      {!readOnly && (
        <CollectionPriceCheck
          ownerId={ownerId}
          collection={collection}
          kind="owned"
          isOnline={isOnline}
          label="Refine valuation"
          scopeLabel={isAllBinders ? 'all binders' : 'this binder'}
          onComplete={() => setRevision((value) => value + 1)}
        />
      )}
      <p className="text-muted-foreground">
        Use matching sold prices where the evidence is strong enough. Active eBay listings are supporting evidence.
      </p>
      <div>
        <h3 className="font-medium">Sales-based estimate</h3>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {refined.soldCards ? GBP_FORMAT.format(refined.totalGbp) : 'Not enough sold evidence'}
        </p>
        <p className="text-muted-foreground mt-1">
          {refined.soldCards} sold · {refined.fallbackCards} market fallback · {refined.unpricedCards} unpriced
        </p>
        {refined.oldestCheck && (
          <p className="text-muted-foreground mt-1">
            Oldest used sold check: {formatPriceCheckAge(refined.oldestCheck)}.
          </p>
        )}
      </div>
    </section>
  );
}
