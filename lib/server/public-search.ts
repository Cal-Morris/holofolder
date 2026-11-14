import { getCardsByIds, searchCardCatalog } from '@/lib/catalog-queries';
import { matchesWords, paddedCardNumbers, parseCardNumberQuery, type CatalogueCard } from '@/lib/catalogue-cards';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import { toPublicCatalogueCard } from '@/lib/server/public-catalogue-card';
import { getPublicSets } from '@/lib/server/public-sets';

/** The most cards one search page shows; the rest are counted so the page can ask for a narrower search. */
export const PUBLIC_SEARCH_LIMIT = 200;
const QUERY_MAX_LENGTH = 80;

export const cleanSearchQuery = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX_LENGTH) : '';

/**
 * The public card search: the app's catalogue search (name, set, number, illustrator, nicknames), plus a printed
 * number with its set total ("161/131", "flabebe 161/131"), which the catalogue search doesn't read. Kept to sets with
 * a public page, so it lists the cards those pages list. Each query is cached by the catalogue queries it makes.
 */
export async function searchPublicCards(query: string): Promise<{
  cards: CatalogueCard[];
  total: number;
  correction: string | null;
}> {
  if (query.length < 2) return { cards: [], total: 0, correction: null };
  const sets = await getPublicSets();
  const setsById = new Map(sets.map((set) => [set.id, set]));
  const printed = parseCardNumberQuery(query);
  let found: SearchCardResult[];
  let correction: string | null = null;
  if (printed) {
    const ids = sets.flatMap((set) =>
      set.officialCardCount === printed.total
        ? paddedCardNumbers(printed.number).map((number) => `${set.id}-${number}`)
        : [],
    );
    found = (await getCardsByIds(ids, 'en')).filter((card) => matchesWords(card.name, printed.text));
  } else {
    ({ cards: found, correction } = await searchCardCatalog(query, 'en', 1000, true));
  }
  const cards = found.filter((card) => setsById.has(card.set.id));
  return {
    cards: cards
      .slice(0, PUBLIC_SEARCH_LIMIT)
      .map((card) => toPublicCatalogueCard({ ...card, number: card.localId }, setsById.get(card.set.id)!)),
    total: cards.length,
    correction,
  };
}
