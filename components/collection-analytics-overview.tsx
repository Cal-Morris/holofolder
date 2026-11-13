'use client';

import Image from 'next/image';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Layers3 } from 'lucide-react';
import { buildAnalyticsBreakdown, type buildCollectionAnalytics, type AnalyticsCard } from '@/lib/collection-analytics';
import { toCardImageSrc } from '@/lib/card-image-url';

const moneyFormat = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const money = (amount: number) => moneyFormat.format(amount);
const tabs = ['Highest value', 'Unpriced', 'Wanted'] as const;

export function CollectionAnalyticsOverview({
  summary,
  isAllBinders,
  isLoadingPrices,
  onBrowsePokemon,
  onInspect,
  valuationActions,
}: {
  summary: ReturnType<typeof buildCollectionAnalytics>;
  isAllBinders: boolean;
  isLoadingPrices: boolean;
  onBrowsePokemon: (pokemon: { id: number; name: string }) => void;
  onInspect: (key: string) => void;
  valuationActions?: ReactNode;
}) {
  const cardsRef = useRef<HTMLElement>(null);
  const breakdown = useMemo(() => buildAnalyticsBreakdown(summary), [summary]);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Highest value');
  const [setName, setSetName] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showAllSets, setShowAllSets] = useState(false);
  const wanted = summary.cards.filter((card) => card.scope === 'wanted');
  const entries = setName
    ? summary.cards.filter(
        (card) => card.scope === 'owned' && (card.card.card_set?.trim() || 'Unknown set') === setName,
      )
    : tab === 'Highest value'
      ? breakdown.topCards
      : tab === 'Unpriced'
        ? breakdown.unpriced
        : wanted;
  const coverage = summary.assignedCards ? (summary.pricedCards / summary.assignedCards) * 100 : 0;
  const open = (card: AnalyticsCard) => onBrowsePokemon({ id: card.pokemonId, name: card.pokemonName });
  return (
    <>
      <section
        aria-label="Collection overview"
        aria-busy={isLoadingPrices}
        className="border-border/60 grid grid-cols-1 gap-6 border-b pb-6 sm:grid-cols-2 sm:gap-10"
      >
        <div>
          <h2 className="text-muted-foreground text-sm sm:text-sm">National Dex completion</h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0">
            <p className="text-3xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              {((summary.ownedSpecies / 1025) * 100).toFixed(1)}
              <span className="text-muted-foreground text-lg">%</span>
            </p>
            <p className="text-sm tabular-nums">{summary.ownedSpecies} / 1025</p>
          </div>
          <div
            role="progressbar"
            aria-label="National Dex completion"
            aria-valuenow={summary.ownedSpecies}
            aria-valuemin={0}
            aria-valuemax={1025}
            className="bg-muted mt-5 h-2 overflow-hidden rounded-full"
          >
            <div
              className="holo-progress bg-highlight h-full rounded-full"
              style={{ width: `${(summary.ownedSpecies / 1025) * 100}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            {1025 - summary.ownedSpecies} species to go{isAllBinders ? ' across your binders' : ' in this binder'}.
          </p>
        </div>
        <div className="order-first min-w-0">
          <h2 className="text-base font-medium">Binder value</h2>
          <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
            {summary.pricedCards ? money(summary.valueGbp) : isLoadingPrices ? 'Loading…' : 'Unknown'}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Market estimate · GBP{summary.pricedCards < summary.assignedCards ? ' · partial coverage' : ''}
          </p>
          {summary.oldestQuoteAt && (
            <p className="text-muted-foreground mt-1 text-sm">
              Oldest quote: {new Date(summary.oldestQuoteAt).toLocaleDateString('en-GB')}
              {summary.staleCards > 0 ? ` · ${summary.staleCards} quotes over 7 days old` : ''}.
            </p>
          )}
          <div className="mt-5 flex items-center gap-3">
            <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full" aria-hidden="true">
              <div className="bg-primary/60 h-full" style={{ width: `${coverage}%` }} />
            </div>
            <span className="text-muted-foreground text-sm tabular-nums">{Math.round(coverage)}% priced</span>
          </div>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            {summary.pricedCards} of {summary.assignedCards} owned cards priced.{' '}
            {summary.pricedCards - summary.estimatedFinishCards} exact finish
            {summary.estimatedFinishCards > 0 ? ` · ${summary.estimatedFinishCards} finish estimates` : ''}.
          </p>
          <button
            type="button"
            onClick={() => {
              setTab('Unpriced');
              setSetName(null);
              setShowAll(false);
              cardsRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
              cardsRef.current?.focus({ preventScroll: true });
            }}
            className="decoration-border mt-1 min-h-9 text-left text-sm underline underline-offset-4"
          >
            {breakdown.unpriced.length} unpriced, excluded from value
          </button>
          {breakdown.uncertainPrices > 0 && (
            <p className="text-muted-foreground text-sm">
              {breakdown.uncertainPrices} priced with low or unknown confidence.
            </p>
          )}
          {valuationActions}
        </div>
      </section>
      <div className="text-muted-foreground flex flex-wrap gap-x-8 gap-y-2 py-4 text-sm">
        <p>
          <strong className="text-foreground font-semibold tabular-nums">{summary.assignedCards}</strong> assigned{' '}
          {isAllBinders ? 'copies' : 'cards'}
        </p>
        <p>
          <strong className="text-foreground font-semibold tabular-nums">{summary.wantedCards}</strong> wanted printings
        </p>
        <p>
          <strong className="text-foreground font-semibold tabular-nums">{breakdown.sets.length}</strong> sets
          represented
        </p>
      </div>
      <div className="border-border/60 grid items-start gap-8 border-b py-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
        <section aria-label="Owned cards by set" className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Your collection by set</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Owned cards, not set completion. Select a set to explore.
          </p>
          {breakdown.sets.length ? (
            <ul className="mt-4 space-y-1">
              {(showAllSets ? breakdown.sets : breakdown.sets.slice(0, 6)).map((set) => (
                <li key={set.name}>
                  {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- named by the set name and count rendered inside it */}
                  <button
                    type="button"
                    aria-pressed={setName === set.name}
                    onClick={() => {
                      setSetName(set.name);
                      setShowAll(false);
                      cardsRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
                      cardsRef.current?.focus({ preventScroll: true });
                    }}
                    className="hover:bg-muted focus-visible:outline-ring w-full rounded-lg px-1 py-2.5 text-left focus-visible:outline-2"
                  >
                    <span className="flex justify-between gap-4 text-sm">
                      <span className="truncate font-medium">{set.name}</span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">{set.count}</span>
                    </span>
                    <span className="bg-muted mt-2 block h-1.5 overflow-hidden rounded-full">
                      <span
                        className="bg-primary/70 block h-full rounded-full"
                        style={{ width: `${(set.count / summary.assignedCards) * 100}%` }}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground py-6 text-sm">
              Assign a card to an owned Pokémon to see your sets here.
            </p>
          )}
          {breakdown.sets.length > 6 && (
            <button
              type="button"
              className="min-h-10 text-sm underline underline-offset-4"
              onClick={() => setShowAllSets(!showAllSets)}
            >
              {showAllSets ? 'Show fewer sets' : `View all ${breakdown.sets.length} sets`}
            </button>
          )}
        </section>
        <section ref={cardsRef} tabIndex={-1} aria-label="Explore collection cards" className="min-w-0 outline-none">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">{setName ?? 'Cards worth a closer look'}</h2>
            {setName && (
              <button
                type="button"
                className="min-h-9 shrink-0 text-sm underline underline-offset-4"
                onClick={() => setSetName(null)}
              >
                Clear set
              </button>
            )}
          </div>
          {!setName && (
            <div className="border-border/60 mt-3 flex gap-4 border-b" role="group" aria-label="Cards to explore">
              {tabs.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={tab === value}
                  onClick={() => {
                    setTab(value);
                    setShowAll(false);
                  }}
                  className={`min-h-10 border-b-2 text-sm ${tab === value ? 'border-foreground font-medium' : 'text-muted-foreground border-transparent'}`}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
          {entries.length ? (
            <ul className="divide-border/50 mt-2 divide-y">
              {(showAll ? entries : entries.slice(0, 5)).map((card) => (
                <li key={card.key} className="flex items-center gap-3 py-3">
                  <button
                    type="button"
                    onClick={() => open(card)}
                    className="focus-visible:outline-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2"
                    aria-label={`Browse ${card.card.card_name} cards`}
                  >
                    <span className="bg-muted flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded">
                      {toCardImageSrc(card.card.card_image) ? (
                        <Image
                          width={40}
                          height={56}
                          unoptimized
                          src={toCardImageSrc(card.card.card_image)!}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Layers3 className="text-muted-foreground h-5 w-5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{card.card.card_name}</span>
                      <span className="text-muted-foreground mt-1 block truncate text-sm">
                        {card.card.card_set ?? card.card.card_id}
                      </span>
                      <span className="text-muted-foreground block text-sm capitalize">
                        {(card.card.card_finish ?? 'normal').replaceAll('_', ' ')} · {card.card.card_language ?? 'en'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onInspect(card.key)}
                    aria-label={`Price details for ${card.card.card_name}`}
                    className="focus-visible:outline-ring flex min-h-11 shrink-0 items-center gap-1 rounded-lg text-right text-sm tabular-nums focus-visible:outline-2"
                  >
                    <span>
                      {card.amount !== null ? money(card.amount) : 'Unpriced'}
                      {card.estimatedFinish && (
                        <span className="text-muted-foreground block text-xs">Finish estimate</span>
                      )}
                    </span>
                    <ChevronRight className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground py-6 text-sm">
              {tab === 'Wanted'
                ? 'Save a printing to your want list to see it here.'
                : tab === 'Unpriced'
                  ? 'No assigned owned cards are missing a price.'
                  : 'No priced owned cards yet. Assign your printings to see their values here.'}
            </p>
          )}
          {entries.length > 5 && (
            <button
              type="button"
              className="min-h-10 text-sm underline underline-offset-4"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show fewer cards' : `View all ${entries.length} cards`}
            </button>
          )}
        </section>
      </div>
      <p className="text-muted-foreground py-3 text-sm leading-relaxed">
        Values use available market prices converted to GBP where needed, not sale proceeds. Finish estimates use a
        generic card price when the finish is unverified. Quotes over 30 days old are excluded.{' '}
        {isAllBinders && 'Owned copies count separately; species and wanted printings count once.'}
      </p>
    </>
  );
}
