'use client';

import { useMemo, useState } from 'react';
import type { CardPriceSnapshot } from '@/hooks/use-card-prices';
import { getPriceSourceLabel, normalizePriceSource } from '@/lib/card-pricing';
import {
  buildCardHighlightCandidates,
  FINISH_LABELS,
  rankValuableCards,
  type CardHighlightFinishFilter,
  type HighlightCard,
} from '@/lib/card-highlights';
import { rankBreakoutCards } from '@/lib/breakout-cards';
import { getProxiedThumbnailUrl } from '@/lib/card-show-prep';
import { formatMomentumChange } from '@/lib/price-momentum';

interface CardHighlightsProps {
  name: string;
  cards: HighlightCard[];
  prices: Record<string, CardPriceSnapshot>;
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null;
  showValues?: boolean;
  isLoading?: boolean;
  onSelectCard?: (cardId: string) => void;
}

export function CardHighlights({
  name,
  cards,
  prices,
  formatPrice,
  showValues = false,
  isLoading = false,
  onSelectCard,
}: CardHighlightsProps) {
  const [finish, setFinish] = useState<CardHighlightFinishFilter>('all');
  const [mode, setMode] = useState<'value' | 'breakout'>(showValues ? 'value' : 'breakout');
  const candidates = useMemo(() => buildCardHighlightCandidates(cards, prices), [cards, prices]);
  const filtered = candidates.filter((entry) => finish === 'all' || entry.finish === finish);
  const breakout = rankBreakoutCards(
    filtered
      .filter((entry) => entry.finish === null || Number.isFinite(Date.parse(entry.price.updatedAt ?? '')))
      .map((entry) => ({ ...entry, card: entry })),
  );
  const values = rankValuableCards(candidates, finish);
  if (!showValues && rankBreakoutCards(candidates).length === 0) return null;
  const rows =
    mode === 'value'
      ? values.map((entry) => ({ entry, momentum: null }))
      : breakout.map(({ card: entry, momentum }) => ({ entry, momentum }));
  const maxValue = values[0]?.price.marketGbpAmount ?? 1;

  return (
    <section
      aria-label={`${name} ${mode === 'value' ? 'top value' : 'breakout'} cards`}
      className="mb-3 rounded-2xl border border-amber-400/35 bg-amber-500/[0.06] p-2.5"
    >
      {showValues ? (
        <div className="mb-2 flex gap-2">
          {(['value', 'breakout'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
              className={`min-h-9 rounded-full px-3 text-sm font-semibold ${mode === item ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}
            >
              {item === 'value' ? 'Top value' : 'Breakout'}
            </button>
          ))}
        </div>
      ) : (
        <h3 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">Breakout</h3>
      )}
      <p className="text-muted-foreground mb-2 text-xs">
        {mode === 'value'
          ? 'Up to 10 highest-value priced printings. A sorting guide, not a sale guarantee.'
          : 'Up to 10 printings with the strongest recent price momentum.'}
      </p>
      <div className="mb-2 flex flex-wrap gap-1" aria-label="Filter highlights by finish">
        {(['all', 'normal', 'holo', 'reverse_holo'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={finish === item}
            onClick={() => setFinish(item)}
            className={`min-h-9 rounded-full border px-2.5 text-xs ${finish === item ? 'border-amber-500/50 bg-amber-500/10' : 'border-border/50 text-muted-foreground'}`}
          >
            {item === 'all' ? 'All finishes' : FINISH_LABELS[item]}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p role="status" className="text-muted-foreground py-2 text-sm">
          {isLoading
            ? 'Loading prices…'
            : mode === 'value'
              ? 'No confidently priced printings with a verified finish in this selection.'
              : 'No qualifying recent price rises in this selection.'}
        </p>
      ) : null}
      <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ entry, momentum }, index) => {
          const { card, price } = entry;
          const edition =
            price.variantLabel && /edition|unlimited/i.test(price.variantLabel) ? ` · ${price.variantLabel}` : '';
          const finishLabel = entry.finish ? `${FINISH_LABELS[entry.finish]}${edition}` : 'Finish unverified';
          const image = getProxiedThumbnailUrl(card.image);
          const source = momentum ? normalizePriceSource(momentum.source) : price.source;
          const sourceDate =
            price.sourcePrices.find((evidence) => evidence.source === source)?.updatedAt ?? price.updatedAt;
          const change = momentum ? formatMomentumChange(momentum.change) : null;
          const content = (
            <>
              {image ? (
                <div className="bg-muted/50 h-14 w-10 shrink-0 overflow-hidden rounded-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" loading="lazy" className="h-full w-full object-contain" />
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {index + 1}. {card.name}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {card.numberLabel} · {card.setName}
                </p>
                <p className="text-muted-foreground text-[11px]">
                  {finishLabel}
                  {card.rarity ? ` · ${card.rarity}` : ''}
                </p>
                <p className="text-muted-foreground text-[10px]">
                  {source ? getPriceSourceLabel(source) : 'Source unverified'}
                  {sourceDate ? ` · ${sourceDate.slice(0, 10)}` : ''}
                </p>
                {!momentum ? (
                  <div className="mt-1 h-1 rounded-full bg-amber-500/10" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-amber-500/50"
                      style={{ width: `${((price.marketGbpAmount ?? 0) / maxValue) * 100}%` }}
                    />
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
                  {change ?? formatPrice({ ...price, gbpAmount: price.marketGbpAmount, fetchedAt: 0 }) ?? 'Unpriced'}
                </p>
                {momentum ? <p className="text-muted-foreground text-[10px]">vs {momentum.timeframe} avg</p> : null}
              </div>
            </>
          );
          return (
            <li key={entry.cardId} data-breakout-card-id={card.id}>
              {onSelectCard ? (
                <button
                  type="button"
                  onClick={() => onSelectCard(card.id)}
                  aria-label={`Breakout ${index + 1}: ${card.name} ${card.numberLabel} ${card.setName}, ${change} over ${momentum?.timeframe}, ${finishLabel}`}
                  className="border-border/50 bg-background/70 flex min-h-9 w-full min-w-0 items-center gap-2 rounded-xl border p-2 text-left hover:border-amber-400/60"
                >
                  {content}
                </button>
              ) : (
                <div className="border-border/50 bg-background/70 flex min-w-0 items-center gap-2 rounded-xl border p-2">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {showValues ? (
        <p className="text-muted-foreground mt-2 text-[10px]">
          Only available finish-specific evidence is ranked. Missing prices and ambiguous foil quotes are excluded.
        </p>
      ) : null}
    </section>
  );
}
