'use client';

// Show mode's bundle check: several cards for one asking total ("all three for £20"), judged against their
// combined market price.
import {
  nativeCardConsumers,
  nativeCardState,
  nativeCardLabel,
  type NativeConsumerBinding,
} from '@/lib/collection/native-card-consumers';
import { useBillingContext } from '@/hooks/use-billing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Trash2, X } from 'lucide-react';
import ShowBudget from '@/components/show-budget';
import { checkBundle, parseAskingPrice, readDealThresholds } from '@/lib/deal-check';
import { requestCardPriceCheck } from '@/lib/card-price-check-client';
import type { CardPriceCheck, CardPriceChecks, PriceCheckSource } from '@/lib/card-price-checks';
import { buildBundlePriceGuide } from '@/lib/bundle-price-guide';
import { PriceCheckRecords } from '@/components/price-check-records';
import { DealPriceScale } from '@/components/deal-price-scale';
import { formatMoney } from '@/lib/regional-price';
import { formatCardNumber } from '@/lib/pokemon-card-browse';
import { formatCardFinishLabel } from '@/lib/card-labels';
import type { DisplayCurrency } from '@/lib/pricing-region';
import { DealPriceInput, DealVerdictPanel, PinnedDealVerdict } from '@/components/deal-keypad';
import type { QuickBundleEntry } from '@/components/quick-card-check';

export interface QuickBundleProps {
  nativeConsumer?: NativeConsumerBinding;
  entries: QuickBundleEntry[];
  budgetKey?: string | null;
  currency: DisplayCurrency;
  onBack: () => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onSoldCheck: (key: string, check: CardPriceCheck) => void;
}

