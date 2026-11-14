import type { CardPriceSnapshot } from '@/hooks/use-card-prices';
import { getCardPriceKey, type CardPriceLookup } from '@/lib/card-pricing';
import { isCardLanguage, type WantedCard } from '@/lib/domain/cards';
import { applyPriceStaleness } from '@/lib/price-freshness';
import type { PricingRegion } from '@/lib/pricing-region';
import { regionalizeCardPrices } from '@/lib/regional-price';
import { getFallingMomentum, getRisingMomentum, isMomentumEligibleConfidence } from '@/lib/price-momentum';
import { buildHuntGroups, getSetEra, getSetIdFromCardId, type HuntCard, type HuntSourceItem } from '@/lib/show-hunt';

export type WantedDashboardSort =
  'highest' | 'lowest' | 'cheapest-set' | 'name' | 'set' | 'newest' | 'rising' | 'dex' | 'unpriced' | 'pokemon';
export type WantedDashboardPriceBandId = 'under-5' | 'five-to-15' | 'fifteen-to-50' | 'over-50' | 'unpriced';

export interface WantedDashboardEntry {
  pokemonId: number;
  pokemonName: string;
  card: WantedCard;
  /** Set in the All binders want list: the binder this printing is wanted in. */
  binderId?: string;
  binderName?: string;
  locations?: WantedLocation[];
}

export interface WantedLocation {
  binderId: string;
  binderName: string;
  pokemonId: number;
  pokemonName: string;
  card: WantedCard;
}

export interface WantedDashboardCard extends WantedDashboardEntry {
  key: string;
  price: CardPriceSnapshot | undefined;
  marketGbpAmount: number | null;
  goodGbpAmount: number | null;
  effectiveGbpAmount: number | null;
  isPriced: boolean;
  priceBandId: WantedDashboardPriceBandId;
}

export interface WantedDashboardPriceBand {
  id: WantedDashboardPriceBandId;
  label: string;
  count: number;
  totalGbp: number;
}

export interface WantedDashboardBreakdown {
  label: string;
  count: number;
  totalGbp: number;
}

export interface WantedDashboardSummary {
  cards: WantedDashboardCard[];
  totalCards: number;
  pricedCount: number;
  unpricedCount: number;
  marketTotalGbp: number;
  averageGbp: number | null;
  highestCards: WantedDashboardCard[];
  unpricedCards: WantedDashboardCard[];
  priceBands: WantedDashboardPriceBand[];
  setBreakdown: WantedDashboardBreakdown[];
  languageBreakdown: WantedDashboardBreakdown[];
  finishBreakdown: WantedDashboardBreakdown[];
}

export const WANTED_PRICE_BAND_LABELS: Record<WantedDashboardPriceBandId, string> = {
  'under-5': 'Under £5',
  'five-to-15': '£5-£15',
  'fifteen-to-50': '£15-£50',
  'over-50': '£50+',
  unpriced: 'Unpriced',
};

const PRICE_BANDS: Array<Pick<WantedDashboardPriceBand, 'id' | 'label'>> = [
  { id: 'under-5', label: WANTED_PRICE_BAND_LABELS['under-5'] },
  { id: 'five-to-15', label: WANTED_PRICE_BAND_LABELS['five-to-15'] },
  { id: 'fifteen-to-50', label: WANTED_PRICE_BAND_LABELS['fifteen-to-50'] },
  { id: 'over-50', label: WANTED_PRICE_BAND_LABELS['over-50'] },
  { id: 'unpriced', label: WANTED_PRICE_BAND_LABELS.unpriced },
];

const SUPPORTED_CARD_LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt-br', 'ja', 'ko'];

