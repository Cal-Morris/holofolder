/**
 * Pure helpers for the read-only "all cards for this Pokémon" view and the global card search.
 * Shared by the client UI, the search API and unit tests.
 */
import { matchesCatalogCardId } from '@/lib/card-catalog';
import type { CardCatalogIdentity, CardFinish } from '@/lib/domain/cards';

export interface BrowseCardVariants {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
  wPromo?: boolean;
  jumbo?: boolean;
}

export interface BrowseCard extends CardCatalogIdentity {
  id: string;
  localId: string;
  name: string;
  image?: string;
  language?: string;
  set: {
    id: string;
    name: string;
    officialCardCount?: number;
    releaseDate?: string;
  };
  rarity?: string;
  variants?: BrowseCardVariants;
}

export interface SearchCardResult extends BrowseCard {
  dexIds: number[];
  /** Credited artist, when the catalog has one (card search matches it too). */
  illustrator?: string;
}

export interface BrowseCollectionState {
  card_id?: string | null;
  status?: string | null;
  wanted_cards?: Array<{ card_id: string }> | null;
}

export type BrowseCardFilter = 'all' | 'owned' | 'wanted';

export interface BrowseCardEntry<TCard extends BrowseCard = BrowseCard> {
  card: TCard;
  owned: boolean;
  wanted: boolean;
  variantLabels: string[];
  numberLabel: string;
}

export function inferCardFinish(rarity: unknown, variants: unknown): CardFinish {
  const rarityLabel = typeof rarity === 'string' ? rarity.toLowerCase() : '';
  const variantMap = variants && typeof variants === 'object' ? (variants as Record<string, unknown>) : {};

  if (rarityLabel.includes('special illustration')) return 'special_illustration_rare';
  if (rarityLabel.includes('illustration')) return 'illustration_rare';
  if (rarityLabel.includes('hyper')) return 'hyper_rare';
  if (rarityLabel.includes('secret')) return 'secret_rare';
  if (rarityLabel.includes('radiant')) return 'radiant_rare';
  if (rarityLabel.includes('ace')) return 'ace_spec';
  if (rarityLabel.includes('amazing')) return 'amazing_rare';
  if (rarityLabel.includes('shiny')) return 'shiny_rare';
  if (rarityLabel.includes('ultra')) return 'ultra_rare';
  if (rarityLabel.includes('double')) return 'double_rare';
  if (variantMap.jumbo) return 'jumbo';
  if (variantMap.holo) return 'holo';

  return 'normal';
}

const VARIANT_LABELS: Array<[keyof BrowseCardVariants, string]> = [
  ['normal', 'Normal'],
  ['holo', 'Holo'],
  ['reverse', 'Reverse'],
  ['firstEdition', '1st Edition'],
  ['wPromo', 'Promo'],
  ['jumbo', 'Jumbo'],
];

export function getCardVariantLabels(variants?: BrowseCardVariants | null) {
  if (!variants) return [];
  return VARIANT_LABELS.flatMap(([key, label]) => (variants[key] ? [label] : []));
}

export function formatCardNumber(card: Pick<BrowseCard, 'localId' | 'set'>) {
  const total = card.set.officialCardCount;
  return total ? `${card.localId}/${total}` : `#${card.localId}`;
}

/** Newest set first (cards without a release date last), then by card number. */
export function compareBrowseCards(a: BrowseCard, b: BrowseCard) {
  const aDate = a.set.releaseDate ?? '';
  const bDate = b.set.releaseDate ?? '';
  if (aDate !== bDate) {
    if (!aDate) return 1;
    if (!bDate) return -1;
    return bDate.localeCompare(aDate);
  }
  if (a.set.id !== b.set.id) return a.set.id.localeCompare(b.set.id);
  return a.localId.localeCompare(b.localId, undefined, { numeric: true });
}

