// Public catalogue card grids (set, Pokémon, illustrator and search pages): pure filtering, no data access.

/** One card as the public pages hand it to the grid: display-ready strings, no prices or collection state. */
export interface CatalogueCard {
  id: string;
  name: string;
  /** As printed: "12/131", "SWSH050". */
  number: string;
  setName: string;
  setSlug: string;
  series?: string;
  releaseDate?: string;
  rarity?: string;
  illustrator?: string;
  image?: string;
  /** The species page, for a card of exactly one Pokémon. */
  pokemon?: { slug: string; name: string };
}

export const CATALOGUE_FACETS = ['rarity', 'illustrator', 'series', 'setName'] as const;
export type CatalogueFacet = (typeof CATALOGUE_FACETS)[number];

export const CATALOGUE_SORTS = ['default', 'reverse', 'name'] as const;
export type CatalogueSort = (typeof CATALOGUE_SORTS)[number];

export interface CatalogueFilter {
  text?: string;
  facets?: Partial<Record<CatalogueFacet, string>>;
  sort?: CatalogueSort;
}

/** Lower case, accents and punctuation folded ("Flabébé 161/131" → "flabebe 161 131"). */
export const foldText = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Every word of `query` starts a word of `text`, ignoring case and accents ("umbr" and "197" find "197 Umbreon"). */
export function matchesWords(text: string, query: string) {
  const haystack = ` ${foldText(text)} `;
  return foldText(query)
    .split(' ')
    .filter(Boolean)
    .every((word) => haystack.includes(` ${word}`));
}

/**
 * A facet's values with their card counts. Series and sets keep the cards' order (newest first on the pages that
 * mix sets); rarities and illustrators are alphabetical.
 */
export function facetOptions(cards: readonly CatalogueCard[], facet: CatalogueFacet) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const value = card[facet];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const options = [...counts].map(([value, count]) => ({ value, count }));
  return facet === 'series' || facet === 'setName'
    ? options
    : options.toSorted((a, b) => a.value.localeCompare(b.value, 'en'));
}

/**
 * The cards matching every chosen facet and every word of `text` (name, number, set or illustrator), in the page's
 * order (`default`), reversed, or by name. "161" finds "161/131".
 */
export function filterCatalogueCards(
  cards: readonly CatalogueCard[],
  { text = '', facets = {}, sort }: CatalogueFilter,
) {
  const chosen = Object.entries(facets).filter(([, value]) => value) as [CatalogueFacet, string][];
  const matches = cards.filter((card) => {
    if (chosen.some(([facet, value]) => card[facet] !== value)) return false;
    return matchesWords([card.name, card.number, card.setName, card.illustrator ?? ''].join(' '), text);
  });
  if (sort === 'reverse') return matches.toReversed();
  if (sort === 'name') return matches.toSorted((a, b) => a.name.localeCompare(b.name, 'en'));
  return matches;
}
