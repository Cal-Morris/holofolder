'use client';

import { useBillingContext } from '@/hooks/use-billing';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { readSavedCardPriceChecks, requestCardPriceCheck } from '@/lib/card-price-check-client';
import { isPriceCheckFresh, readPinnedCardPriceChecks } from '@/lib/card-price-check-cache';
import { PriceCheckRecords } from '@/components/price-check-records';
import { DealPriceScale } from '@/components/deal-price-scale';
import { Button } from '@/components/ui/button';
import { formatGbpAmount } from '@/lib/price-format';
import { type CardPriceChecks, type CardPriceCheck, type PriceCheckSource } from '@/lib/card-price-checks';
import { buildSoldPriceGuide } from '@/lib/sold-price-guide';
import { readDealThresholds, type DealThresholds } from '@/lib/deal-check';
import { getClassicCollectionPrinting } from '@/lib/classic-collection-printing';
import {
  cardListingSearchQuery,
  ebayOpenListingsUrl,
  ebaySoldListingsUrl,
  type ListingSearchCard,
} from '@/lib/ebay-search-urls';
import type { CardFinish } from '@/lib/domain/cards';

const ComparisonChart = dynamic(() => import('@/components/card-price-comparison-chart'), {
  ssr: false,
  loading: () => <div className="h-56" aria-hidden="true" />,
});

