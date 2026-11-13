'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { collectionFingerprint } from '@/lib/collection/sync';
import { buildCollectionCsv, collectionCsvFilename } from '@/lib/collection-export';
import { CardPriceComparison } from '@/components/card-price-comparison';
import { CardPriceEvidence } from '@/components/card-price-evidence';
import { CollectionAnalyticsOverview } from '@/components/collection-analytics-overview';
import { BinderValuationRefinement } from '@/components/binder-valuation-refinement';
import { ChartContainer } from '@/components/ui/chart';
import {
  buildCollectionAnalytics,
  normalizeAnalyticsHistory,
  activityDescription,
  type AnalyticsMover,
} from '@/lib/collection-analytics';
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import type { CollectedPokemon } from '@/lib/domain/cards';
import { readBinderScope, rememberBinderScope, type BinderScope } from '@/lib/binders/all-binders';
import { BinderScopeToggle } from '@/components/binder-scope-toggle';
import { Select } from '@/components/ui/select';

interface Props {
  collection: CollectedPokemon[];
  /** Every binder's slots (two or more binders only); enables the This binder / All binders toggle. */
  allBindersCollection?: CollectedPokemon[] | null;
  pricesByKey: Record<string, CardPriceSnapshot>;
  ownerId: string | null;
  readOnly: boolean;
  isOnline: boolean;
  isLoadingPrices?: boolean;
  onBrowsePokemon: (pokemon: { id: number; name: string }) => void;
}
const money = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
const panel = 'min-w-0 border-t border-border/60 py-6';
const button = 'min-h-9 rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-muted';
const emptyHistory = normalizeAnalyticsHistory(null);