export function buildWantedDashboardSummary(
  entries: WantedDashboardEntry[],
  pricesByCardKey: Record<string, CardPriceSnapshot>,
): WantedDashboardSummary {
  const cards = entries.map((entry) => {
    const language = entry.card.card_language ?? 'en';
    const price = pricesByCardKey[getWantedCardPriceKey(entry.card.card_id, language)];
    const marketGbpAmount = getWantedPriceAmount(price);
    const goodGbpAmount = normalizePriceAmount(price?.goodGbpAmount);
    const isPriced = marketGbpAmount != null;

    return {
      ...entry,
      key: [
        entry.pokemonId,
        entry.card.card_id,
        language,
        entry.card.card_finish ?? 'normal',
        entry.card.added_at,
        ...(entry.binderId ? [entry.binderId] : []),
      ].join('::'),
      price,
      marketGbpAmount,
      goodGbpAmount,
      effectiveGbpAmount: marketGbpAmount,
      isPriced,
      priceBandId: getWantedPriceBandId(marketGbpAmount),
    };
  });

  const priceBands = PRICE_BANDS.map((band) => ({
    ...band,
    count: 0,
    totalGbp: 0,
  }));
  const bandById = new Map(priceBands.map((band) => [band.id, band]));
  const setGroups = new Map<string, WantedDashboardBreakdown>();
  const languageGroups = new Map<string, WantedDashboardBreakdown>();
  const finishGroups = new Map<string, WantedDashboardBreakdown>();
  let marketTotalGbp = 0;
  let pricedCount = 0;

  for (const card of cards) {
    const amount = card.effectiveGbpAmount ?? 0;
    const band = bandById.get(card.priceBandId);
    if (band) {
      band.count += 1;
      band.totalGbp = roundMoney(band.totalGbp + amount);
    }

    if (card.effectiveGbpAmount != null) {
      pricedCount += 1;
      marketTotalGbp = roundMoney(marketTotalGbp + card.effectiveGbpAmount);
    }

    incrementBreakdown(setGroups, card.card.card_set || 'Unknown set', amount);
    incrementBreakdown(languageGroups, card.card.card_language ?? 'en', amount);
    incrementBreakdown(finishGroups, card.card.card_finish ?? 'normal', amount);
  }

  return {
    cards,
    totalCards: cards.length,
    pricedCount,
    unpricedCount: cards.length - pricedCount,
    marketTotalGbp,
    averageGbp: pricedCount > 0 ? roundMoney(marketTotalGbp / pricedCount) : null,
    highestCards: sortWantedDashboardEntries(cards, 'highest')
      .filter((card) => card.isPriced)
      .slice(0, 5),
    unpricedCards: cards.filter((card) => !card.isPriced).slice(0, 5),
    priceBands,
    setBreakdown: sortBreakdown(setGroups),
    languageBreakdown: sortBreakdown(languageGroups),
    finishBreakdown: sortBreakdown(finishGroups),
  };
}

/** Sort and filters are remembered on this device between visits (same key for every want list). */
export const WANTED_VIEW_STORAGE_KEY = 'binderdex:wanted-view:v1';

/** The remembered want-list sort and filters, or the defaults when storage is empty, unreadable or blocked. */
export function readRememberedWantedView(): { sort: WantedDashboardSort; filters: WantedFilters } {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(WANTED_VIEW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { sort?: unknown; filters?: unknown };
      return { sort: normalizeWantedSort(parsed.sort), filters: normalizeWantedFilters(parsed.filters) };
    }
  } catch {
    // Unreadable or blocked storage: start from the defaults.
  }
  return { sort: 'highest', filters: EMPTY_WANTED_FILTERS };
}

/**
 * What it would cost to finish a want list, from prices reliable enough to add up (high or medium confidence).
 * Cards without such a price are counted, never guessed.
 */
export function wantedCompletionTotal(cards: readonly Pick<WantedDashboardCard, 'effectiveGbpAmount' | 'price'>[]) {
  let totalGbp = 0,
    priced = 0;
  for (const card of cards) {
    if (card.effectiveGbpAmount == null || !isMomentumEligibleConfidence(card.price?.confidence)) continue;
    totalGbp += card.effectiveGbpAmount;
    priced++;
  }
  return { totalGbp: roundMoney(totalGbp), priced, unknown: cards.length - priced };
}

export const WANTED_SORTS: Array<{ id: WantedDashboardSort; label: string; short: string }> = [
  { id: 'highest', label: 'Price: high to low', short: 'Price ↓' },
  { id: 'lowest', label: 'Price: low to high', short: 'Price ↑' },
  { id: 'cheapest-set', label: 'Cheapest set to finish first', short: 'Cheapest set' },
  { id: 'name', label: 'Name', short: 'Name' },
  { id: 'set', label: 'Set', short: 'Set' },
  { id: 'newest', label: 'Recently added', short: 'Newest' },
  { id: 'rising', label: 'Rising prices first', short: 'Rising' },
  { id: 'dex', label: 'Pokédex number', short: 'Dex no.' },
  { id: 'unpriced', label: 'Unpriced first', short: 'Unpriced' },
  { id: 'pokemon', label: 'Group by Pokémon', short: 'By Pokémon' },
];

export function normalizeWantedSort(value: unknown): WantedDashboardSort {
  return WANTED_SORTS.some((sort) => sort.id === value) ? (value as WantedDashboardSort) : 'highest';
}

