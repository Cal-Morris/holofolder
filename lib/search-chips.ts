/**
 * The Search sheet's category chips: a Pokémon, set or illustrator hit that narrows the card results. Tapping one
 * replaces the query with what finds that category best (the Pokémon's name, the set's id, the illustrator's full
 * name) and keeps only the cards that belong to it. Pure, so the sheet and unit tests agree.
 */
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import { formatPokemonDisplayName } from '@/lib/pokemon-catalog';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';

export type SearchChip =
  | { kind: 'pokemon'; id: number; name: string }
  | { kind: 'set'; set: TCGSetSummary }
  | { kind: 'illustrator'; name: string; cardCount: number };

export function searchChipKey(chip: SearchChip) {
  return chip.kind === 'pokemon'
    ? `pokemon:${chip.id}`
    : chip.kind === 'set'
      ? `set:${chip.set.id}`
      : `illustrator:${chip.name}`;
}

/** The query a chip reruns the search with: a set id finds exactly that set's cards, a full name exactly that artist's. */
export function searchChipQuery(chip: SearchChip) {
  return chip.kind === 'pokemon' ? formatPokemonDisplayName(chip.name) : chip.kind === 'set' ? chip.set.id : chip.name;
}

export function matchesSearchChip(card: SearchCardResult, chip: SearchChip) {
  if (chip.kind === 'pokemon') return card.dexIds.includes(chip.id);
  if (chip.kind === 'set') return card.set.id === chip.set.id;
  return card.illustrator?.trim() === chip.name;
}