export function CardPriceComparison({
  cardId,
  searchCard,
  language = 'en',
  finish,
  catalogMarketGbp,
  thresholds: givenThresholds,
  onSoldCheck,
  offerGbp,
  showBuyingScale = true,
  readOnly = false,
}: {
  cardId: string;
  searchCard: Omit<ListingSearchCard, 'cardId'>;
  language?: string;
  finish?: CardFinish;
  catalogMarketGbp?: number | null;
  thresholds?: DealThresholds;
  onSoldCheck?: (check: CardPriceCheck) => void;
  offerGbp?: number | null;
  showBuyingScale?: boolean;
  readOnly?: boolean;
}) {
  const billing = useBillingContext();
  const premium = billing?.premium === true;
  const [result, setResult] = useState<CardPriceChecks | null>(null);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  const [pending, setPending] = useState({ ebay: false, soldcomps: false });
  const [error, setError] = useState<string | null>(null);
  const [savedThresholds] = useState(() =>
    readDealThresholds(typeof window === 'undefined' ? undefined : window.localStorage),
  );
  const onSoldCheckRef = useRef(onSoldCheck);
  useEffect(() => {
    onSoldCheckRef.current = onSoldCheck;
  });
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- tells the host about each sold check, whether it came from a saved read or a manual check
    if (result?.soldcomps) onSoldCheckRef.current?.(result.soldcomps);
  }, [result?.soldcomps]);
  // Paint the offline copy first, then read shared saved checks without spending provider credits.
  useEffect(() => {
    if (language !== 'en' || finish === 'jumbo' || !premium) return;
    const controller = new AbortController();
    function showSaved(checks: CardPriceChecks) {
      if (controller.signal.aborted) return;
      setResult((previous) => {
        const next: CardPriceChecks = { ebay: null, soldcomps: null, ...previous, errors: { ...previous?.errors } };
        for (const source of ['ebay', 'soldcomps'] as const) {
          const check = checks[source];
          if (check && (!next[source] || Date.parse(check.checkedAt) > Date.parse(next[source].checkedAt)))
            next[source] = check;
        }
        return next.ebay || next.soldcomps ? next : previous;
      });
    }
    void (async () => {
      showSaved({ ...(await readPinnedCardPriceChecks(cardId, finish)), errors: {} });
      if (controller.signal.aborted || !navigator.onLine) return;
      try {
        showSaved(await readSavedCardPriceChecks(cardId, language, finish, controller.signal));
      } catch {
        // Keep the offline copy and manual check available when saved checks cannot be read.
      }
    })();
    return () => controller.abort();
  }, [cardId, language, finish, premium]);
  if (language !== 'en' || finish === 'jumbo') return null;
  const exactFinish = finish && ['normal', 'holo', 'reverse_holo'].includes(finish) ? finish : 'any';
  const query = cardListingSearchQuery({ cardId, ...searchCard }, finish);
  const useSavedLinks = !getClassicCollectionPrinting(cardId);
  const openUrl = (useSavedLinks && result?.ebay?.searchUrl) || ebayOpenListingsUrl(query);
  const soldUrl = (useSavedLinks && result?.soldcomps?.searchUrl) || ebaySoldListingsUrl(query);
  const loading = pending.ebay || pending.soldcomps;
  const guide = buildSoldPriceGuide(result?.soldcomps, catalogMarketGbp, finish, givenThresholds ?? savedThresholds);

  async function checkSource(source: PriceCheckSource, signal: AbortSignal, refresh: boolean) {
    try {
      const { check, error } = await requestCardPriceCheck(cardId, language, finish, source, signal, refresh);
      if (signal.aborted) return;
      setResult((previous) => ({
        ebay: null,
        soldcomps: null,
        ...previous,
        [source]: check,
        errors: { ...previous?.errors, [source]: error },
      }));
    } catch (failure) {
      if (signal.aborted) return;
      const message =
        failure instanceof Error && failure.name !== 'TimeoutError'
          ? failure.message
          : 'Price check timed out. Try again later.';
      setResult((previous) => ({
        ebay: null,
        soldcomps: null,
        ...previous,
        errors: { ...previous?.errors, [source]: message },
      }));
    } finally {
      if (!signal.aborted) setPending((previous) => ({ ...previous, [source]: false }));
    }
  }

  async function checkPrices(refresh = false) {
    if (readOnly || loading) return;
    if (!navigator.onLine) {
      setError('Connect to the internet to check prices.');
      return;
    }
    setError(null);
    setResult((previous) => ({ ebay: null, soldcomps: null, ...previous, errors: {} }));
    const stale = (['ebay', 'soldcomps'] as const).filter((source) =>
      refresh ? !isPriceCheckFresh(result?.[source]) : !result?.[source],
    );
    if (stale.length === 0) {
      setError('Showing saved checks from the last 30 hours.');
      return;
    }
    setPending({ ebay: stale.includes('ebay'), soldcomps: stale.includes('soldcomps') });
    const controller = new AbortController();
    requestController.current = controller;
    await Promise.all(stale.map((source) => checkSource(source, controller.signal, refresh)));
  }

  if (billing && !billing.premium && readOnly) return null;
  if (billing && !billing.premium)
    return (
      <section aria-label="Price comparisons" className="mt-2 rounded-xl border p-3">
        <p className="text-sm">Sold comps are included with Holo Folder Premium.</p>
        <Button className="mt-2 min-h-11 w-full" onClick={billing.upgrade}>
          Unlock price comparisons
        </Button>
      </section>
    );

  return (
    <section
      aria-label="Price comparisons"
      className="border-border/45 bg-background/35 mt-2 rounded-xl border px-2.5 py-2 text-xs"
    >
      <p className="font-semibold">eBay listings + sold comps</p>
      <p className="text-muted-foreground mt-1">
        {readOnly
          ? 'Saved evidence only · read-only comparison'
          : 'Manual checks · saved permanently · refresh manually'}
      </p>
      <div className="flex flex-wrap gap-x-4">
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center font-semibold underline"
        >
          View open listings ↗
        </a>
        <a
          href={soldUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center font-semibold underline"
        >
          View sold listings ↗
        </a>
      </div>
      {error ? (
        <p role="status" className="text-muted-foreground mt-2">
          {error}
        </p>
      ) : null}
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 min-h-14 w-full rounded-2xl text-base font-bold"
          onClick={() => void checkPrices(Boolean(result?.ebay || result?.soldcomps))}
          disabled={loading}
        >
          {loading ? 'Checking prices…' : result?.ebay || result?.soldcomps ? 'Refresh prices' : 'Check prices'}
        </Button>
      )}
      {result ? (
        <div className="mt-2 grid gap-1.5" aria-live="polite">
          {(['ebay', 'soldcomps'] as const).map((source) => (
            <div
              key={source}
              className="border-border/45 bg-background/35 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-2.5 py-1.5 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className="min-w-0">
                <p className="text-foreground font-semibold">{source === 'ebay' ? 'eBay UK asking' : 'eBay UK sold'}</p>
                {pending[source] ? <p role="status">Checking {source === 'ebay' ? 'eBay' : 'sold comps'}…</p> : null}
                {result[source]?.summary.count ? (
                  <p>
                    <strong>{formatGbpAmount(result[source]!.summary.median)}</strong> median{' '}
                    {source === 'ebay' ? 'asking' : 'sold'} price · {result[source]!.summary.count} matched{' '}
                    {source === 'ebay' ? 'listings' : 'sales'}
                  </p>
                ) : result[source] ? (
                  <p>No matching {source === 'ebay' ? 'listings' : 'sales'} in the search sample.</p>
                ) : !pending[source] && !result.errors[source] ? (
                  <p className="text-muted-foreground">Not checked yet</p>
                ) : null}
                {result[source] && !pending[source] ? (
                  <p className="text-muted-foreground" data-testid={`price-check-age-${source}`}>
                    Last checked on{' '}
                    <time dateTime={result[source]!.checkedAt}>
                      {new Date(result[source]!.checkedAt).toLocaleDateString('en-GB')}
                    </time>
                    {isPriceCheckFresh(result[source]) ? '' : ' · older snapshot'}
                  </p>
                ) : null}
                {result.errors[source] ? (
                  <p role="status" className="text-muted-foreground">
                    {result.errors[source]}
                    {result[source] ? ' Showing the saved check.' : ''}
                  </p>
                ) : null}
              </div>
              {result[source]?.summary.count ? (
                <div className="text-muted-foreground text-right tabular-nums">
                  <p>Low {formatGbpAmount(result[source]!.summary.low)}</p>
                  <p>High {formatGbpAmount(result[source]!.summary.high)}</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {result ? <PriceCheckRecords checks={result} showLinks={false} /> : null}
      {result && (result.ebay || result.soldcomps) ? (
        <ComparisonChart
          sold={result.soldcomps}
          asking={result.ebay}
          marketGbp={guide?.referenceGbp ?? catalogMarketGbp}
          thresholds={givenThresholds ?? savedThresholds}
          offerGbp={offerGbp}
        />
      ) : null}
      {showBuyingScale && guide?.eligible ? (
        <DealPriceScale
          market={guide.referenceGbp!}
          overlap={guide.fairOverlap}
          thresholds={givenThresholds ?? savedThresholds}
          money={(value) => formatGbpAmount(value) ?? ''}
        />
      ) : null}
      {result ? (
        <details className="mt-1">
          <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Evidence</summary>
          <div className="text-muted-foreground space-y-2">
            {guide ? (
              <p>
                {guide.reason} {guide.count} recent sales across {guide.days} dates. Conditions vary.
              </p>
            ) : null}
            {guide?.eligible && guide.fairOverlap ? (
              <p>
                Fair-range agreement with catalogue: {formatGbpAmount(guide.fairOverlap.low)} to{' '}
                {formatGbpAmount(guide.fairOverlap.high)}.
              </p>
            ) : null}
            {(['ebay', 'soldcomps'] as const).map((source) => {
              const check = result[source];
              return check ? (
                <div key={source}>
                  <p>
                    {source === 'ebay' ? 'eBay UK asking prices' : 'SaleHistory UK sold comps'} · Range{' '}
                    {formatGbpAmount(check.summary.low)} to {formatGbpAmount(check.summary.high)}. Postage excluded.
                  </p>
                  <p>
                    Last checked on {new Date(check.checkedAt).toLocaleString('en-GB')}. Conditions
                    {exactFinish === 'any' ? ' and finishes' : ''} vary
                    {source === 'soldcomps'
                      ? '; sales from the last 90 days, hidden offers excluded'
                      : '; current asking snapshot, not historical asking prices'}
                    .
                  </p>
                </div>
              ) : null;
            })}
            <p>
              Fair / expected is centred on the market reference using your Fair tolerance. Green marks bargains; amber
              and red mark prices above market. Purple outlines agreement with the catalogue fair range. Only qualified
              sold evidence changes the guide.
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
