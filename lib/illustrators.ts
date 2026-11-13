/**
 * Pure helpers for browsing cards by illustrator: the directory search (fuzzy, typo tolerant) and the
 * read-only illustrator view (owned/wanted marks, sort and filter). Shared by the API, the UI and unit tests.
 */
import { catalogCardIds } from '@/lib/card-catalog';
import { compareBrowseCards, formatCardNumber, getCardVariantLabels, type BrowseCard } from '@/lib/pokemon-card-browse';

export interface IllustratorSummary {
  name: string;
  cardCount: number;
}

/** A card in the illustrator view. `dexIds` is empty for Trainer and Energy cards. */
export interface IllustratorCard extends BrowseCard {
  dexIds: number[];
  illustrator?: string;
}

export interface IllustratorCardsResponse {
  illustrator: string;
  cards: IllustratorCard[];
}

export const ILLUSTRATOR_NAME_MAX_LENGTH = 120;

/** Trim, collapse whitespace and cap the length of an illustrator name from user input or a URL. */
export function cleanIllustratorName(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, ILLUSTRATOR_NAME_MAX_LENGTH);
}

/** Lower case, accents removed, punctuation as spaces ("Ryō-ta  Saitō" → "ryo ta saito"). */
export function normalizeIllustratorText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, ' ')
    .trim();
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping early above `max`. */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, rows[i - 2][j - 2] + 1);
      rows[i][j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length][b.length];
}

function allowedTypos(token: string) {
  return token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
}

/** How well one query token matches one name token: 3 exact, 2 prefix, 1 typo-tolerant, 0 none. */
function tokenScore(queryToken: string, nameToken: string) {
  if (nameToken === queryToken) return 3;
  if (nameToken.startsWith(queryToken)) return 2;
  const typos = allowedTypos(queryToken);
  if (typos === 0) return 0;
  // Compare against the same-length prefix too, so "mitsuhro" still finds "mitsuhiro".
  const candidates = [nameToken, nameToken.slice(0, queryToken.length)];
  return candidates.some((candidate) => editDistance(queryToken, candidate, typos) <= typos) ? 1 : 0;
}

/**
 * Score an illustrator name against a search (0 = no match, higher is better). Handles partial names
 * ("arita"), any word order ("arita mitsuhiro"), missing spaces ("5ban"), accents and small typos.
 */
export function scoreIllustratorMatch(name: string, query: string) {
  const normalizedName = normalizeIllustratorText(name);
  const normalizedQuery = normalizeIllustratorText(query);
  if (!normalizedName || !normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return 100;
  if (normalizedName.startsWith(normalizedQuery)) return 90;

  const compactName = normalizedName.replace(/ /g, '');
  const compactQuery = normalizedQuery.replace(/ /g, '');
  const nameTokens = normalizedName.split(' ');
  const queryTokens = normalizedQuery.split(' ');

  if (compactQuery.length >= 3 && compactName.includes(compactQuery)) {
    return nameTokens.some((token) => token.startsWith(queryTokens[0])) ? 80 : 70;
  }

  let total = 0;
  for (const queryToken of queryTokens) {
    const best = Math.max(...nameTokens.map((nameToken) => tokenScore(queryToken, nameToken)));
    if (best === 0) return 0;
    total += best;
  }
  // 30..60 for token matches, below any substring match.
  return 30 + Math.round((total / (queryTokens.length * 3)) * 30);
}

/** Best illustrator matches first; ties go to the artist with more cards, then alphabetical. */
export function searchIllustrators(
  directory: readonly IllustratorSummary[],
  query: string,
  limit = 6,
): IllustratorSummary[] {
  if (normalizeIllustratorText(query).length < 2) return [];
  return directory
    .map((entry) => ({ entry, score: scoreIllustratorMatch(entry.name, query) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) => b.score - a.score || b.entry.cardCount - a.entry.cardCount || a.entry.name.localeCompare(b.entry.name),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/** Merge raw (name, count) rows into a directory: names cleaned, duplicates summed, most cards first. */
export function buildIllustratorDirectory(rows: Iterable<{ name: unknown; count?: unknown }>): IllustratorSummary[] {
  const byName = new Map<string, IllustratorSummary>();
  for (const row of rows) {
    const name = cleanIllustratorName(row.name);
    if (!name) continue;
    const count =
      typeof row.count === 'number' && Number.isFinite(row.count) && row.count > 0 ? Math.floor(row.count) : 1;
    const existing = byName.get(name);
    byName.set(name, { name, cardCount: (existing?.cardCount ?? 0) + count });
  }
  return Array.from(byName.values()).sort((a, b) => b.cardCount - a.cardCount || a.name.localeCompare(b.name));
}

export function isIllustratorDirectory(value: unknown): value is IllustratorSummary[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Boolean(entry) &&
        typeof (entry as IllustratorSummary).name === 'string' &&
        typeof (entry as IllustratorSummary).cardCount === 'number',
    )
  );
}

export function isIllustratorCardsResponse(value: unknown): value is IllustratorCardsResponse {
  const payload = value as Partial<IllustratorCardsResponse> | null;
  return Boolean(payload) && typeof payload!.illustrator === 'string' && Array.isArray(payload!.cards);
}

// ---------------------------------------------------------------------------------------------------------
// Illustrator view

export type IllustratorCardFilter = 'all' | 'owned' | 'wanted' | 'missing';
export type IllustratorCardSort = 'newest' | 'oldest' | 'set' | 'name' | 'price-desc' | 'price-asc';

export const ILLUSTRATOR_CARD_FILTERS: Array<{ id: IllustratorCardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'wanted', label: 'Wanted' },
  { id: 'missing', label: 'Missing' },
];

export const ILLUSTRATOR_CARD_SORTS: Array<{ id: IllustratorCardSort; label: string }> = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'set', label: 'Set name' },
  { id: 'name', label: 'Card name' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'price-asc', label: 'Price: low to high' },
];

