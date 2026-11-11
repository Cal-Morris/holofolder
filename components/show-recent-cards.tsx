'use client';

import type { QuickCardCheckOptions } from '@/components/quick-mode';
import { cardThumb } from '@/components/show-hunt';
import { formatCardFinishLabel } from '@/lib/card-labels';
import type { CardFinish } from '@/lib/domain/cards';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import { recentToSearchCard, type RecentCard } from '@/lib/recent-cards';
import { CARD_STANDING_BADGES, getCardStanding } from '@/lib/show-hunt';

export default function ShowRecentCards({
  cards,
  shared = false,
  getCardState,
  onPickCard,
  onClear,
}: {
  cards: RecentCard[];
  shared?: boolean;
  getCardState: QuickCardCheckOptions['getCardState'];
  onPickCard: (card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish | null) => void;
  onClear: () => void;
}) {
  if (!cards.length) return null;
  return (
    <section
      aria-label="Recently viewed cards"
      className="holo-panel border-border/60 mb-3 min-w-0 rounded-3xl border p-3"
    >
      <div className="flex items-center justify-between gap-2 pt-1">
        <h3 className="text-muted-foreground text-xs font-semibold">Recently viewed</h3>
        <button
          type="button"
          onClick={onClear}
          aria-label={shared ? 'Clear recently viewed cards for this binder' : 'Clear recently viewed cards'}
          className="text-muted-foreground min-h-9 rounded-full px-3 text-xs font-semibold"
        >
          {shared ? 'Clear for everyone' : 'Clear'}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cards.slice(0, 10).map((recent) => {
          const card = recentToSearchCard(recent);
          const pokemon = { id: recent.dexId, name: recent.pokemonName };
          const standing = getCardStanding(getCardState(card, pokemon));
          const badge = CARD_STANDING_BADGES[standing];
          const thumb = cardThumb(recent.image);
          const finish = recent.finish ? formatCardFinishLabel(recent.finish) : null;
          return (
            <button
              key={recent.id}
              type="button"
              onClick={() => onPickCard(card, pokemon, recent.finish)}
              aria-label={`${recent.name}, ${recent.setName} ${recent.number}${finish ? `, ${finish}` : ''}, ${badge.label}`}
              data-standing={standing}
              className="holo-tile border-border/60 bg-card active:bg-muted flex w-40 shrink-0 items-center gap-2 rounded-xl border p-2 text-left"
            >
              <span className="trading-card bg-muted/50 relative w-10 shrink-0 overflow-hidden">
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element -- same-origin cached card thumbnail
                  <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{recent.name}</span>
                <span className="text-muted-foreground block truncate text-[10px]">
                  {recent.setName} · {recent.number}
                </span>
                {finish && <span className="text-muted-foreground block truncate text-[10px]">{finish}</span>}
                <span
                  className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.toneClass}`}
                >
                  {badge.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