export function sortWantedDashboardEntries<T extends WantedDashboardCard>(
  cards: T[],
  sort: WantedDashboardSort,
  // Read only by the Rising sort; other sorts never touch the clock, so prerendered pages stay static.
  now?: number,
): T[] {
  if (sort === 'cheapest-set') {
    // Sets whose remaining wanted cards cost least come first; unpriced cards count as unknown
    // and push their set after fully priced ones. Within a set, cheapest card first.
    const setCost = new Map<string, { total: number; unpriced: number }>();
    for (const card of cards) {
      const key = card.card.card_set || 'Unknown set';
      const current = setCost.get(key) ?? { total: 0, unpriced: 0 };
      if (card.effectiveGbpAmount == null) current.unpriced += 1;
      else current.total = roundMoney(current.total + card.effectiveGbpAmount);
      setCost.set(key, current);
    }
    return cards.toSorted((left, right) => {
      const leftSet = left.card.card_set || 'Unknown set';
      const rightSet = right.card.card_set || 'Unknown set';
      const a = setCost.get(leftSet)!;
      const b = setCost.get(rightSet)!;
      return (
        Number(a.unpriced > 0) - Number(b.unpriced > 0) ||
        a.total - b.total ||
        leftSet.localeCompare(rightSet) ||
        comparePriceAscending(left, right) ||
        compareDex(left, right)
      );
    });
  }

  if (sort === 'pokemon') {
    return groupWantedByPokemon(cards).flatMap((group) => group.cards);
  }

  if (sort === 'rising') {
    const at = now ?? Date.now();
    const change = new Map(cards.map((card) => [card.key, getRisingMomentum(card.price, at)?.change ?? null]));
    return cards.toSorted(
      (left, right) =>
        compareMaybePrice(negate(change.get(left.key) ?? null), negate(change.get(right.key) ?? null)) ||
        comparePriceDescending(left, right) ||
        compareDex(left, right),
    );
  }

  return cards.toSorted((left, right) => {
    if (sort === 'highest') {
      return comparePriceDescending(left, right) || compareDex(left, right);
    }

    if (sort === 'lowest') {
      return comparePriceAscending(left, right) || compareDex(left, right);
    }

    if (sort === 'unpriced') {
      return (
        Number(left.isPriced) - Number(right.isPriced) || comparePriceDescending(left, right) || compareDex(left, right)
      );
    }

    if (sort === 'dex') {
      return compareDex(left, right);
    }

    if (sort === 'name') {
      return (
        left.card.card_name.localeCompare(right.card.card_name) ||
        (left.card.card_set || '').localeCompare(right.card.card_set || '') ||
        compareLocalId(left, right)
      );
    }

    if (sort === 'set') {
      return (
        (left.card.card_set || '').localeCompare(right.card.card_set || '') ||
        compareLocalId(left, right) ||
        compareDex(left, right) ||
        left.card.card_name.localeCompare(right.card.card_name)
      );
    }

    return compareNewest(left, right) || compareDex(left, right);
  });
}

function negate(value: number | null) {
  return value == null ? null : -value;
}

function compareLocalId(left: WantedDashboardCard, right: WantedDashboardCard) {
  const a = Number.parseInt(left.card.local_id ?? '', 10);
  const b = Number.parseInt(right.card.local_id ?? '', 10);
  return compareMaybePrice(Number.isFinite(a) ? a : null, Number.isFinite(b) ? b : null);
}

export interface WantedPokemonGroup<T extends WantedDashboardCard = WantedDashboardCard> {
  pokemonId: number;
  pokemonName: string;
  cards: T[];
  /** Dearest card in the group (GBP), or null when none is priced. */
  topGbpAmount: number | null;
}

/**
 * The want list grouped by Pokémon, the same way Show mode's Hunting list does it (buildHuntGroups): the
 * Pokémon with the most wanted cards first (ties: the dearest card), dearest card first within a group.
 */
export function groupWantedByPokemon<T extends WantedDashboardCard>(cards: T[]): WantedPokemonGroup<T>[] {
  const byKey = new Map(cards.map((card) => [card.key, card]));
  const items = new Map<number, HuntSourceItem>();
  const huntCards: HuntCard[] = cards.map((card) => {
    if (!items.has(card.pokemonId))
      items.set(card.pokemonId, { pokemon_id: card.pokemonId, pokemon_name: card.pokemonName });
    const setId = getSetIdFromCardId(card.card.card_id, card.card.local_id);
    return {
      // The dashboard key, not huntCardKey: the All binders list can hold the same printing twice.
      key: card.key,
      pokemonId: card.pokemonId,
      pokemonName: card.pokemonName,
      wanted: card.card,
      setId,
      setName: card.card.card_set || setId,
      era: getSetEra(setId),
      price: card.effectiveGbpAmount,
    };
  });
  return buildHuntGroups([...items.values()], huntCards, 'wanted').map((group) => ({
    pokemonId: group.pokemonId,
    pokemonName: group.pokemonName,
    cards: group.cards.map((card) => byKey.get(card.key)!),
    topGbpAmount: group.topPrice,
  }));
}

