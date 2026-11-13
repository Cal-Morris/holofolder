'use client';

import { useMemo, useState } from 'react';
import { ChartPie, Coins, Heart, Layers3, LayoutGrid, PawPrint, Target, TrendingDown, TrendingUp } from 'lucide-react';
import AnalyticsCardLine from '@/components/analytics/card-line';
import AnalyticsConfidenceDonut from '@/components/analytics/confidence-donut';
import AnalyticsMoversList from '@/components/analytics/movers-list';
import AnalyticsPanel from '@/components/analytics/panel';
import AnalyticsWantListPanel from '@/components/analytics/want-list-panel';
import AnalyticsYourCardsPanel from '@/components/analytics/your-cards-panel';
import { Select } from '@/components/ui/select';
import { useInventoryPriceState } from '@/hooks/use-inventory-prices';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { buildCollectionInsights, buildWantListInsights, insightDetail } from '@/lib/collection/analytics-insights';
import { buildNativeAnalytics, nativeValueNote } from '@/lib/collection/native-analytics';
import {
  navigationIndex,
  type CollectionNavigationRead,
  type CollectionNavigationScope,
} from '@/lib/collection-navigation';
import { formatGbpAmount } from '@/lib/price-format';
import type { PricingRegion } from '@/lib/pricing-region';
import { buildWantedDashboardSummary, wantedPriceLookups, wantedPricesByKey } from '@/lib/wanted-dashboard';

type Props = {
  scope: CollectionNavigationScope;
  read: CollectionNavigationRead;
  collectionId?: string;
  region?: PricingRegion;
};
const money = (n: number | null) => formatGbpAmount(n) ?? 'Unknown';
const bar = 'bg-muted h-2 overflow-hidden rounded-full';
const fill = 'holo-progress bg-highlight h-full rounded-full';

export default function NativeCollectionAnalytics(props: Props) {
  return <ScopedAnalytics key={JSON.stringify([props.scope, props.collectionId])} {...props} />;
}