/** A card's headline price (GBP, region-weighted) or null when it has none. */
export type CardPriceOf = (card: BrowseCard) => number | null | undefined;

function usablePrice(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export interface IllustratorCollectionItem {
  card_id?: string | null;
  status?: string | null;
  wanted_cards?: Array<{ card_id: string }> | null;
}

export interface IllustratorCardEntry {
  card: IllustratorCard;
  owned: boolean;
  wanted: boolean;
  numberLabel: string;
  variantLabels: string[];
}

function compareByNumber(a: BrowseCard, b: BrowseCard) {
  return a.localId.localeCompare(b.localId, undefined, { numeric: true });
}

/** Cards with no price always sort last, in either direction; ties fall back to newest first. */
export function compareIllustratorCards(sort: IllustratorCardSort, priceOf?: CardPriceOf) {
  return (a: BrowseCard, b: BrowseCard) => {
    if (sort === 'price-desc' || sort === 'price-asc') {
      const aPrice = usablePrice(priceOf?.(a));
      const bPrice = usablePrice(priceOf?.(b));
      if (aPrice !== bPrice) {
        if (aPrice == null) return 1;
        if (bPrice == null) return -1;
        return sort === 'price-desc' ? bPrice - aPrice : aPrice - bPrice;
      }
      return compareBrowseCards(a, b);
    }
    if (sort === 'newest') return compareBrowseCards(a, b);
    if (sort === 'oldest') {
      const aDate = a.set.releaseDate ?? '';
      const bDate = b.set.releaseDate ?? '';
      if (aDate !== bDate) {
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate.localeCompare(bDate);
      }
      return a.set.id.localeCompare(b.set.id) || compareByNumber(a, b);
    }
    if (sort === 'set') return a.set.name.localeCompare(b.set.name) || compareByNumber(a, b);
    return a.name.localeCompare(b.name) || compareBrowseCards(a, b);
  };
}

/**
 * Mark each card owned/wanted from the whole collection (one row per Pokémon, so a card can be owned in
 * one slot and wanted in another), then filter and sort for the view.
 */
export function buildIllustratorEntries(
  cards: readonly IllustratorCard[],
  collection: Iterable<IllustratorCollectionItem>,
  options: { filter?: IllustratorCardFilter; sort?: IllustratorCardSort; text?: string; priceOf?: CardPriceOf } = {},
): IllustratorCardEntry[] {
  const { filter = 'all', sort = 'newest', text = '', priceOf } = options;
  const ownedIds = new Set<string>();
  const wantedIds = new Set<string>();
  for (const item of collection) {
    if (item.card_id) (item.status === 'wishlisted' ? wantedIds : ownedIds).add(item.card_id);
    for (const wanted of item.wanted_cards ?? []) wantedIds.add(wanted.card_id);
  }

  const needle = normalizeIllustratorText(text);
  return cards
    .toSorted(compareIllustratorCards(sort, priceOf))
    .map((card) => {
      const ids = catalogCardIds(card);
      return {
        card,
        owned: ids.some((id) => ownedIds.has(id)),
        wanted: ids.some((id) => wantedIds.has(id)),
        numberLabel: formatCardNumber(card),
        variantLabels: getCardVariantLabels(card.variants),
      };
    })
    .filter(
      (entry) =>
        filter === 'all' ||
        (filter === 'owned' ? entry.owned : filter === 'wanted' ? entry.wanted && !entry.owned : !entry.owned),
    )
    .filter(
      (entry) =>
        !needle ||
        [entry.card.name, entry.card.set.name, entry.card.set.id, entry.numberLabel, entry.card.rarity ?? ''].some(
          (value) => normalizeIllustratorText(value).includes(needle),
        ),
    );
}

export function countIllustratorEntries(entries: readonly IllustratorCardEntry[]) {
  return {
    all: entries.length,
    owned: entries.filter((entry) => entry.owned).length,
    wanted: entries.filter((entry) => entry.wanted && !entry.owned).length,
    missing: entries.filter((entry) => !entry.owned).length,
  } satisfies Record<IllustratorCardFilter, number>;
}
