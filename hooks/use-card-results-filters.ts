'use client';

import { useMemo, useState } from 'react';
import { getActiveFilterChips, getPokemonFilterOptions, type CardPickerFilterKey } from '@/lib/card-picker-filters';
import { cardResultFilterOptions, filterCardResults, type CardResultFilters } from '@/lib/card-results';
import { sortCardPickerCards, type CardPickerSort } from '@/lib/card-selector-sort';
import { formatPokemonDisplayName, getPokemonById } from '@/lib/pokemon-catalog';

interface ResultCard {
  localId: string;
  set: { id: string; name: string; releaseDate?: string };
  rarity?: string;
  illustrator?: string;
  dexIds?: readonly number[];
}

const pokemonName = (id: number) => {
  const pokemon = getPokemonById(id);
  return pokemon ? formatPokemonDisplayName(pokemon.name) : undefined;
};

/**
 * Sort and filters (Pokémon, set, rarity, artist) for a card results grid, as the card picker offers them. A filter
 * the cards no longer offer (after a new search) is ignored rather than leaving nothing.
 */
export function useCardResultsFilters<TCard extends ResultCard>(
  cards: readonly TCard[],
  amountOf: (card: TCard) => number | null,
  likelyRank?: (card: TCard) => number,
) {
  const [sort, setSort] = useState<CardPickerSort>('default');
  const [chosen, setChosen] = useState<CardResultFilters>({});
  const options = useMemo(
    () => ({
      ...cardResultFilterOptions(cards),
      pokemon: getPokemonFilterOptions(
        cards.map((card) => ({ dexIds: card.dexIds ?? [] })),
        pokemonName,
      ),
    }),
    [cards],
  );
  const filters = useMemo<CardResultFilters>(
    () => ({
      set: options.sets.some((set) => set.id === chosen.set) ? chosen.set : undefined,
      rarity: chosen.rarity && options.rarities.includes(chosen.rarity) ? chosen.rarity : undefined,
      illustrator:
        chosen.illustrator && options.illustrators.includes(chosen.illustrator) ? chosen.illustrator : undefined,
      pokemon: options.pokemon.some((option) => option.id === chosen.pokemon) ? chosen.pokemon : undefined,
    }),
    [chosen, options],
  );
  const visible = useMemo(
    () => sortCardPickerCards(filterCardResults(cards, filters), sort, amountOf, likelyRank),
    [amountOf, cards, filters, likelyRank, sort],
  );
  const chips = useMemo(
    () =>
      getActiveFilterChips(
        { filters, language: 'en', defaultLanguage: 'en', variant: 'any', sort },
        (id) => options.sets.find((set) => set.id === id)?.name,
        pokemonName,
      ),
    [filters, options.sets, sort],
  );
  return {
    visible,
    sort,
    setSort,
    filters,
    options,
    chips,
    setFilter: (next: CardResultFilters) => setChosen((current) => ({ ...current, ...next })),
    clear: (key: CardPickerFilterKey) =>
      key === 'sort' ? setSort('default') : setChosen((current) => ({ ...current, [key]: undefined })),
    reset: () => {
      setSort('default');
      setChosen({});
    },
  };
}
