'use client';

import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { CollectedPokemon } from '@/lib/domain/cards';
import {
  POKEMON_CATALOG,
  formatPokemonDisplayName,
  getOfficialArtworkUrl,
  getPokemonSummary,
  type PokemonSummary,
  formatDexNumber,
} from '@/lib/pokemon-catalog';
import { useVirtualRows } from '@/hooks/use-virtual-rows';

interface PokemonBrowseViewProps {
  collectionByPokemonId: Map<number, CollectedPokemon>;
  /** "Owned in <binder>" for Pokémon another binder holds (two or more binders only). */
  ownedElsewhere?: (pokemonId: number) => string | null;
  onBrowsePokemon: (pokemon: PokemonSummary) => void;
}

type SpeciesFilter = 'all' | 'owned' | 'missing' | 'wanted';

export default function PokemonBrowseView({
  collectionByPokemonId,
  ownedElsewhere,
  onBrowsePokemon,
}: PokemonBrowseViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SpeciesFilter>('all');
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const entries = useMemo(
    () =>
      POKEMON_CATALOG.map((pokemon) => {
        const item = collectionByPokemonId.get(pokemon.id);
        return {
          pokemon,
          owned: Boolean(item && item.status !== 'wishlisted'),
          wanted: Boolean(item?.status === 'wishlisted' || item?.wanted_cards.length),
        };
      }),
    [collectionByPokemonId],
  );
  const counts = {
    all: entries.length,
    owned: entries.filter((entry) => entry.owned).length,
    missing: entries.filter((entry) => !entry.owned).length,
    wanted: entries.filter((entry) => entry.wanted && !entry.owned).length,
  };
  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (
          (filter === 'owned' && !entry.owned) ||
          (filter === 'missing' && entry.owned) ||
          (filter === 'wanted' && (!entry.wanted || entry.owned))
        )
          return false;
        const needle = query.trim().toLowerCase();
        return (
          !needle ||
          entry.pokemon.name.includes(needle) ||
          formatPokemonDisplayName(entry.pokemon.name).toLowerCase().includes(needle) ||
          String(entry.pokemon.id) === needle.replace(/^#?0*/, '')
        );
      }),
    [entries, filter, query],
  );
  const keys = useMemo(() => visible.map((entry) => entry.pokemon.id), [visible]);
  const { range, attachScroller, onScroll, measureRow } = useVirtualRows({ keys, gap: 6, estimatedRowHeight: 84 });

  return (
    <section className="border-border/60 bg-card/88 dark:bg-card/70 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.6rem] border">
      <div className="border-border/45 shrink-0 space-y-3 border-b p-4">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.18em] uppercase">Pokémon browse</p>
          <h2 className="text-lg font-semibold">Explore every Pokémon</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Species in your binder. Open a Pokémon to browse its mirrored printings.
          </p>
        </div>
        <label className="border-border/55 bg-background/45 flex items-center gap-2 rounded-2xl border px-3">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <span className="sr-only">Search Pokémon by name or dex number</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              scrollerRef.current?.scrollTo(0, 0);
              setQuery(event.target.value);
            }}
            placeholder="Name or dex number"
            className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none md:text-sm"
          />
        </label>
        <div role="group" aria-label="Filter Pokémon species" className="flex flex-wrap gap-1.5">
          {(['all', 'owned', 'missing', 'wanted'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => {
                scrollerRef.current?.scrollTo(0, 0);
                setFilter(option);
              }}
              className={`min-h-9 rounded-full border px-3 text-xs font-semibold capitalize ${filter === option ? 'border-primary/45 bg-primary text-primary-foreground' : 'border-border/55 bg-background/45'}`}
            >
              {option} <span className="tabular-nums opacity-75">{counts[option]}</span>
            </button>
          ))}
        </div>
      </div>
      <div
        data-testid="view-scroller"
        ref={(node) => {
          scrollerRef.current = node;
          return attachScroller(node);
        }}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {visible.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No Pokémon match this search.</p>
        ) : (
          <ul
            aria-label="Pokémon catalogue"
            className="relative"
            style={{ height: range.totalHeight, paddingTop: range.offsetTop }}
          >
            {visible.slice(range.start, range.end).map(({ pokemon, owned, wanted }) => (
              <li key={pokemon.id} ref={measureRow} data-virtual-key={pokemon.id} className="mb-1.5 min-w-0">
                {/* The whole row opens the species' cards; "Cards" is only the visual cue. */}
                <button
                  type="button"
                  onClick={() => {
                    const summary = getPokemonSummary(pokemon.id);
                    if (summary) onBrowsePokemon(summary);
                  }}
                  aria-label={`Browse ${formatPokemonDisplayName(pokemon.name)} cards`}
                  aria-describedby={`pokemon-browse-${pokemon.id}`}
                  className="border-border/40 bg-background/35 hover:bg-background/70 flex w-full min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.98]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getOfficialArtworkUrl(pokemon.id)}
                    alt=""
                    loading="lazy"
                    className="h-12 w-12 shrink-0 object-contain"
                  />
                  <span id={`pokemon-browse-${pokemon.id}`} className="min-w-0 flex-1">
                    <span className="text-muted-foreground block text-[11px] tabular-nums">
                      {formatDexNumber(pokemon.id)}
                    </span>
                    <span className="block truncate text-sm font-semibold">
                      {formatPokemonDisplayName(pokemon.name)}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {owned ? 'Owned species' : 'Missing species'}
                      {wanted ? ' · Wanted printing' : ''}
                    </span>
                    {ownedElsewhere?.(pokemon.id) ? (
                      <span className="text-primary block truncate text-xs font-medium" data-testid="owned-elsewhere">
                        {ownedElsewhere(pokemon.id)}
                      </span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    className="border-border/55 flex min-h-9 shrink-0 items-center rounded-full border px-3 text-xs font-semibold"
                  >
                    Cards
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