/** The want list's filters. Empty lists mean "any". */
export interface WantedFilters {
  bands: WantedDashboardPriceBandId[];
  sets: string[];
  finishes: string[];
  languages: string[];
  risingOnly: boolean;
  /** Only cards whose UK price has dropped (see getFallingMomentum). */
  dropsOnly: boolean;
}

export const EMPTY_WANTED_FILTERS: WantedFilters = {
  bands: [],
  sets: [],
  finishes: [],
  languages: [],
  risingOnly: false,
  dropsOnly: false,
};

const PRICE_BAND_IDS = new Set<string>(['under-5', 'five-to-15', 'fifteen-to-50', 'over-50', 'unpriced']);

function stringList(value: unknown, limit = 50) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 120),
        ),
      ].slice(0, limit)
    : [];
}

export function normalizeWantedFilters(value: unknown): WantedFilters {
  if (!value || typeof value !== 'object') return EMPTY_WANTED_FILTERS;
  const raw = value as Record<string, unknown>;
  return {
    bands: stringList(raw.bands).filter((band): band is WantedDashboardPriceBandId => PRICE_BAND_IDS.has(band)),
    sets: stringList(raw.sets),
    finishes: stringList(raw.finishes),
    languages: stringList(raw.languages),
    risingOnly: raw.risingOnly === true,
    dropsOnly: raw.dropsOnly === true,
  };
}

export function countWantedFilters(filters: WantedFilters) {
  return (
    filters.bands.length +
    filters.sets.length +
    filters.finishes.length +
    filters.languages.length +
    Number(filters.risingOnly) +
    Number(filters.dropsOnly)
  );
}

export function applyWantedFilters<T extends WantedDashboardCard>(
  cards: T[],
  filters: WantedFilters,
  now = Date.now(),
): T[] {
  if (countWantedFilters(filters) === 0) return cards;
  return cards.filter(
    (card) =>
      (filters.bands.length === 0 || filters.bands.includes(card.priceBandId)) &&
      (filters.sets.length === 0 || filters.sets.includes(card.card.card_set || 'Unknown set')) &&
      (filters.finishes.length === 0 || filters.finishes.includes(card.card.card_finish ?? 'normal')) &&
      (filters.languages.length === 0 || filters.languages.includes(card.card.card_language ?? 'en')) &&
      (!filters.risingOnly || getRisingMomentum(card.price, now) != null) &&
      (!filters.dropsOnly || hasWantedPriceDrop(card, now)),
  );
}

/**
 * Price-drop alert for a wanted card: its UK price has fallen meaningfully against its own recent
 * average (same rules and data gates as the Rising badge, mirrored). Computed on the device from the
 * price data already loaded for the list, so there is no server job.
 */
export function hasWantedPriceDrop(card: Pick<WantedDashboardCard, 'price' | 'isPriced'>, now = Date.now()) {
  return card.isPriced && getFallingMomentum(card.price, now) != null;
}

export function countWantedPriceDrops(cards: Array<Pick<WantedDashboardCard, 'price' | 'isPriced'>>, now = Date.now()) {
  return cards.reduce((count, card) => count + Number(hasWantedPriceDrop(card, now)), 0);
}

export function toggleWantedFilter<K extends Exclude<keyof WantedFilters, 'risingOnly' | 'dropsOnly'>>(
  filters: WantedFilters,
  key: K,
  value: WantedFilters[K][number],
): WantedFilters {
  const list = filters[key] as string[];
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return { ...filters, [key]: next };
}

function getWantedCardPriceKey(cardId: string, language: unknown = 'en') {
  const normalized = typeof language === 'string' ? language.trim().toLowerCase() : 'en';
  const safeLanguage = SUPPORTED_CARD_LANGUAGES.includes(normalized) ? normalized : 'en';
  return `${cardId}::${safeLanguage}`;
}

function getWantedPriceAmount(price: CardPriceSnapshot | undefined) {
  return (
    normalizePriceAmount(price?.marketGbpAmount) ??
    normalizePriceAmount(price?.gbpAmount) ??
    normalizePriceAmount(price?.goodGbpAmount) ??
    normalizePriceAmount(price?.lowGbpAmount)
  );
}

function getWantedPriceBandId(amount: number | null): WantedDashboardPriceBandId {
  if (amount == null) return 'unpriced';
  if (amount < 5) return 'under-5';
  if (amount < 15) return 'five-to-15';
  if (amount < 50) return 'fifteen-to-50';
  return 'over-50';
}