export function buildBrowseEntries<TCard extends BrowseCard>(
  cards: TCard[],
  collectionItem: BrowseCollectionState | null | undefined,
  filter: BrowseCardFilter = 'all',
): BrowseCardEntry<TCard>[] {
  const ownedCardId =
    collectionItem && collectionItem.status !== 'wishlisted' ? (collectionItem.card_id ?? null) : null;
  const wantedIds = new Set((collectionItem?.wanted_cards ?? []).map((wanted) => wanted.card_id));

  return cards.toSorted(compareBrowseCards).flatMap((card) => {
    const entry = {
      card,
      owned: matchesCatalogCardId(card, ownedCardId),
      wanted: [...wantedIds].some((id) => matchesCatalogCardId(card, id)),
      variantLabels: getCardVariantLabels(card.variants),
      numberLabel: formatCardNumber(card),
    };
    return filter === 'all' || (filter === 'owned' ? entry.owned : entry.wanted) ? [entry] : [];
  });
}

export interface ParsedCardSearchQuery {
  /** Free text with the card number removed (name or set). */
  text: string;
  /** Card number within a set, e.g. "44" from "bulbasaur 44/102". */
  number: string | null;
  /** Looks like a TCGdex card id such as "base1-44" or "sv03.5-001". */
  cardId: string | null;
}

export function sanitizeSearchText(value: string) {
  return value
    .replace(/[,%()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCardSearchQuery(raw: string): ParsedCardSearchQuery {
  const query = sanitizeSearchText(raw).toLowerCase();
  if (!query) return { text: '', number: null, cardId: null };

  const cardId = /^[a-z0-9.]+-[a-z0-9]+(?:~\d+)?$/i.test(query) && /\d/.test(query) ? query : null;

  // "44/102", "#44", "no. 44" or a trailing/leading bare number next to other words.
  const tokens = query.split(' ');
  let number: string | null = null;
  const rest: string[] = [];
  for (const token of tokens) {
    const slash = /^#?([a-z]{0,3}\d{1,4}[a-z]?)\/[a-z]{0,3}\d{1,4}$/.exec(token);
    const hash = /^#(\d{1,4}[a-z]?)$/.exec(token);
    if (!number && slash) {
      number = slash[1];
    } else if (!number && hash && tokens.length > 1) {
      number = hash[1];
    } else if (!number && tokens.length > 1 && /^\d{1,4}[a-z]?$/.test(token)) {
      number = token;
    } else {
      rest.push(token);
    }
  }

  // Literal text: "mew" is both a Pokémon and a printed set code, so callers try both via resolveSetSearchAlias.
  return { text: rest.join(' '), number, cardId };
}

/** Normalised local id for comparison ("004" → "4"). */
export function normalizeLocalId(value: string) {
  const trimmed = value.trim().toLowerCase();
  const numeric = /^0*(\d+)([a-z]?)$/.exec(trimmed);
  return numeric ? `${numeric[1]}${numeric[2]}` : trimmed;
}

export interface CardSearchGroup<TCard extends SearchCardResult = SearchCardResult> {
  dexId: number;
  name: string;
  cards: TCard[];
}

/** Group card hits by Pokémon (a card featuring two Pokémon appears under both), keeping result order. */
export function groupCardResultsByPokemon<TCard extends SearchCardResult>(
  cards: TCard[],
  getPokemonName: (dexId: number) => string | null | undefined,
  options: { maxGroups?: number; maxCardsPerGroup?: number } = {},
): CardSearchGroup<TCard>[] {
  const { maxGroups = 12, maxCardsPerGroup = 8 } = options;
  const groups = new Map<number, CardSearchGroup<TCard>>();

  for (const card of cards) {
    for (const dexId of card.dexIds) {
      const name = getPokemonName(dexId);
      if (!name) continue;
      const group = groups.get(dexId) ?? { dexId, name, cards: [] };
      if (!group.cards.some((existing) => existing.id === card.id)) group.cards.push(card);
      groups.set(dexId, group);
    }
  }

  return Array.from(groups.values())
    .slice(0, maxGroups)
    .map((group) => ({ ...group, cards: group.cards.toSorted(compareBrowseCards).slice(0, maxCardsPerGroup) }));
}
