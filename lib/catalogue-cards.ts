// Public catalogue card grids (set, Pokémon, illustrator and search pages): pure filtering, no data access.
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import { formatCardNumber } from '@/lib/set-pages';

/** One card as the public pages hand it to the grid: display-ready strings, no prices or collection state. */
export interface CatalogueCard {
  id: string;
  name: string;
  /** As printed: "12/131", "SWSH050". */
  number: string;
  setName: string;
  /** The public set page, by slug or set id (an id redirects to the slug). Empty when the set has no public page. */
  setSlug: string;
  series?: string;
  releaseDate?: string;
  rarity?: string;
  illustrator?: string;
  image?: string;
  /** The species page, for a card of exactly one Pokémon. */
  pokemon?: { slug: string; name: string };
}

/** The card's public page (app-relative), for cards in a set with a public page; undefined for the rest. */
export const publicCardPath = (card: Pick<CatalogueCard, 'id' | 'setSlug'>) =>
  card.setSlug ? `/cards/${encodeURIComponent(card.id)}` : undefined;

/** A printed rarity, or undefined for none: the catalogue stores "None" for cards without one. */
export const knownRarity = (rarity: string | undefined) => (rarity && rarity !== 'None' ? rarity : undefined);

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

/**
 * A card from a catalogue API (similar cards, search) as a grid card. English cards link to their set by id, which
 * redirects to the set's page; other languages' sets have no public page, so they get no set link.
 */
export function catalogueCardFromSearch(card: SearchCardResult): CatalogueCard {
  const english = !card.language || card.language === 'en';
  return {
    id: card.id,
    name: card.name,
    number: formatCardNumber(card.localId, card.set.officialCardCount),
    setName: card.set.name,
    setSlug: english ? card.set.id : '',
    ...(card.set.releaseDate ? { releaseDate: card.set.releaseDate } : {}),
    ...(knownRarity(card.rarity) ? { rarity: card.rarity } : {}),
    ...(card.illustrator ? { illustrator: card.illustrator } : {}),
    ...(card.image ? { image: card.image } : {}),
  };
}

/**
 * A printed card number in a search: "161/131" or "Flabébé 161/131" → { number: '161', total: 131, text: 'Flabébé' }.
 * Anything without a number/total is null.
 */
export function parseCardNumberQuery(query: string) {
  const match = /(?:^|\s)#?(\d{1,4})\s*\/\s*(\d{1,4})(?=\s|$)/.exec(query);
  if (!match) return null;
  const text = `${query.slice(0, match.index)} ${query.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ');
  return { number: String(Number(match[1])), total: Number(match[2]), text: text.trim() };
}

/** "6" → ["6", "06", "006"]: sets store numbers unpadded or padded to two or three digits. */
export const paddedCardNumbers = (number: string) => [
  ...new Set([number, number.padStart(2, '0'), number.padStart(3, '0')]),
];
