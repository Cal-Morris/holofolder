import type { CardCatalogIdentity, CardFinish, CardLanguage } from '@/lib/domain/cards';

export interface TCGSetSummary {
  id: string;
  name: string;
  seriesName?: string;
  officialCardCount?: number;
  releaseDate?: string;
  /** Set symbol and logo image URLs (origin URLs; load them through the image proxy). Only on the browse list. */
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
