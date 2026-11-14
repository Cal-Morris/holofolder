// Public Pokémon pages (/app/pokemon and /app/pokemon/<dex>-<name>): pure helpers, no data access.
import { formatPokemonDisplayName, getPokemonById, POKEMON_CATALOG, type PokemonEntry } from '@/lib/pokemon-catalog';
import { GENERATIONS } from '@/lib/pokemon-generations';
import { groupSetsBySeries } from '@/lib/set-browse';
import { setSlug, type PublicSetSummary } from '@/lib/set-pages';

export interface PublicPokemon {
  id: number;
  name: string;
  slug: string;
}

/** 197 + "umbreon" → "197-umbreon"; Nidoran♀ → "29-nidoran-f", Mr. Mime → "122-mr-mime". */
export function pokemonSlug(entry: PokemonEntry) {
  const name = formatPokemonDisplayName(entry.name).replace(/♀/g, ' f').replace(/♂/g, ' m');
  return `${entry.id}-${setSlug(name)}`;
}

const toPublicPokemon = (entry: PokemonEntry): PublicPokemon => ({
  id: entry.id,
  name: formatPokemonDisplayName(entry.name),
  slug: pokemonSlug(entry),
});

export function findPokemonById(id: number): PublicPokemon | undefined {
  const entry = getPokemonById(id);
  return entry && toPublicPokemon(entry);
}

/** The species whose page slug is exactly `slug`; "197" or "197-espeon" find nothing, so each page has one URL. */
export function findPokemonBySlug(slug: string): PublicPokemon | undefined {
  const id = /^(\d{1,4})-/.exec(slug)?.[1];
  const pokemon = id ? findPokemonById(Number(id)) : undefined;
  return pokemon?.slug === slug ? pokemon : undefined;
}

/** Every National Dex species, by generation. */
export function pokemonByGeneration() {
  // GENERATIONS[0] is "All Generations"; the catalogue is in dex order from #1.
  return GENERATIONS.slice(1).map((gen) => ({
    name: gen.name,
    region: gen.region,
    pokemon: POKEMON_CATALOG.slice(gen.start - 1, gen.end).map(toPublicPokemon),
  }));
}

/**
 * Cards grouped by series (era) and then set, newest set first, the same order as the set index. Cards keep their
 * incoming order inside a set; cards whose set isn't in `sets` are left out.
 */
export function groupCardsBySet<C extends { setId: string }>(cards: readonly C[], sets: readonly PublicSetSummary[]) {
  const bySet = new Map<string, C[]>();
  for (const card of cards) bySet.set(card.setId, [...(bySet.get(card.setId) ?? []), card]);
  return groupSetsBySeries(sets.filter((set) => bySet.has(set.id))).map((group) => ({
    series: group.series,
    sets: group.sets.map((set) => ({ set, cards: bySet.get(set.id)! })),
  }));
}