function normalizePriceAmount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? roundMoney(value) : null;
}

function incrementBreakdown(groups: Map<string, WantedDashboardBreakdown>, label: string, amount: number) {
  const current = groups.get(label) ?? { label, count: 0, totalGbp: 0 };
  current.count += 1;
  current.totalGbp = roundMoney(current.totalGbp + amount);
  groups.set(label, current);
}

function sortBreakdown(groups: Map<string, WantedDashboardBreakdown>) {
  return Array.from(groups.values()).sort(
    (left, right) =>
      right.count - left.count || right.totalGbp - left.totalGbp || left.label.localeCompare(right.label),
  );
}

function comparePriceDescending(left: WantedDashboardCard, right: WantedDashboardCard) {
  if (left.effectiveGbpAmount == null && right.effectiveGbpAmount == null) return 0;
  if (left.effectiveGbpAmount == null) return 1;
  if (right.effectiveGbpAmount == null) return -1;
  return right.effectiveGbpAmount - left.effectiveGbpAmount;
}

function comparePriceAscending(left: WantedDashboardCard, right: WantedDashboardCard) {
  return compareMaybePrice(left.effectiveGbpAmount, right.effectiveGbpAmount);
}

function compareMaybePrice(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function compareDex(left: WantedDashboardCard, right: WantedDashboardCard) {
  return (
    left.pokemonId - right.pokemonId ||
    left.pokemonName.localeCompare(right.pokemonName) ||
    left.card.card_name.localeCompare(right.card.card_name)
  );
}

function compareNewest(left: WantedDashboardCard, right: WantedDashboardCard) {
  return Date.parse(right.card.added_at) - Date.parse(left.card.added_at);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** Lowercase, strip accents (Flabébé, Kouki Saitō) and collapse spaces so search is forgiving. */
export function normalizeWantedSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function wantedSearchHaystack(entry: WantedDashboardEntry) {
  const { card } = entry;
  const localId = card.local_id?.trim();
  const numberParts = localId
    ? [localId, `#${localId}`, localId.replace(/^0+(?=\d)/, ''), card.set_total ? `${localId}/${card.set_total}` : '']
    : [];
  return normalizeWantedSearchText(
    [
      card.card_name,
      entry.pokemonName,
      card.card_set ?? '',
      card.rarity ?? '',
      card.illustrator ?? '',
      card.card_finish ?? '',
      ...numberParts,
    ].join(' '),
  );
}

/**
 * Want-list search: every word must match the card name, Pokémon, set, number (007, #7, 7/165),
 * rarity, finish or illustrator. An empty query matches everything.
 */
export function matchesWantedSearch(entry: WantedDashboardEntry, query: string) {
  const words = normalizeWantedSearchText(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = wantedSearchHaystack(entry);
  const tokens = haystack.split(' ');
  return words.every((word) => {
    const bare = word.replace(/^#/, '').replace(/^0+(?=\d)/, '');
    if (/^\d+$/.test(bare)) {
      // Numbers match a card number exactly (7 finds #007, not #070 or #171).
      return tokens.some((token) => token.replace(/^#/, '').replace(/^0+(?=\d)/, '') === bare || token === word);
    }
    return haystack.includes(word);
  });
}

export function filterWantedDashboardEntries<T extends WantedDashboardEntry>(cards: T[], query: string): T[] {
  if (!normalizeWantedSearchText(query)) return cards;
  return cards.filter((card) => matchesWantedSearch(card, query));
}

/** One saved-price lookup per wanted card and language. */
export function wantedPriceLookups(cards: readonly Pick<WantedCard, 'card_id' | 'card_language'>[]): CardPriceLookup[] {
  return [
    ...new Map(
      cards.flatMap((card) =>
        isCardLanguage(card.card_language)
          ? [
              [
                getCardPriceKey(card.card_id, card.card_language),
                { cardId: card.card_id, language: card.card_language },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ];
}

/** Saved snapshots aged from their fetch time and regionalised, keyed the way `buildWantedDashboardSummary` reads them. */
export function wantedPricesByKey(prices: readonly CardPriceSnapshot[], region: PricingRegion) {
  const regional = regionalizeCardPrices(
    Object.fromEntries(
      prices.map((price) => [
        getCardPriceKey(price.cardId, price.language),
        { ...price, ...applyPriceStaleness(price, price.fetchedAt) },
      ]),
    ),
    region,
  );
  return Object.fromEntries(Object.values(regional).map((price) => [`${price.cardId}::${price.language}`, price]));
}