function ScopedAnalytics({ scope, read, collectionId, region = 'UK' }: Props) {
  const [all, setAll] = useState(!collectionId);
  const selected = all ? undefined : collectionId;
  const index = useMemo(() => navigationIndex(scope, read), [scope, read]);
  const wants = useMemo(
    () => (index.projection?.wants ?? []).filter((w) => !selected || w.collectionId === selected),
    [index.projection, selected],
  );
  // One saved-price read for owned and wanted cards; each side only uses the printings it asks for.
  const saved = useInventoryPriceState([
    ...(index.projection?.priceRequests ?? []),
    ...wantedPriceLookups(wants.map((w) => w.card)),
  ]);
  const summary = useMemo(
    () => buildNativeAnalytics(scope, read, selected, saved.prices, region),
    [scope, read, selected, saved.prices, region],
  );
  const insights = useMemo(() => summary && buildCollectionInsights(summary.rows, summary.copies), [summary]);
  const wanted = useMemo(() => {
    const names = new Map(index.collections.map((c) => [c.id, c.name]));
    return buildWantListInsights(
      buildWantedDashboardSummary(
        wants.map((w) => ({
          pokemonId: 0,
          pokemonName: w.card.card_name,
          card: w.card,
          binderId: w.collectionId,
          binderName: names.get(w.collectionId),
        })),
        wantedPricesByKey(saved.prices, region),
      ).cards,
    );
  }, [wants, saved.prices, region, index.collections]);

  if (!summary || !insights)
    return (
      <section aria-label="Collection analytics" className="shrink-0 p-3" role="status">
        <h2>Your totals couldn&apos;t be loaded</h2>
        <p>Check your connection and try again. This doesn&apos;t mean you own no cards.</p>
      </section>
    );
  const maxSet = Math.max(0, ...insights.valueBySet.map((s) => s.valueGbp));
  const stats = [
    { icon: Layers3, label: summary.physicalCopies === 1 ? 'Card' : 'Cards', value: summary.physicalCopies },
    { icon: PawPrint, label: 'Pokémon', value: summary.uniqueSpecies },
    { icon: LayoutGrid, label: 'Sets', value: insights.setCount },
    { icon: Heart, label: 'Wanted', value: summary.explicitWants },
  ];

  return (
    <section
      aria-label="Collection analytics"
      aria-busy={saved.status === 'loading'}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[max(0.75rem,calc((100%-72rem)/2+1rem))] pt-3 pb-[var(--dock-clearance)] sm:pt-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">Collection analytics</h1>
        <Select
          aria-label="Analytics storage scope"
          className="max-w-full"
          value={all ? 'all' : 'selected'}
          onChange={(e) => setAll(e.target.value === 'all')}
        >
          {collectionId && <option value="selected">This collection</option>}
          <option value="all">Everything, including cards not in a binder</option>
        </Select>
      </header>
      {summary.kind === 'cached' && (
        <p role="status" className="text-muted-foreground mt-2 text-sm">
          Showing what was last saved on this device.
        </p>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-label="Collection value" className="holo-tile border-border/60 rounded-2xl border p-4">
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Coins className="size-4" aria-hidden="true" />
            Collection value
          </p>
          <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
            {saved.status === 'loading' && summary.rawValueGbp === null ? '…' : money(summary.rawValueGbp)}
          </p>
          <div
            role="progressbar"
            aria-label="Cards priced"
            aria-valuenow={summary.pricedCopies}
            aria-valuemin={0}
            aria-valuemax={summary.physicalCopies}
            className={`${bar} mt-4`}
          >
            <div
              className={fill}
              style={{
                width: `${summary.physicalCopies ? (summary.pricedCopies / summary.physicalCopies) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            {saved.status === 'loading'
              ? 'Loading saved prices…'
              : saved.status === 'unavailable'
                ? "Saved prices couldn't be loaded. Check your connection."
                : `${summary.pricedCopies} of ${summary.physicalCopies} cards priced${nativeValueNote(summary)}`}
            {summary.gradedUnknownCopies > 0 ? ` · ${summary.gradedUnknownCopies} graded not valued` : ''}
          </p>
          <details className="text-muted-foreground mt-1 text-sm">
            <summary className="min-h-9 cursor-pointer py-2">How this is worked out</summary>
            <p>
              From saved prices for the exact version of each card, the same prices the card details show. Low
              confidence prices are included and counted above. Graded cards and cards without a price are left out.{' '}
              {summary.oldestQuoteAt
                ? `Oldest price used: ${summary.oldestQuoteAt.slice(0, 10)}.`
                : 'No saved prices yet.'}
            </p>
          </details>
          {summary.unknownSpeciesCopies > 0 && (
            <p className="mt-1 text-sm">{summary.unknownSpeciesCopies} cards aren&apos;t linked to a Pokémon.</p>
          )}
          {summary.unknownTargets > 0 && (
            <p className="text-sm">
              {summary.unknownTargets} placed cards couldn&apos;t be checked against their pocket.
            </p>
          )}
        </section>
        <ul className="grid grid-cols-2 gap-3" aria-label="Collection counts">
          {stats.map(({ icon: Icon, label, value }) => (
            <li
              key={label}
              className="holo-tile border-border/60 flex min-w-0 items-center gap-3 rounded-2xl border p-3"
            >
              <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-lg leading-tight font-semibold tabular-nums">{value}</p>
                <p className="text-muted-foreground truncate text-xs">{label}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <AnalyticsPanel icon={Coins} title="Most valuable">
          {insights.topCards.length ? (
            <ul className="divide-border/50 -my-2 divide-y">
              {insights.topCards.map((card) => (
                <AnalyticsCardLine
                  key={card.key}
                  name={card.name}
                  image={card.image}
                  detail={insightDetail(card)}
                  amount={money(card.amountGbp)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No priced cards yet.</p>
          )}
        </AnalyticsPanel>
        <AnalyticsPanel icon={ChartPie} title="Where the value is" note="By set, from the same prices as the total.">
          <ul className="space-y-3">
            {insights.valueBySet.map((set) => (
              <li key={set.name} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{set.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {set.valueGbp > 0 ? money(set.valueGbp) : '—'}
                    <span className="text-muted-foreground">
                      {' '}
                      · {set.copies} {set.copies === 1 ? 'card' : 'cards'}
                    </span>
                  </span>
                </div>
                <div className={`${bar} mt-1 h-1.5`} aria-hidden="true">
                  <div className={fill} style={{ width: `${maxSet ? (set.valueGbp / maxSet) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </AnalyticsPanel>
        <AnalyticsPanel icon={TrendingUp} title="Rising in your collection" note="Against the 7 or 30 day average.">
          <AnalyticsMoversList cards={insights.rising} rising />
        </AnalyticsPanel>
        <AnalyticsPanel icon={TrendingDown} title="Falling in your collection" note="Against the 7 or 30 day average.">
          <AnalyticsMoversList cards={insights.falling} rising={false} />
        </AnalyticsPanel>
      </div>

      {wanted.count > 0 && <AnalyticsWantListPanel insights={wanted} />}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <AnalyticsPanel icon={Target} title="Progress" note="Counts the pockets each binder is set up for.">
          <ul className="space-y-3">
            {summary.goals.map((g) => (
              <li key={g.collectionId} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{g.name}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {g.targetCount ? `${g.completedTargetCount} / ${g.targetCount}` : `${g.assignedCount} placed`}
                  </span>
                </div>
                {g.targetCount ? (
                  <div
                    role="progressbar"
                    aria-label={`${g.name} progress`}
                    aria-valuenow={g.completedTargetCount}
                    aria-valuemin={0}
                    aria-valuemax={g.targetCount}
                    className={`${bar} mt-1`}
                  >
                    <div className={fill} style={{ width: `${(g.completedTargetCount / g.targetCount) * 100}%` }} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">Nothing to collect yet · {g.slots} pockets</p>
                )}
              </li>
            ))}
          </ul>
        </AnalyticsPanel>
        <AnalyticsPanel icon={ChartPie} title="Price confidence" note="How much of the total rests on reliable prices.">
          <AnalyticsConfidenceDonut counts={insights.confidence} />
          {(insights.languages.length > 1 || insights.finishes.length > 1) && (
            <p className="text-muted-foreground mt-3 text-sm">
              {[
                ...insights.languages.map(([l, n]) => `${n} ${formatCardLanguageLabel(l)}`),
                ...insights.finishes.map(([f, n]) => `${n} ${formatCardFinishLabel(f)}`),
              ].join(' · ')}
            </p>
          )}
        </AnalyticsPanel>
      </div>

      <AnalyticsYourCardsPanel summary={summary} />
    </section>
  );
}