export default function QuickBundle({
  nativeConsumer,
  budgetKey,
  entries,
  currency,
  onBack,
  onRemove,
  onClear,
  onSoldCheck,
}: QuickBundleProps) {
  const nativeModel = useMemo(() => (nativeConsumer ? nativeCardConsumers(nativeConsumer) : null), [nativeConsumer]);
  const billing = useBillingContext();
  const premium = billing?.premium !== false;
  const [input, setInput] = useState('');
  const [thresholds] = useState(() =>
    readDealThresholds(typeof window === 'undefined' ? undefined : window.localStorage),
  );
  const moneyCurrency = entries[0]?.currency ?? currency;
  const money = useCallback((amount: number) => formatMoney(amount, moneyCurrency), [moneyCurrency]);
  const askingTotal = parseAskingPrice(input);
  const [now, setNow] = useState(() => Date.now());
  const native = Boolean(nativeConsumer);
  useEffect(() => {
    if (!native) return;
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [native]);
  const guide = useMemo(
    () => buildBundlePriceGuide(entries, moneyCurrency, thresholds, native ? now : undefined, premium, native),
    [entries, moneyCurrency, thresholds, premium, native, now],
  );
  const pricedEntries = entries.map((entry, index) => ({ ...entry, marketPrice: guide.items[index].marketPrice }));
  const result = checkBundle(pricedEntries, askingTotal, thresholds, Boolean(nativeConsumer));
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<Record<string, CardPriceChecks>>({});
  const [pending, setPending] = useState<Record<string, Partial<Record<PriceCheckSource, boolean>>>>({});
  const [error, setError] = useState<string | null>(null);
  async function checkPrices() {
    if (nativeConsumer) return;
    if (!premium) {
      billing?.upgrade();
      return;
    }
    if (checking) return;
    if (!navigator.onLine) {
      setError('Connect to the internet to check prices.');
      return;
    }
    setError(null);
    setChecking(true);
    const abort = new AbortController();
    controller.current = abort;
    const supported = entries.filter((entry) => (entry.card.language ?? 'en') === 'en' && entry.finish !== 'jumbo');
    setPending(Object.fromEntries(supported.map((entry) => [entry.key, { ebay: true, soldcomps: true }])));
    let cursor = 0;
    async function worker() {
      while (cursor < supported.length && !abort.signal.aborted) {
        const entry = supported[cursor++];
        await Promise.all(
          (['ebay', 'soldcomps'] as const).map(async (source) => {
            try {
              const { check, error } = await requestCardPriceCheck(
                entry.card.id,
                entry.card.language ?? 'en',
                entry.finish,
                source,
                abort.signal,
              );
              if (abort.signal.aborted) return;
              setChecks((previous) => ({
                ...previous,
                [entry.key]: {
                  ...(previous[entry.key] ?? { ebay: null, soldcomps: null }),
                  [source]: check,
                  errors: { ...previous[entry.key]?.errors, [source]: error },
                },
              }));
              if (source === 'soldcomps' && check) onSoldCheck(entry.key, check);
            } catch (failure) {
              if (abort.signal.aborted) return;
              const message =
                failure instanceof Error && failure.name !== 'TimeoutError'
                  ? failure.message
                  : 'Price check timed out. Try again later.';
              setChecks((previous) => ({
                ...previous,
                [entry.key]: {
                  ...(previous[entry.key] ?? { ebay: null, soldcomps: null }),
                  errors: { ...previous[entry.key]?.errors, [source]: message },
                },
              }));
            } finally {
              if (!abort.signal.aborted)
                setPending((previous) => ({ ...previous, [entry.key]: { ...previous[entry.key], [source]: false } }));
            }
          }),
        );
      }
    }
    await Promise.all([worker(), worker()]);
    if (!abort.signal.aborted) setChecking(false);
  }
  const verdictEmptyText =
    nativeConsumer && !guide.complete
      ? 'Incomplete price evidence. Every selected printing needs a saved reference in the same currency, so no bundle verdict.'
      : result.marketTotal > 0
        ? `Type the asking total. Pay up to ${money(result.marketTotal * (1 + thresholds.fairPct / 100))}.`
        : 'No market prices for these cards yet.';

  return (
    <section aria-label="Bundle" className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="quick-bundle">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-3 pt-2 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to results"
            className="bg-muted/70 flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg leading-tight font-bold">
              Bundle · {entries.length} card{entries.length === 1 ? '' : 's'}
            </h3>
            <p className="text-muted-foreground text-xs" data-testid="bundle-market-total">
              {nativeConsumer && !guide.complete ? 'Saved subtotal' : 'Reference'} {money(result.marketTotal)}
              {result.unpricedCount > 0 ? ` · ${result.unpricedCount} unpriced` : ''}
            </p>
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear bundle"
              className="text-muted-foreground hover:bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>

        {nativeConsumer && (
          <section aria-label="Bundle comparison" className="border-border/60 rounded-xl border p-3 text-sm">
            <p className="font-semibold">Read-only comparison</p>
            <p>
              {nativeModel?.kind === 'cached'
                ? 'Cached only, read-only'
                : nativeModel
                  ? 'Saved scoped inventory'
                  : 'Ownership unavailable'}
              . Selected printings are lookups, not copies to acquire.
            </p>
          </section>
        )}
        <ul className="flex flex-col gap-1" aria-label="Cards in bundle">
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              className="border-border/50 bg-card flex min-h-12 items-center gap-2 rounded-xl border pr-1 pl-3"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{entry.card.name}</span>
                {nativeConsumer && (
                  <span className="text-muted-foreground block text-xs">
                    {nativeCardLabel(nativeCardState(nativeModel, entry.card, entry.finish))}
                  </span>
                )}
                <span className="text-muted-foreground block text-[10px]">
                  {guide.items[index].source === 'sold'
                    ? 'Sold reference'
                    : guide.items[index].source === 'catalogue'
                      ? 'Catalogue reference'
                      : guide.items[index].source === 'saved'
                        ? 'Saved reference'
                        : 'No reference'}
                </span>
                <span className="text-muted-foreground block text-[10px]" aria-live="polite">
                  {(['ebay', 'soldcomps'] as const).map((source) => {
                    const label = source === 'ebay' ? 'eBay' : 'Sold';
                    if (!premium) return null;
                    const check = checks[entry.key]?.[source];
                    return (
                      <span key={source} className="mr-2 inline-block">
                        {pending[entry.key]?.[source]
                          ? `${label}: checking…`
                          : checks[entry.key]?.errors[source]
                            ? `${label}: ${checks[entry.key].errors[source]}`
                            : check
                              ? `${label}: ${check.summary.count} matches`
                              : ''}
                      </span>
                    );
                  })}
                </span>
                {(entry.card.language ?? 'en') !== 'en' || entry.finish === 'jumbo' ? (
                  <span className="text-muted-foreground block text-[10px]">
                    Provider checks unavailable for this printing
                  </span>
                ) : null}
                <span className="text-muted-foreground block truncate text-[11px]">
                  {entry.card.set.name} · {formatCardNumber(entry.card)}
                  {nativeConsumer ? ` · ${entry.card.language ?? 'Unknown language'}` : ''} ·{' '}
                  {formatCardFinishLabel(entry.finish)}
                </span>
                {premium && <PriceCheckRecords checks={checks[entry.key]} />}
              </div>
              <span className="text-sm font-bold tabular-nums">
                {guide.items[index].marketPrice !== null ? money(guide.items[index].marketPrice!) : 'No price'}
              </span>
              <button
                type="button"
                onClick={() => onRemove(entry.key)}
                aria-label={`Remove ${entry.card.name} from bundle`}
                className="text-muted-foreground hover:bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="text-muted-foreground px-1 py-4 text-center text-sm">
              Add cards with Bundle on each card&apos;s check.
            </li>
          )}
        </ul>

        {!nativeConsumer && (
          <>
            <button
              type="button"
              onClick={() => void checkPrices()}
              disabled={checking || entries.length === 0}
              className="border-primary/40 bg-primary/10 min-h-14 rounded-2xl border px-4 text-base font-semibold disabled:opacity-50"
            >
              {!premium ? 'Unlock bundle comparisons' : checking ? 'Checking bundle prices…' : 'Check bundle prices'}
            </button>
            <p className="text-muted-foreground text-[11px]">
              Checks each English card and finish, reuses saved results until you refresh them on the card.{' '}
              {guide.items.filter((item) => item.source === 'sold').length} of {entries.length} use qualified sold
              evidence.
            </p>
          </>
        )}
        {nativeConsumer && (
          <p className="text-muted-foreground text-[11px]">
            Saved price evidence only. No provider checks, purchase recording or ownership changes. Each selected entry
            counts once, including repeated printings.
          </p>
        )}
        {error ? (
          <p role="status" className="text-muted-foreground text-xs">
            {error}
          </p>
        ) : null}
        <DealVerdictPanel deal={result.deal} money={money} testId="bundle-verdict" emptyText={verdictEmptyText} />
      </div>

      <div className="border-border/50 bg-card/95 min-w-0 shrink-0 border-t px-3 pt-2 pb-[calc(var(--safe-bottom)+0.75rem)]">
        {guide.marketTotal > 0 && (!nativeConsumer || guide.complete) ? (
          <DealPriceScale
            market={guide.marketTotal}
            offer={askingTotal}
            overlap={guide.overlap}
            thresholds={thresholds}
            money={money}
            partial={!guide.complete}
          />
        ) : null}
        <PinnedDealVerdict
          deal={result.deal}
          money={money}
          testId="bundle-verdict-pinned"
          emptyText={verdictEmptyText}
        />
        {!nativeConsumer && budgetKey && <ShowBudget compact storageKey={budgetKey} currency={moneyCurrency} />}
        <DealPriceInput value={input} onChange={setInput} label="Bundle price" />
      </div>
    </section>
  );
}
