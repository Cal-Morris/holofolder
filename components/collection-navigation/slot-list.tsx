'use client';

import type { BinderDisplaySlot } from '@/lib/binder-display-model';
import { Check, Heart, Minus, X } from 'lucide-react';
import { formatDexNumber, formatPokemonDisplayName } from '@/lib/pokemon-catalog';
import { OrderedSlot } from '@/components/binder/ordered-slot';

// Wording, colours and icons match the legacy Pokémon list (components/dex-list-view.tsx): Owned, Wanted, Missing.
const PILL = {
  owned: ['Owned', 'border-emerald-400/35 bg-emerald-400/12 text-emerald-600 dark:text-emerald-300', Check],
  wanted: ['Wanted', 'border-amber-400/35 bg-amber-400/12 text-amber-600 dark:text-amber-300', Heart],
  missing: ['Missing', 'border-border/60 bg-muted/35 text-muted-foreground', X],
  spacer: ['Empty slot', 'border-border/60 bg-muted/35 text-muted-foreground', Minus],
} as const;

function slotState(slot: BinderDisplaySlot) {
  return slot.item ? PILL.owned : slot.target ? (slot.wantedCards.length ? PILL.wanted : PILL.missing) : PILL.spacer;
}

/** Uses the same slot/copy identities and detail action as the real BinderApp grid. */
export default function CollectionSlotList({
  slots,
  search,
  onSearch,
  onSelect,
  highlight,
}: {
  slots: readonly BinderDisplaySlot[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  highlight?: string;
}) {
  const query = search.trim().toLocaleLowerCase();
  const shown = slots.filter(
    (s) => !query || [s.card?.name, s.pokemon?.name, s.id].some((text) => text?.toLocaleLowerCase().includes(query)),
  );
  return (
    <section
      id="collection-browser-scroll"
      aria-label="Collection slots"
      className="min-h-0 flex-1 overflow-y-auto p-3 pb-[var(--dock-clearance)] sm:p-4"
    >
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <label className="block w-full max-w-md text-sm">
            Filter collection
            <input
              type="search"
              aria-label="Filter collection"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className="mt-1 min-h-10 w-full rounded-lg border px-3 text-base md:text-sm"
            />
          </label>
          <p className="text-muted-foreground text-xs font-medium">{shown.length} slots</p>
        </div>
        {/* Fixed row height keeps content-visibility skipping honest, so scroll position and the scrollbar stay stable. */}
        <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((slot) => {
            const [label, tone, Icon] = slotState(slot);
            const name =
              slot.card?.name ??
              (slot.pokemon
                ? formatPokemonDisplayName(slot.pokemon.name)
                : slot.target?.kind === 'pokemon'
                  ? `Pokémon ${slot.target.pokemonId}`
                  : 'Free slot');
            const detail = [
              slot.pokemon
                ? formatDexNumber(slot.pokemon.id)
                : slot.target?.kind === 'pokemon'
                  ? formatDexNumber(slot.target.pokemonId)
                  : null,
              slot.card?.set?.name,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={slot.id}
                onClick={(e) => {
                  if (!(e.target as Element).closest('button')) onSelect(slot.id);
                }}
                className="border-border/45 bg-background/35 hover:border-border/60 hover:bg-background/70 dark:bg-background/22 grid h-[4.5rem] min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border p-2.5 transition-colors [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]"
              >
                <div className="h-14 w-10 shrink-0">
                  <OrderedSlot
                    slot={slot}
                    selected={slot.id === highlight}
                    onSelect={onSelect}
                    imageSizes="40px"
                    glareStyle={{}}
                    glare={false}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" title={name}>
                        {name}
                      </p>
                      {detail && <p className="text-muted-foreground truncate text-[11px]">{detail}</p>}
                    </div>
                    <span className="flex shrink-0 items-center gap-1">
                      {slot.item && slot.wantedCards.length > 0 && (
                        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                          {slot.wantedCards.length} want
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${tone}`}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                      </span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {!shown.length && <p className="text-muted-foreground text-sm">No matching slots.</p>}
      </div>
    </section>
  );
}
