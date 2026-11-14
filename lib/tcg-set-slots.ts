import type { CardCatalogIdentity, CardFinish, CardLanguage } from '@/lib/domain/cards';

export interface TCGSetSummary {
  id: string;
  name: string;
  seriesName?: string;
  officialCardCount?: number;
  releaseDate?: string;
  /** TCGdex languages the set was printed in (its name keys); absent on older saved lists. */
  languages?: string[];
  /** Verified public CDN set artwork, available on browse and search summaries. */
  symbol?: string;
  logo?: string;
}

export interface TCGSetSlotCard extends CardCatalogIdentity {
  id: string;
  localId: string;
  name: string;
  image?: string;
  language: CardLanguage;
  /** Explicit catalog language evidence; a requested/fallback language alone is insufficient. */
  languageConfirmed?: boolean;
  set: TCGSetSummary;
  rarity?: string;
  variants?: {
    normal?: boolean;
    reverse?: boolean;
    holo?: boolean;
    firstEdition?: boolean;
    wPromo?: boolean;
    jumbo?: boolean;
  };
  inferredFinish: CardFinish;
}

export interface TCGSetDexSlot {
  dexId: number;
  pokemonName: string;
  cards: TCGSetSlotCard[];
}

export interface TCGSetSlotsResponse {
  sets: TCGSetSummary[];
  selectedSet: TCGSetSummary | null;
  slots: TCGSetDexSlot[];
  cards?: TCGSetSlotCard[];
}

/**
 * What `/app/api/tcg-set-slots?setId=` sends: every card once in `cards`, without its set (always `selectedSet`),
 * and each slot as card ids into that list. `expandSetSlotsResponse` rebuilds the full shape.
 */
export interface TCGSetSlotsWireResponse {
  sets: TCGSetSummary[];
  selectedSet: TCGSetSummary | null;
  slots: Array<{ dexId: number; pokemonName: string; cardIds: string[] }>;
  cards?: Array<Omit<TCGSetSlotCard, 'set'>>;
}

/** Requests with `v=2` get the slim shape; without it the route keeps sending the old one to older clients. */
export const SET_SLOTS_WIRE_VERSION = '2';

export function slimSetSlotsResponse(response: TCGSetSlotsResponse): TCGSetSlotsWireResponse {
  return {
    sets: response.sets,
    selectedSet: response.selectedSet,
    slots: response.slots.map(({ cards, ...slot }) => ({ ...slot, cardIds: cards.map((card) => card.id) })),
    cards: response.cards?.map(({ set: _set, ...card }) => card),
  };
}

/**
 * The full response from either shape: the slim wire one, or the older one (still in saved and cached copies).
 * Saved copies are untrusted, so malformed entries pass through for the caller's own checks.
 */
export function expandSetSlotsResponse(payload: TCGSetSlotsWireResponse | TCGSetSlotsResponse): TCGSetSlotsResponse {
  type Loose = { set?: TCGSetSummary; cards?: unknown; cardIds?: unknown };
  const cards = payload.cards?.map((card) =>
    card && !(card as Loose).set && payload.selectedSet ? { ...card, set: payload.selectedSet } : card,
  ) as TCGSetSlotCard[] | undefined;
  const byId = new Map(cards?.map((card) => [card?.id, card]));
  return {
    ...payload,
    cards,
    slots: payload.slots.map((slot) => {
      const loose = slot as Loose | null;
      if (!loose || Array.isArray(loose.cards) || !Array.isArray(loose.cardIds)) return slot as TCGSetDexSlot;
      const { cardIds, ...rest } = slot as TCGSetSlotsWireResponse['slots'][number];
      return { ...rest, cards: cardIds.flatMap((id) => byId.get(id) ?? []) };
    }),
  };
}

export const RECENT_SET_MIN_OFFICIAL_CARDS = 20;

/**
 * Max sets returned for a Sets view name search. Generic words match whole families
 * ("promo" matches 12 sets, "McDonald" 15), and the results
 * are a horizontal scroller, so keep this well above the largest family.
 */
export const SET_SEARCH_RESULT_LIMIT = 30;

/**
 * TCGdex ids for the Pokémon TCG 30th anniversary sets ("30th Celebration" and "30th Classic Collection").
 * 30th Classic Collection reports 0 official cards (all reprints), so it bypasses the size filter.
 */
export const ANNIVERSARY_SET_IDS: readonly string[] = ['30th', '30th-c'];
const ALWAYS_LISTED_RECENT_SET_IDS = new Set(ANNIVERSARY_SET_IDS);

/**
 * Picks the newest released main-line sets for the Sets view "Latest sets" shortcuts.
 * Skips unreleased sets (release date after `asOfDate`), sets without a release date,
 * and tiny products such as promo lists or energy sets that have few official cards.
 */
export function selectRecentSetSummaries(
  sets: TCGSetSummary[],
  {
    asOfDate,
    limit = 6,
    minOfficialCardCount = RECENT_SET_MIN_OFFICIAL_CARDS,
  }: { asOfDate: string; limit?: number; minOfficialCardCount?: number },
): TCGSetSummary[] {
  const seen = new Set<string>();

  return sets
    .filter((set) => {
      if (!set.id || seen.has(set.id)) return false;
      if (!set.releaseDate || set.releaseDate > asOfDate) return false;
      if ((set.officialCardCount ?? 0) < minOfficialCardCount && !ALWAYS_LISTED_RECENT_SET_IDS.has(set.id))
        return false;
      seen.add(set.id);
      return true;
    })
    .sort((left, right) => (right.releaseDate ?? '').localeCompare(left.releaseDate ?? ''))
    .slice(0, Math.max(0, limit));
}