/** Saves the CSV. Phones get the share sheet (Files, Drive, mail), everything else a download. Works offline. */
async function exportCollectionCsv(collection: CollectedPokemon[], pricesByKey: Record<string, CardPriceSnapshot>) {
  const file = new File([buildCollectionCsv(collection, pricesByKey)], collectionCsvFilename(), { type: 'text/csv' });
  const isTouch = window.matchMedia?.('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CollectionAnalyticsView(props: Props) {
  // A remount clears private history immediately when the signed-in collection owner changes.
  return <AnalyticsContent key={props.ownerId ?? 'local'} {...props} />;
}

function AnalyticsContent({
  collection: binderCollection,
  allBindersCollection = null,
  pricesByKey,
  ownerId,
  readOnly,
  isOnline,
  isLoadingPrices = false,
  onBrowsePokemon,
}: Props) {
  const [scope, setScope] = useState<BinderScope>(() => readBinderScope('analytics'));
  const isAllBinders = scope === 'all' && allBindersCollection !== null;
  const collection = isAllBinders ? allBindersCollection : binderCollection;
  const summary = useMemo(
    () => buildCollectionAnalytics(collection, pricesByKey, undefined, { countCopies: isAllBinders }),
    [collection, isAllBinders, pricesByKey],
  );
  const historyRef = useRef<HTMLElement>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const selected = summary.cards.find((card) => card.key === selectedKey) ?? summary.cards[0];
  const [history, setHistory] = useState(emptyHistory);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [seriesKey, setSeriesKey] = useState('');
  const revision = useMemo(() => collection.map(collectionFingerprint).join('|'), [collection]);
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    queueMicrotask(() => {
      setCursor(null);
      setRetry((value) => value + 1);
    });
  }, [revision]);
  const cardId = selected?.card.card_id;
  const language = selected?.card.card_language ?? 'en';
  useEffect(() => {
    if (!ownerId || readOnly || !isOnline) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (cardId) {
      params.set('cardId', cardId);
      params.set('language', language);
    }
    if (cursor) params.set('beforeId', cursor);
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return null;
        setLoading(true);
        setError(false);
        return fetch(`/app/api/collection-analytics?${params}`, { signal: controller.signal, cache: 'no-store' });
      })
      .then(async (response) => {
        if (!response) return;
        if (!response.ok) throw new Error('History unavailable');
        const next = normalizeAnalyticsHistory(await response.json());
        if (!controller.signal.aborted)
          setHistory((previous) => ({
            ...next,
            activity: cursor
              ? [
                  ...previous.activity,
                  ...next.activity.filter((event) => !previous.activity.some((old) => old.id === event.id)),
                ]
              : next.activity,
          }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ownerId, readOnly, isOnline, cardId, language, cursor, retry]);
  const points = history.priceHistory.filter(
    (point) =>
      point.card_id === cardId &&
      point.language === language &&
      point.finish === (selected?.card.card_finish ?? 'normal'),
  );
  const series = [...new Set(points.map((point) => `${point.source}:${point.variant_key}`))];
  const activeSeries = series.includes(seriesKey) ? seriesKey : series[0];
  const seriesPoints = points
    .filter((point) => `${point.source}:${point.variant_key}` === activeSeries)
    .sort((a, b) => a.observed_day.localeCompare(b.observed_day));
  const eligible = seriesPoints.filter(
    (point) =>
      (point.confidence === 'high' || point.confidence === 'medium') &&
      point.source_updated_at &&
      Date.parse(point.source_updated_at) <= Date.parse(point.recorded_at) &&
      Date.parse(point.recorded_at) - Date.parse(point.source_updated_at) <= 7 * 86400000,
  );
  const chart = eligible.length
    ? Array.from(
        {
          length:
            Math.floor((Date.parse(eligible.at(-1)!.observed_day) - Date.parse(eligible[0].observed_day)) / 86400000) +
            1,
        },
        (_, index) => {
          const day = new Date(Date.parse(eligible[0].observed_day) + index * 86400000).toISOString().slice(0, 10);
          return { day, value: eligible.find((point) => point.observed_day.slice(0, 10) === day)?.gbp_amount ?? null };
        },
      )
    : [];
  const inspect = (key: string) => {
    setSelectedKey(key);
    setCursor(null);
    historyRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    historyRef.current?.focus({ preventScroll: true });
  };
  const movers = (label: string, entries: AnalyticsMover[]) => (
    <section className={panel} aria-label={label}>
      <h2 className="font-semibold">{label}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Owned and wanted printings, fresh medium or high confidence prices.
      </p>
      {entries.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">No qualifying {label.toLowerCase()} right now.</p>
      ) : (
        <ul className="divide-border/50 mt-3 divide-y">
          {entries.slice(0, 10).map((entry) => (
            <li key={entry.key} className="py-3">
              <button type="button" className="min-h-9 w-full text-left" onClick={() => inspect(entry.key)}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-medium break-words">{entry.card.card_name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {entry.momentum.change > 0 ? '+' : ''}
                    {Math.round(entry.momentum.change * 100)}%
                  </span>
                </span>
                <span className="text-muted-foreground mt-1 block text-sm">
                  {entry.scope} · {entry.card.card_set ?? entry.card.card_id} · {entry.card.card_finish ?? 'normal'} ·{' '}
                  {entry.momentum.source} · {entry.momentum.timeframe}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-6 sm:px-3"
      aria-label="Collection analytics"
    >
      {allBindersCollection ? (
        <div className="pt-3">
          <BinderScopeToggle
            scope={isAllBinders ? 'all' : 'binder'}
            onChange={(next) => {
              setScope(next);
              rememberBinderScope('analytics', next);
            }}
          />
        </div>
      ) : null}
      <header className="flex flex-wrap items-center justify-between gap-3 pt-4 pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1 text-sm">{isAllBinders ? 'All binders' : 'This binder'}</p>
        </div>
        {collection.length > 0 && (
          <button
            type="button"
            className={`${button} inline-flex shrink-0 items-center gap-2`}
            onClick={() => void exportCollectionCsv(collection, pricesByKey)}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
        )}
      </header>
      <CollectionAnalyticsOverview
        key={isAllBinders ? 'all' : 'binder'}
        summary={summary}
        isLoadingPrices={isLoadingPrices}
        isAllBinders={isAllBinders}
        onBrowsePokemon={onBrowsePokemon}
        onInspect={inspect}
        valuationActions={
          <BinderValuationRefinement
            ownerId={ownerId}
            key={isAllBinders ? 'all' : 'binder'}
            cards={summary.cards}
            collection={collection}
            isOnline={isOnline}
            readOnly={readOnly || !ownerId}
            isAllBinders={isAllBinders}
          />
        }
      />
      {!isOnline && (
        <p role="status" className="text-muted-foreground mb-3 text-sm">
          Offline, showing cached collection and prices. Recorded history needs a connection.
        </p>
      )}
      {(summary.rising.length > 0 || summary.falling.length > 0) && (
        <div className="grid gap-x-10 md:grid-cols-2">
          {movers('Rising cards', summary.rising)}
          {movers('Falling cards', summary.falling)}
        </div>
      )}
      <section ref={historyRef} tabIndex={-1} className={`${panel} mt-3 outline-none`} aria-label="Card price history">
        <h2 className="font-semibold">Price over time</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Recorded prices for one printing, last 90 days. This is not your collection’s value over time.
        </p>
        {summary.cards.length > 0 && (
          <label className="mt-3 block text-sm">
            Card
            <Select
              aria-label="History card"
              value={selected?.key ?? ''}
              onChange={(event) => {
                setSelectedKey(event.target.value);
                setCursor(null);
              }}
              className="mt-1 w-full"
            >
              {summary.cards.map((card) => (
                <option key={card.key} value={card.key}>
                  {card.card.card_name} · {card.card.card_set ?? card.card.card_id} ·{' '}
                  {card.card.card_finish ?? 'normal'} · {card.card.card_language ?? 'en'} · {card.scope}
                </option>
              ))}
            </Select>
          </label>
        )}
        {selected && (
          <p className="text-muted-foreground mt-2 text-sm break-words">
            {selected.card.card_id} · {selected.card.card_language ?? 'en'} · {selected.card.card_finish ?? 'normal'}
            {selected.card.added_at && Number.isFinite(Date.parse(selected.card.added_at))
              ? ` · Wanted saved ${new Date(selected.card.added_at).toLocaleDateString('en-GB')}`
              : ''}
          </p>
        )}
        {selected && (
          <button
            type="button"
            className={`${button} mt-2`}
            onClick={() => onBrowsePokemon({ id: selected.pokemonId, name: selected.pokemonName })}
          >
            Browse this Pokémon
          </button>
        )}
        {selected && (
          <details className="mt-3 text-sm">
            <summary className="min-h-9 cursor-pointer py-2">Current price evidence</summary>
            <p className="text-muted-foreground text-sm">
              {selected.amount !== null ? money(selected.amount) : 'Exact finish price unavailable'} ·{' '}
              {selected.price?.source ?? 'Unknown source'} · {selected.price?.confidence ?? 'unknown'} confidence
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Provider trends are averages, separate from daily recorded history.
            </p>
            <CardPriceEvidence price={selected.price ?? undefined} />
            <CardPriceComparison
              key={selected.key}
              cardId={selected.card.card_id}
              searchCard={{ name: selected.card.card_name, setName: selected.card.card_set }}
              language={selected.card.card_language}
              finish={selected.card.card_finish ?? 'normal'}
              catalogMarketGbp={selected.price?.marketGbpAmount ?? selected.price?.gbpAmount}
            />
          </details>
        )}
        {series.length > 0 && (
          <label className="mt-3 block text-sm">
            Price source
            <Select
              aria-label="History source"
              value={activeSeries}
              onChange={(event) => setSeriesKey(event.target.value)}
              className="ml-2"
            >
              {series.map((key) => (
                <option key={key} value={key}>
                  {key.replace(':', ' · ')}
                </option>
              ))}
            </Select>
          </label>
        )}
        {ownerId && !readOnly && isOnline && !error && history.historyAvailable && eligible.length >= 2 ? (
          <ChartContainer
            config={{ value: { label: 'GBP', color: 'var(--primary)' } }}
            className="mt-6 aspect-auto h-56 w-full sm:h-72"
          >
            <LineChart accessibilityLayer data={chart} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
              <XAxis
                tick={{ fill: 'var(--muted-foreground)' }}
                dataKey="day"
                tickFormatter={(day) =>
                  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'UTC',
                  })
                }
                fontSize={12}
                minTickGap={40}
                tickLine={false}
                axisLine={false}
                tickMargin={12}
              />
              <YAxis
                tick={{ fill: 'var(--muted-foreground)' }}
                tickFormatter={(value) => `£${value}`}
                width={60}
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                formatter={(value) => money(Number(value))}
              />
              <Line
                dataKey="value"
                type="linear"
                stroke="var(--color-value)"
                strokeWidth={2}
                connectNulls={false}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground mt-4 text-sm">
            {!isOnline
              ? 'Recorded history needs a connection. Your collection overview is available offline.'
              : !ownerId
                ? 'Sign in to record private history.'
                : loading
                  ? 'Loading recorded history…'
                  : error
                    ? 'Recorded history is unavailable.'
                    : !history.historyAvailable
                      ? 'History tracking is not available yet.'
                      : 'Collecting history. At least two reliable observations are needed for a chart.'}
          </p>
        )}
        {seriesPoints.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="min-h-9 cursor-pointer py-2">All recorded observations ({seriesPoints.length})</summary>
            <ul className="max-h-52 overflow-y-auto text-sm">
              {seriesPoints.map((point) => (
                <li key={point.observed_day} className="flex justify-between gap-2 py-2">
                  <span>
                    {point.observed_day.slice(0, 10)} · {point.confidence} confidence
                    {!eligible.includes(point) ? ' · excluded from chart' : ''}
                  </span>
                  <span>{money(point.gbp_amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className={`${panel} mt-3`} aria-label="Collection activity">
        <h2 className="font-semibold">Collection activity</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Account-wide changes across all binders. Synced dates are server changes, not acquisition dates.
        </p>
        {ownerId && !readOnly && isOnline && (
          <ul className="divide-border/50 mt-3 divide-y">
            {history.activity.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <p className="break-words">{activityDescription(event)}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Synced {new Date(event.recorded_at).toLocaleString('en-GB')}
                </p>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm">
            Could not refresh activity. Previously loaded entries may be out of date.
          </p>
        )}
        {history.activity.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">
            {!ownerId ? 'Sign in to record collection activity.' : 'No committed activity recorded yet.'}
          </p>
        )}
        {ownerId && isOnline && !readOnly && (
          <button
            type="button"
            className={`${button} mt-3`}
            disabled={loading}
            onClick={() => {
              setCursor(null);
              setRetry((value) => value + 1);
            }}
          >
            {error ? 'Retry history' : 'Refresh history'}
          </button>
        )}
        {history.nextCursor && !error && isOnline && (
          <button
            type="button"
            className={`${button} mt-3`}
            disabled={loading}
            onClick={() => setCursor(history.nextCursor)}
          >
            Load older activity
          </button>
        )}
        <details className="mt-3 text-sm">
          <summary className="min-h-9 cursor-pointer py-2">Legacy saved dates</summary>
          <ul className="max-h-52 overflow-y-auto text-sm">
            {collection
              .filter((item) => Number.isFinite(Date.parse(item.collected_at)))
              .map((item) => (
                <li key={item.id} className="py-2">
                  {item.pokemon_name} · Legacy saved {new Date(item.collected_at).toLocaleDateString('en-GB')}
                </li>
              ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
