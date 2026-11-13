import {
  expandSearchAliases,
  hasRarity,
  matchCardNicknames,
  matchesNicknameRest,
  matchRarityWords,
} from '@/lib/card-nicknames';
import {
  cardNameSearchFilter,
  cardSearchSetCandidates,
  correctedCardSearchQuery,
  resolveCardSearchQuery,
} from '@/lib/card-search-query';
import type { ImportLookup } from '@/lib/collection-import';
import { resolveSetSearchAlias } from '@/lib/set-search-aliases';
import { getSetArtwork } from '@/lib/set-artwork';
import { isSetYearQuery, rankSetMatches } from '@/lib/set-search';
import { isSetInLanguage } from '@/lib/set-browse';
import type { CardCatalogIdentity, CardLanguage } from '@/lib/domain/cards';
import { cardLanguagesFromNames, primaryCardLanguage, type CardSearchLanguage } from '@/lib/card-languages';
import { formatPokemonDisplayName, POKEMON_CATALOG } from '@/lib/pokemon-catalog';
import { deduplicateCatalogCards, readCatalogMetadata } from '@/lib/card-catalog';
import { rankPageSuggestions, type SuggestionTraits } from '@/lib/page-card-suggestions';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  selectRecentSetSummaries,
  type TCGSetDexSlot,
  type TCGSetSlotCard,
  type TCGSetSummary,
} from '@/lib/tcg-set-slots';
import { cacheLife, cacheTag } from 'next/cache';
import { EMBEDDING_MODEL } from '@/lib/card-assets/embeddings-db';
import {
  normalizeSimilarNeighbours,
  SIMILAR_NEIGHBOUR_LIMIT,
  splitSimilarNeighbours,
  type CardSubject,
  type SimilarCard,
  type SimilarCardsResponse,
  type SplitNeighbour,
} from '@/lib/similar-cards';
import { buildTcgdexAssetImageUrl, pickImageLanguage, pickLocalizedText } from '@/lib/tcgdex-shared';
import { pickCardImageUrl, pickExternalCardImageUrl } from '@/lib/card-image-sources';
import {
  compareBrowseCards,
  inferCardFinish,
  normalizeLocalId,
  parseCardSearchQuery,
  type SearchCardResult,
} from '@/lib/pokemon-card-browse';
import {
  buildIllustratorDirectory,
  cleanIllustratorName,
  type IllustratorCard,
  type IllustratorSummary,
} from '@/lib/illustrators';

export type MirrorLanguage = 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt-br' | 'ja' | 'ko';

export interface MirroredTCGCard extends CardCatalogIdentity {
  id: string;
  localId: string;
  name: string;
  image?: string;
  /** Languages this printing exists in (from its TCGdex names). */
  languages?: CardLanguage[];
  set: {
    id: string;
    name: string;
    officialCardCount?: number;
    releaseDate?: string;
  };
  rarity?: string;
  variants?: {
    normal?: boolean;
    reverse?: boolean;
    holo?: boolean;
    firstEdition?: boolean;
    wPromo?: boolean;
    jumbo?: boolean;
  };
  hp?: number;
  types?: string[];
  illustrator?: string;
}

type MirroredCardQueryResult = MirroredTCGCard | null;

const MIRRORED_CARD_SELECT = `
  dex_id,
  tcg_cards!inner(
    id,
    series_id,
    set_id,
    local_id,
    name_json,
    rarity,
    hp,
    illustrator,
    types_json,
    image_languages_json,
    external_ids_json,
    variants_json,
    tcg_sets!inner(
      id,
      name_json,
      official_card_count,
      release_date
    )
  )
`;

const MIRROR_CACHE_LIFE = 'days';
const HIDDEN_SET_IDS = new Set(['jumbo']);
/** A set query ("30th", "abra 151") returns the whole set; the largest (Cosmic Eclipse) has 272 cards. */
// ponytail: one row cap shared by up to 4 matched sets; page it if several large sets must show in full.
const SET_BROWSE_LIMIT = 400;
const MIRROR_CACHE_VERSION = 'v6-card-languages';

function cacheSafeTag(prefix: string, value: string | number) {
  return `${prefix}:${String(value)
    .replace(/[^a-zA-Z0-9:_-]/g, '_')
    .slice(0, 180)}`;
}

function buildCardImageUrl(language: string, seriesId: string, setId: string, localId: string) {
  return buildTcgdexAssetImageUrl(language, seriesId, setId, localId);
}

export { pickExternalCardImageUrl };

function compareLocalIds(a: MirroredTCGCard, b: MirroredTCGCard) {
  const aNumeric = Number.parseInt(a.localId.replace(/\D+/g, ''), 10);
  const bNumeric = Number.parseInt(b.localId.replace(/\D+/g, ''), 10);

  if (Number.isFinite(aNumeric) && Number.isFinite(bNumeric) && aNumeric !== bNumeric) {
    return aNumeric - bNumeric;
  }

  if (a.set.id !== b.set.id) {
    return a.set.id.localeCompare(b.set.id);
  }

  return a.localId.localeCompare(b.localId);
}

export async function getMirroredCardsForPokemon(pokemonId: number, language: MirrorLanguage = 'en') {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION, cacheSafeTag('pokemon', pokemonId), cacheSafeTag('language', language));

  const admin = createAdminClient();
  const { data, error } = await admin.from('tcg_card_dex_ids').select(MIRRORED_CARD_SELECT).eq('dex_id', pokemonId);

  if (error) {
    throw error;
  }

  const cards = deduplicateCatalogCards(
    ((data || []) as any[]).flatMap((row) => (row.tcg_cards ? [row.tcg_cards] : [])),
  )
    .map((card): MirroredCardQueryResult => {
      const set = card?.tcg_sets;

      if (!card?.id || !card?.local_id || !card?.set_id || !card?.series_id || !set?.id) {
        return null;
      }
      if (HIDDEN_SET_IDS.has(card.set_id)) {
        return null;
      }

      const imageLanguage = pickImageLanguage(card.image_languages_json, language);
      const image = pickCardImageUrl(
        card.external_ids_json,
        imageLanguage,
        imageLanguage && buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id),
        language,
      );

      return {
        id: card.id,
        canonicalId: readCatalogMetadata(card.external_ids_json).canonicalId,
        aliasIds: readCatalogMetadata(card.external_ids_json).aliasIds,
        localId: readCatalogMetadata(card.external_ids_json).localId ?? card.local_id,
        name: pickLocalizedText(card.name_json, language) || `Pokemon #${pokemonId}`,
        image,
        languages: cardLanguagesFromNames(card.name_json),
        set: {
          id: set.id,
          name: pickLocalizedText(set.name_json, language) || set.id,
          officialCardCount: typeof set.official_card_count === 'number' ? set.official_card_count : undefined,
          releaseDate: typeof set.release_date === 'string' ? set.release_date : undefined,
        },
        rarity: typeof card.rarity === 'string' ? card.rarity : undefined,
        variants: card.variants_json && typeof card.variants_json === 'object' ? card.variants_json : undefined,
        hp: typeof card.hp === 'number' ? card.hp : undefined,
        types: Array.isArray(card.types_json)
          ? card.types_json.filter((value: unknown): value is string => typeof value === 'string')
          : undefined,
        illustrator: typeof card.illustrator === 'string' ? card.illustrator : undefined,
      } satisfies MirroredTCGCard;
    })
    .filter((card): card is MirroredTCGCard => Boolean(card))
    .sort(compareLocalIds);

  return cards;
}

export async function searchMirroredSets(
  query: string,
  limit = 8,
  language: MirrorLanguage = 'en',
): Promise<TCGSetSummary[]> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);

  const admin = createAdminClient();
  const trimmedQuery = query
    .replace(/[,%()]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const setCode = resolveSetSearchAlias(trimmedQuery);
  cacheTag(
    'tcg-mirror',
    MIRROR_CACHE_VERSION,
    'tcg-sets',
    cacheSafeTag('set-query', trimmedQuery),
    cacheSafeTag('limit', limit),
    cacheSafeTag('language', language),
  );

  if (isSetYearQuery(trimmedQuery))
    return rankSetMatches(
      (await getBrowsableMirroredSets()).filter((set) => language !== 'en' || isSetInLanguage(set, 'en')),
      trimmedQuery,
      Infinity,
    );

  if (trimmedQuery.length < 2) {
    return [];
  }

  const { data, error } = await printedInEnglish(
    admin.from('tcg_sets').select(
      `
      id,
      name_json,
      name_en,
      official_card_count,
      release_date,
      tcg_series!inner(
        id,
        name_json,
        name_en
      )
    `,
    ),
    language,
  )
    .or(
      `id.ilike.%${trimmedQuery}%,name_en.ilike.%${trimmedQuery}%${setCode === trimmedQuery ? '' : `,id.eq.${setCode}`}`,
    )
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return ((data || []) as any[]).flatMap((set) =>
    HIDDEN_SET_IDS.has(set.id)
      ? []
      : [
          {
            id: set.id,
            ...getSetArtwork(set.id),
            name: pickLocalizedText(set.name_json, 'en') || set.name_en || set.id,
            seriesName: pickLocalizedText(set.tcg_series?.name_json, 'en') || set.tcg_series?.name_en || undefined,
            officialCardCount: typeof set.official_card_count === 'number' ? set.official_card_count : undefined,
            releaseDate: typeof set.release_date === 'string' ? set.release_date : undefined,
          },
        ],
  );
}

export async function getRecentMirroredSets(asOfDate: string, limit = 6): Promise<TCGSetSummary[]> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag(
    'tcg-mirror',
    MIRROR_CACHE_VERSION,
    'tcg-sets',
    'recent-sets',
    cacheSafeTag('as-of', asOfDate),
    cacheSafeTag('limit', limit),
  );

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('tcg_sets')
    .select(
      `
      id,
      name_json,
      name_en,
      official_card_count,
      release_date,
      tcg_series!inner(
        id,
        name_json,
        name_en
      )
    `,
    )
    .not('release_date', 'is', null)
    .lte('release_date', asOfDate)
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(Math.max(limit * 4, 24));

  if (error) {
    throw error;
  }

  const sets = ((data || []) as any[]).flatMap((set) =>
    HIDDEN_SET_IDS.has(set.id)
      ? []
      : [
          {
            id: set.id,
            name: pickLocalizedText(set.name_json, 'en') || set.name_en || set.id,
            seriesName: pickLocalizedText(set.tcg_series?.name_json, 'en') || set.tcg_series?.name_en || undefined,
            officialCardCount: typeof set.official_card_count === 'number' ? set.official_card_count : undefined,
            releaseDate: typeof set.release_date === 'string' ? set.release_date : undefined,
          },
        ],
  );

  return selectRecentSetSummaries(sets, { asOfDate, limit });
}

/** Every mirrored set with its symbol and logo, for the Sets browse grid (a few hundred rows). */
export async function getBrowsableMirroredSets(): Promise<TCGSetSummary[]> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION, 'tcg-sets', 'browse-sets');

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('tcg_sets')
    .select(
      `
      id,
      name_json,
      name_en,
      official_card_count,
      release_date,
      tcg_series!inner(
        id,
        name_json,
        name_en
      )
    `,
    )
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(1000);

  if (error) {
    throw error;
  }

  type BrowseSetRow = {
    id: string;
    name_json: unknown;
    name_en: string | null;
    official_card_count: unknown;
    release_date: unknown;
    tcg_series: { name_json: unknown; name_en: string | null } | null;
  };
  return ((data || []) as unknown as BrowseSetRow[]).flatMap((set): TCGSetSummary[] =>
    HIDDEN_SET_IDS.has(set.id)
      ? []
      : [
          {
            id: set.id,
            name: pickLocalizedText(set.name_json, 'en') || set.name_en || set.id,
            seriesName: pickLocalizedText(set.tcg_series?.name_json, 'en') || set.tcg_series?.name_en || undefined,
            officialCardCount: typeof set.official_card_count === 'number' ? set.official_card_count : undefined,
            releaseDate: typeof set.release_date === 'string' ? set.release_date : undefined,
            ...(set.name_json && typeof set.name_json === 'object' ? { languages: Object.keys(set.name_json) } : {}),
            ...getSetArtwork(set.id),
          },
        ],
  );
}

export async function readSetCardPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await fetchPage(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export async function getMirroredSetDexSlots(
  setId: string,
  language: MirrorLanguage = 'en',
  pokemonNames = new Map<number, string>(),
  includeHidden = false,
): Promise<{ selectedSet: TCGSetSummary | null; slots: TCGSetDexSlot[]; cards: TCGSetSlotCard[] }> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION, cacheSafeTag('set', setId), cacheSafeTag('language', language));

  if (!includeHidden && HIDDEN_SET_IDS.has(setId)) {
    return { selectedSet: null, slots: [], cards: [] };
  }

  const admin = createAdminClient();

  const data = await readSetCardPages((from, to) =>
    admin
      .from('tcg_cards')
      .select(
        `
      id,
      series_id,
      set_id,
      local_id,
      local_id_sort,
      name_json,
      name_en,
      rarity,
      image_languages_json,
      external_ids_json,
      variants_json,
      tcg_sets!inner(
        id,
        name_json,
        name_en,
        official_card_count,
        release_date,
        tcg_series!inner(
          id,
          name_json,
          name_en
        )
      ),
      tcg_card_dex_ids(
        dex_id
      )
    `,
      )
      .eq('set_id', setId)
      .order('local_id_sort', { ascending: true, nullsFirst: false })
      .order('id')
      .range(from, to),
  );

  const rows = deduplicateCatalogCards((data || []) as any[]);
  const firstSet = rows[0]?.tcg_sets;
  const selectedSet: TCGSetSummary | null = firstSet?.id
    ? {
        id: firstSet.id,
        name: pickLocalizedText(firstSet.name_json, language) || firstSet.name_en || firstSet.id,
        seriesName:
          pickLocalizedText(firstSet.tcg_series?.name_json, language) || firstSet.tcg_series?.name_en || undefined,
        officialCardCount: typeof firstSet.official_card_count === 'number' ? firstSet.official_card_count : undefined,
        releaseDate: typeof firstSet.release_date === 'string' ? firstSet.release_date : undefined,
      }
    : null;
  const slotMap = new Map<number, TCGSetDexSlot>();
  const cards: TCGSetSlotCard[] = [];

  for (const card of rows) {
    const dexLinks = Array.isArray(card.tcg_card_dex_ids) ? card.tcg_card_dex_ids : [];
    const set = card?.tcg_sets;
    if (!card?.id || !card?.local_id || !card?.series_id || !card?.set_id || !set?.id) {
      continue;
    }

    const imageLanguage = pickImageLanguage(card.image_languages_json, language);
    const image = pickCardImageUrl(
      card.external_ids_json,
      imageLanguage,
      imageLanguage && buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id),
      language,
    );
    const setSummary: TCGSetSummary = {
      id: set.id,
      name: pickLocalizedText(set.name_json, language) || set.name_en || set.id,
      seriesName: pickLocalizedText(set.tcg_series?.name_json, language) || set.tcg_series?.name_en || undefined,
      officialCardCount: typeof set.official_card_count === 'number' ? set.official_card_count : undefined,
      releaseDate: typeof set.release_date === 'string' ? set.release_date : undefined,
    };
    const slotCard: TCGSetSlotCard = {
      id: card.id,
      canonicalId: readCatalogMetadata(card.external_ids_json).canonicalId,
      aliasIds: readCatalogMetadata(card.external_ids_json).aliasIds,
      localId: readCatalogMetadata(card.external_ids_json).localId ?? card.local_id,
      name: pickLocalizedText(card.name_json, language) || card.name_en || card.id,
      image,
      language,
      languageConfirmed: typeof card.name_json?.[language] === 'string' && card.name_json[language].trim().length > 0,
      set: setSummary,
      rarity: typeof card.rarity === 'string' ? card.rarity : undefined,
      variants: card.variants_json && typeof card.variants_json === 'object' ? card.variants_json : undefined,
      inferredFinish: inferCardFinish(card.rarity, card.variants_json),
    };

    cards.push(slotCard);

    for (const link of dexLinks) {
      const dexId = typeof link?.dex_id === 'number' ? link.dex_id : null;
      if (!dexId) {
        continue;
      }

      const entry: TCGSetDexSlot = slotMap.get(dexId) ?? {
        dexId,
        pokemonName: pokemonNames.get(dexId) || `Pokemon #${dexId}`,
        cards: [],
      };
      entry.cards.push(slotCard);
      slotMap.set(dexId, entry);
    }
  }

  return {
    selectedSet,
    cards,
    slots: Array.from(slotMap.values()).sort((left, right) => left.dexId - right.dexId),
  };
}

const CARD_SEARCH_SELECT = `
  id,
  series_id,
  set_id,
  local_id,
  name_json,
  name_en,
  rarity,
  image_languages_json,
  external_ids_json,
  variants_json,
  illustrator,
  tcg_sets!inner(
    id,
    name_json,
    name_en,
    official_card_count,
    release_date
  ),
  tcg_card_dex_ids!inner(
    dex_id
  )
`;

export function cardSearchSelect(includeNonPokemon = false) {
  return includeNonPokemon
    ? CARD_SEARCH_SELECT.replace('tcg_card_dex_ids!inner(', 'tcg_card_dex_ids(')
    : CARD_SEARCH_SELECT;
}

export function toSearchCardResult(
  card: any,
  language: MirrorLanguage,
  includeNonPokemon = false,
): SearchCardResult | null {
  const set = card?.tcg_sets;
  if (
    !card?.id ||
    !card?.local_id ||
    !card?.set_id ||
    !card?.series_id ||
    !set?.id ||
    HIDDEN_SET_IDS.has(card.set_id)
  ) {
    return null;
  }
  const dexIds = (Array.isArray(card.tcg_card_dex_ids) ? card.tcg_card_dex_ids : [])
    .map((link: any) => (typeof link?.dex_id === 'number' ? link.dex_id : null))
    .filter((dexId: number | null): dexId is number => Boolean(dexId));
  if (!includeNonPokemon && dexIds.length === 0) return null;

  const confirmedLanguage =
    (typeof card.name_json?.[language] === 'string' && card.name_json[language].trim().length > 0) ||
    (Array.isArray(card.image_languages_json) && card.image_languages_json.includes(language));
  const imageLanguage = pickImageLanguage(card.image_languages_json, language);
  return {
    id: card.id,
    canonicalId: readCatalogMetadata(card.external_ids_json).canonicalId,
    aliasIds: readCatalogMetadata(card.external_ids_json).aliasIds,
    localId: readCatalogMetadata(card.external_ids_json).localId ?? card.local_id,
    name: pickLocalizedText(card.name_json, language) || card.name_en || card.id,
    image: pickCardImageUrl(
      card.external_ids_json,
      imageLanguage,
      imageLanguage && buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id),
      language,
    ),
    language: !includeNonPokemon || confirmedLanguage ? language : undefined,
    set: {
      id: set.id,
      name: pickLocalizedText(set.name_json, language) || set.name_en || set.id,
      officialCardCount: typeof set.official_card_count === 'number' ? set.official_card_count : undefined,
      releaseDate: typeof set.release_date === 'string' ? set.release_date : undefined,
    },
    rarity: typeof card.rarity === 'string' ? card.rarity : undefined,
    variants:
      card.variants_json && typeof card.variants_json === 'object'
        ? (card.variants_json as Record<string, boolean>)
        : undefined,
    illustrator: typeof card.illustrator === 'string' && card.illustrator.trim() ? card.illustrator.trim() : undefined,
    dexIds,
  };
}

/**
 * An English search only matches sets printed in English, so a Japanese "30th CELEBRATION" can't take its place.
 * Other languages price English prints too, so they keep every set.
 */
function printedInEnglish<T extends { not: (column: string, operator: string, value: null) => T }>(
  query: T,
  language: MirrorLanguage | 'any',
) {
  return language === 'en' ? query.not('name_json->>en', 'is', null) : query;
}

function localIdCandidates(number: string) {
  const normalized = normalizeLocalId(number);
  const digits = /^(\d+)([a-z]?)$/.exec(normalized);
  if (!digits) return [number];
  const [, value, suffix] = digits;
  // Sets store local ids with varying zero padding ("4", "04", "004").
  return Array.from(
    new Set([value, value.padStart(2, '0'), value.padStart(3, '0')].map((candidate) => `${candidate}${suffix}`)),
  );
}

/** Exact, bounded identity lookup for import. No fuzzy search or language fallback. */
export async function findMirroredImportCandidates(lookup: ImportLookup): Promise<SearchCardResult[]> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION);
  const admin = createAdminClient();
  const escaped = (value: string) => value.replace(/[\\%_]/g, '\\$&');
  let query = admin.from('tcg_cards').select(CARD_SEARCH_SELECT).not(`name_json->>${lookup.language}`, 'is', null);
  if (lookup.cardId) {
    const direct = await query.eq('id', lookup.cardId).limit(101);
    if (direct.error) throw direct.error;
    if (direct.data?.length)
      return direct.data
        .map((card) => toSearchCardResult(card, lookup.language))
        .filter((card): card is SearchCardResult => Boolean(card));
    query = admin
      .from('tcg_cards')
      .select(CARD_SEARCH_SELECT)
      .not(`name_json->>${lookup.language}`, 'is', null)
      .contains('external_ids_json->catalog->aliasIds', JSON.stringify([lookup.cardId]));
  } else if (lookup.tcgplayerId) {
    // readImportLookups restricts the filter value to digits.
    if (!/^\d{1,12}$/.test(lookup.tcgplayerId)) return [];
    query = query.or(
      `external_ids_json->catalog->>productId.eq.${lookup.tcgplayerId},external_ids_json->tcgdex->thirdParty->>tcgplayer.eq.${lookup.tcgplayerId}`,
    );
  } else {
    if (!lookup.cardName || !lookup.set || !lookup.number) return [];
    const direct = await admin.from('tcg_sets').select('id').eq('id', lookup.set).limit(2);
    if (direct.error) throw direct.error;
    const sets = direct.data?.length
      ? direct
      : await admin.from('tcg_sets').select('id').ilike(`name_json->>${lookup.language}`, escaped(lookup.set)).limit(2);
    if (sets.error) throw sets.error;
    if (sets.data?.length !== 1) return [];
    query = query.eq('set_id', sets.data[0].id).ilike(`name_json->>${lookup.language}`, escaped(lookup.cardName));
  }
  const { data, error } = await query.limit(101);
  if (error) throw error;
  // A truncated result must never look like a unique match.
  if (!data || data.length > 100) return [];
  return data
    .map((card) => toSearchCardResult(card, lookup.language))
    .filter((card): card is SearchCardResult => Boolean(card));
}

/** Cards by TCGdex id (picture scan candidates), in `language`. Unknown or hidden ids are left out. */
export async function getMirroredCardsByIds(ids: readonly string[], language: MirrorLanguage = 'en') {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION);
  if (!ids.length) return [];
  const { data, error } = await createAdminClient()
    .from('tcg_cards')
    .select(cardSearchSelect(true))
    .in('id', [...ids]);
  if (error) throw error;
  const cards = new Map(
    (data ?? []).flatMap((row) => {
      const card = toSearchCardResult(row, language, true);
      return card ? [[card.id, card] as const] : [];
    }),
  );
  return ids.flatMap((id) => cards.get(id) ?? []);
}

const SUGGESTION_CANDIDATE_LIMIT = 150;
type SuggestionRow = {
  id: string;
  set_id: string;
  illustrator?: unknown;
  types_json?: unknown;
  tcg_card_dex_ids?: unknown;
};
const suggestionTraits = (row: SuggestionRow): SuggestionTraits => ({
  id: row.id,
  setId: row.set_id,
  illustrator: typeof row.illustrator === 'string' && row.illustrator.trim() ? row.illustrator.trim() : undefined,
  types: Array.isArray(row.types_json) ? row.types_json.filter((t): t is string => typeof t === 'string') : [],
  dexIds: (Array.isArray(row.tcg_card_dex_ids) ? (row.tcg_card_dex_ids as Array<{ dex_id?: unknown }>) : []).flatMap(
    (link) => (typeof link?.dex_id === 'number' ? [link.dex_id] : []),
  ),
});

/**
 * Cards like the ones on a binder page: the same Pokémon, illustrator or set, ranked by `rankPageSuggestions` (energy
 * type only reorders). `cardIds` and `pokemonIds` are what the page holds.
 */
export async function suggestMirroredCards(
  cardIds: readonly string[],
  pokemonIds: readonly number[],
  language: MirrorLanguage = 'en',
): Promise<SearchCardResult[]> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION);
  const admin = createAdminClient();
  const seedRows = cardIds.length
    ? await admin
        .from('tcg_cards')
        .select('id,set_id,illustrator,types_json,tcg_card_dex_ids(dex_id)')
        .in('id', [...cardIds])
    : { data: [], error: null };
  if (seedRows.error) throw seedRows.error;
  const seeds = (seedRows.data ?? []).map(suggestionTraits);
  const dexIds = [...new Set([...pokemonIds, ...seeds.flatMap((s) => s.dexIds)])];
  const illustrators = [...new Set(seeds.flatMap((s) => s.illustrator ?? []))];
  const setIds = [...new Set(seeds.map((s) => s.setId))];
  // Ids first (cheap, indexed), then one full fetch: filtering the full select by an embedded dex id times out.
  const idLists = await Promise.all([
    dexIds.length
      ? admin.from('tcg_card_dex_ids').select('id:card_id').in('dex_id', dexIds).limit(SUGGESTION_CANDIDATE_LIMIT)
      : null,
    illustrators.length
      ? admin.from('tcg_cards').select('id').in('illustrator', illustrators).limit(SUGGESTION_CANDIDATE_LIMIT)
      : null,
    setIds.length ? admin.from('tcg_cards').select('id').in('set_id', setIds).limit(SUGGESTION_CANDIDATE_LIMIT) : null,
  ]);
  const ids = new Set<string>();
  for (const list of idLists) {
    if (list?.error) throw list.error;
    for (const row of list?.data ?? []) ids.add(row.id);
  }
  if (!ids.size) return [];
  const { data, error } = await printedInEnglish(
    admin.from('tcg_cards').select(`${cardSearchSelect(true)}, types_json`),
    language,
  ).in('id', [...ids]);
  if (error) throw error;
  const candidates = (data ?? []).flatMap((row) => {
    const card = toSearchCardResult(row, language, true);
    return card ? [{ ...suggestionTraits(row as unknown as SuggestionRow), card }] : [];
  });
  return rankPageSuggestions(seeds, pokemonIds, candidates).map(({ card }) => card);
}

/**
 * Card search across the mirror: card name, card number ("bulbasaur 44/102"), set name/id
 * ("pitch black", "me05 12"), illustrator ("arita") or a TCGdex card id ("base1-44"). Defaults to cards that feature a Pokémon; explicit-slot catalog mode also includes non-Pokémon cards.
 */
export async function searchMirroredCards(
  query: string,
  language: CardSearchLanguage = 'en',
  limit = 60,
  includeNonPokemon = false,
): Promise<{ cards: SearchCardResult[]; correction: string | null }> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);

  // "zard", "mr mime": search for the name as printed.
  const expanded = expandSearchAliases(query);
  if (expanded !== query.trim()) return searchMirroredCards(expanded, language, limit, includeNonPokemon);

  // "charizard sir": the search without the rarity word, kept to that rarity.
  const rarity = matchRarityWords(query);
  if (rarity) {
    const result = await searchMirroredCards(rarity.rest, language, limit, includeNonPokemon);
    return { cards: result.cards.filter((card) => hasRarity(card, rarity.rarities)), correction: null };
  }

  let parsed = { ...parseCardSearchQuery(query), setIds: [] as string[] };
  cacheTag(
    'tcg-mirror',
    MIRROR_CACHE_VERSION,
    'tcg-card-search',
    cacheSafeTag('card-query', `${parsed.text}|${parsed.number ?? ''}|${parsed.cardId ?? ''}`),
    cacheSafeTag('language', language),
  );

  if (parsed.text.length < 2 && !parsed.cardId) {
    return { cards: [], correction: null };
  }

  const admin = createAdminClient();
  const select = cardSearchSelect(includeNonPokemon);
  let correction: string | null = null;
  const candidates = [
    ...new Set(
      cardSearchSetCandidates(query).flatMap(({ phrase }) =>
        !phrase.includes(' ') && phrase.length >= 2 ? [phrase] : [],
      ),
    ),
  ];
  if (candidates.length) {
    const catalog = await printedInEnglish(admin.from('tcg_sets').select('id,name_en'), language)
      .or(
        candidates
          .flatMap((phrase) => [`id.ilike.${JSON.stringify(phrase)}`, `name_en.ilike.${JSON.stringify(`%${phrase}%`)}`])
          .join(','),
      )
      .limit(1000);
    if (catalog.error) throw catalog.error;
    const sets = (catalog.data ?? []).flatMap((set) =>
      HIDDEN_SET_IDS.has(set.id) ? [] : [{ id: set.id, name: set.name_en ?? '' }],
    );
    parsed = resolveCardSearchQuery(query, sets);
    correction = correctedCardSearchQuery(query, sets);
  }
  const numberCandidates = parsed.number ? localIdCandidates(parsed.number) : null;
  const requests: Array<PromiseLike<{ data: any[] | null; error: unknown }>> = [];

  // Nicknames ("moonbreon", "gold star rayquaza") go first, so the cards they name lead the results.
  const nickname = matchCardNicknames(query);
  for (let start = 0; nickname && start < nickname.ids.length; start += NICKNAME_ID_CHUNK) {
    const ids = nickname.ids.slice(start, start + NICKNAME_ID_CHUNK);
    requests.push(
      admin
        .from('tcg_cards')
        .select(select)
        .in('id', ids)
        .then(({ data, error }) => {
          const rows = data as unknown as Array<{ name_en?: string | null }> | null;
          return { error, data: rows?.filter((row) => matchesNicknameRest(row.name_en ?? '', nickname.rest)) ?? null };
        }),
    );
  }

  if (parsed.cardId) {
    requests.push(admin.from('tcg_cards').select(select).ilike('id', parsed.cardId).limit(5));
  }

  if (parsed.setIds.length) {
    let bySet = admin.from('tcg_cards').select(select).in('set_id', parsed.setIds);
    if (parsed.text) bySet = bySet.ilike('name_en', `%${parsed.text}%`);
    if (numberCandidates) bySet = bySet.in('local_id', numberCandidates);
    requests.push(bySet.order('local_id_sort', { ascending: true, nullsFirst: false }).limit(SET_BROWSE_LIMIT));
  } else if (parsed.text.length >= 2) {
    let byName = admin.from('tcg_cards').select(select).or(cardNameSearchFilter(parsed.text));
    if (numberCandidates) byName = byName.in('local_id', numberCandidates);
    requests.push(byName.limit(limit));

    // Japanese and Korean printings keep their own name in `name_en`, so outside English a Pokémon's name also finds
    // every printing linked to it.
    const pokemon =
      language !== 'en'
        ? POKEMON_CATALOG.find(
            (entry) => entry.name === parsed.text || formatPokemonDisplayName(entry.name).toLowerCase() === parsed.text,
          )
        : undefined;
    if (pokemon) {
      let byPokemon = admin.from('tcg_cards').select(CARD_SEARCH_SELECT).eq('tcg_card_dex_ids.dex_id', pokemon.id);
      if (numberCandidates) byPokemon = byPokemon.in('local_id', numberCandidates);
      requests.push(byPokemon.limit(limit));
    }

    // Illustrator ("arita", "5ban"): newest first, so a dealer's recent cards show up.
    if (parsed.text.length >= 3) {
      let byIllustrator = admin.from('tcg_cards').select(select).ilike('illustrator', `%${parsed.text}%`);
      if (numberCandidates) byIllustrator = byIllustrator.in('local_id', numberCandidates);
      requests.push(byIllustrator.limit(limit));
    }

    // The set lookup and the card query that depends on it run alongside the name query
    // instead of before it.
    requests.push(
      (async () => {
        const setMatches = await printedInEnglish(admin.from('tcg_sets').select('id'), language)
          .or(`id.ilike.${parsed.text},id.ilike.${resolveSetSearchAlias(parsed.text)},name_en.ilike.%${parsed.text}%`)
          .order('release_date', { ascending: false, nullsFirst: false })
          .limit(4);
        if (setMatches.error) return { data: null, error: setMatches.error };
        const setIds = ((setMatches.data || []) as Array<{ id: string }>).flatMap(({ id }) =>
          HIDDEN_SET_IDS.has(id) ? [] : [id],
        );
        if (setIds.length === 0) return { data: [], error: null };
        let bySet = admin.from('tcg_cards').select(select).in('set_id', setIds);
        if (numberCandidates) bySet = bySet.in('local_id', numberCandidates);
        return await bySet.order('local_id_sort', { ascending: true, nullsFirst: false }).limit(SET_BROWSE_LIMIT);
      })(),
    );
  }

  const responses = await Promise.all(requests);
  // A word that partly names a set can also be part of a card name: "dark charizard" is Charizard in Darkness Ablaze
  // and Dark Charizard, "mario pikachu" finds nothing in the Detective Pikachu set but is Mario Pikachu.
  const literal = parseCardSearchQuery(query);
  if (parsed.setIds.length && !literal.number && literal.text.length >= 2)
    responses.push(await admin.from('tcg_cards').select(select).or(cardNameSearchFilter(literal.text)).limit(limit));
  const results = new Map<string, SearchCardResult>();
  for (const response of responses) {
    if (response.error) throw response.error;
  }
  for (const row of deduplicateCatalogCards(responses.flatMap((response) => response.data || []))) {
    // A card printed only in another language (an imported Japanese promo found by its English name) keeps that
    // language; English printings stand in for the other languages, as before.
    const printedIn = (code: string) => Boolean(row.name_json?.[code]?.trim?.());
    const rowLanguage =
      language === 'any' || (!printedIn(language) && !printedIn('en') && primaryCardLanguage(row.name_json))
        ? (primaryCardLanguage(row.name_json) ?? 'en')
        : language;
    const card = toSearchCardResult(row, rowLanguage, includeNonPokemon);
    if (card && !results.has(card.id)) results.set(card.id, card);
  }

  const cards = Array.from(results.values());
  if (!cards.length && correction) {
    const retry = await searchMirroredCards(correction, language, limit, includeNonPokemon);
    return { cards: retry.cards, correction: retry.cards.length ? correction : null };
  }
  return { cards, correction: null };
}

/** Ids per nickname query, so a group nickname ("shiny vault") keeps the request URL short. */
const NICKNAME_ID_CHUNK = 150;
const ILLUSTRATOR_DIRECTORY_FUNCTION = 'tcg_illustrator_directory';
const SIMILAR_CARDS_FUNCTION = 'similar_tcg_cards';
const MIRROR_PAGE_SIZE = 1000;
const MAX_ILLUSTRATOR_DIRECTORY_PAGES = 60;
const MAX_ILLUSTRATOR_CARDS = 3000;

function isMissingFunctionError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(message);
}

/**
 * Every illustrator in the mirror with their card count. Uses the `tcg_illustrator_directory()` function
 * (migration 030); until that is applied it pages through `tcg_cards.illustrator` instead.
 */
export async function getMirroredIllustratorDirectory(): Promise<IllustratorSummary[]> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION, 'tcg-illustrators');

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(ILLUSTRATOR_DIRECTORY_FUNCTION);
  if (!error) {
    return buildIllustratorDirectory(
      ((data || []) as Array<{ illustrator?: unknown; card_count?: unknown }>).map((row) => ({
        name: row.illustrator,
        count: typeof row.card_count === 'number' ? row.card_count : Number(row.card_count),
      })),
    );
  }
  if (!isMissingFunctionError(error)) throw error;

  const names: Array<{ name: unknown }> = [];
  for (let page = 0; page < MAX_ILLUSTRATOR_DIRECTORY_PAGES; page += 1) {
    const from = page * MIRROR_PAGE_SIZE;
    const { data: rows, error: pageError } = await admin
      .from('tcg_cards')
      .select('illustrator')
      .not('illustrator', 'is', null)
      .not('set_id', 'in', `(${[...HIDDEN_SET_IDS].join(',')})`)
      .order('id', { ascending: true })
      .range(from, from + MIRROR_PAGE_SIZE - 1);
    if (pageError) throw pageError;
    for (const row of (rows || []) as Array<{ illustrator?: unknown }>) names.push({ name: row.illustrator });
    if (!rows || rows.length < MIRROR_PAGE_SIZE) break;
  }
  return buildIllustratorDirectory(names);
}

const ILLUSTRATOR_CARD_SELECT = `
  id,
  series_id,
  set_id,
  local_id,
  name_json,
  name_en,
  rarity,
  illustrator,
  image_languages_json,
  external_ids_json,
  variants_json,
  tcg_sets!inner(
    id,
    name_json,
    name_en,
    official_card_count,
    release_date
  ),
  tcg_card_dex_ids(
    dex_id
  )
`;

type IllustratorCardRow = {
  id: string;
  series_id?: string | null;
  set_id?: string | null;
  local_id?: string | null;
  name_json?: unknown;
  name_en?: string | null;
  rarity?: unknown;
  illustrator?: unknown;
  image_languages_json?: unknown;
  external_ids_json?: unknown;
  variants_json?: unknown;
  tcg_sets?: {
    id?: string;
    name_json?: unknown;
    name_en?: string | null;
    official_card_count?: unknown;
    release_date?: unknown;
  } | null;
  tcg_card_dex_ids?: Array<{ dex_id?: unknown }> | null;
};

function toIllustratorCard(card: IllustratorCardRow, language: MirrorLanguage): IllustratorCard | null {
  const set = card?.tcg_sets;
  if (!card?.id || !card.local_id || !card.set_id || !card.series_id || !set?.id || HIDDEN_SET_IDS.has(card.set_id)) {
    return null;
  }
  const dexIds = (Array.isArray(card.tcg_card_dex_ids) ? card.tcg_card_dex_ids : [])
    .map((link) => (typeof link?.dex_id === 'number' ? link.dex_id : null))
    .filter((dexId): dexId is number => Boolean(dexId));
  const imageLanguage = pickImageLanguage(card.image_languages_json, language);
  const metadata = readCatalogMetadata(card.external_ids_json);
  return {
    id: card.id,
    canonicalId: metadata.canonicalId,
    aliasIds: metadata.aliasIds,
    localId: metadata.localId ?? card.local_id,
    name: pickLocalizedText(card.name_json, language) || card.name_en || card.id,
    image: pickCardImageUrl(
      card.external_ids_json,
      imageLanguage,
      imageLanguage && buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id),
      language,
    ),
    language,
    set: {
      id: set.id,
      name: pickLocalizedText(set.name_json, language) || set.name_en || set.id,
      officialCardCount: typeof set.official_card_count === 'number' ? set.official_card_count : undefined,
      releaseDate: typeof set.release_date === 'string' ? set.release_date : undefined,
    },
    rarity: typeof card.rarity === 'string' ? card.rarity : undefined,
    variants:
      card.variants_json && typeof card.variants_json === 'object'
        ? (card.variants_json as Record<string, boolean>)
        : undefined,
    dexIds,
    illustrator: typeof card.illustrator === 'string' ? card.illustrator : undefined,
  };
}

/** Every mirrored card credited to one illustrator (exact name, as listed in the directory), across all sets. */
export async function getMirroredCardsByIllustrator(
  name: string,
  language: MirrorLanguage = 'en',
): Promise<IllustratorCard[]> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  const illustrator = cleanIllustratorName(name);
  cacheTag(
    'tcg-mirror',
    MIRROR_CACHE_VERSION,
    'tcg-illustrators',
    cacheSafeTag('illustrator', illustrator.toLowerCase()),
    cacheSafeTag('language', language),
  );
  if (!illustrator) return [];

  const admin = createAdminClient();
  const rows: IllustratorCardRow[] = [];
  for (let from = 0; from < MAX_ILLUSTRATOR_CARDS; from += MIRROR_PAGE_SIZE) {
    const { data, error } = await admin
      .from('tcg_cards')
      .select(ILLUSTRATOR_CARD_SELECT)
      .eq('illustrator', illustrator)
      .order('id', { ascending: true })
      .range(from, from + MIRROR_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data || []) as unknown as IllustratorCardRow[]));
    if (!data || data.length < MIRROR_PAGE_SIZE) break;
  }

  return deduplicateCatalogCards(rows)
    .map((row) => toIllustratorCard(row, language))
    .filter((card): card is IllustratorCard => Boolean(card))
    .sort(compareBrowseCards);
}

/**
 * The nearest neighbours of a card's picture, split into other printings of the same artwork and cards with a
 * similar look (lib/similar-cards.ts). Reads the `similar_tcg_cards` function (migration 116) for the card's print in
 * `language`, falling back to its English print. Empty when the card has no fingerprint yet.
 */
export async function getSimilarCardNeighbours(cardId: string, language: CardLanguage = 'en') {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION, cacheSafeTag('similar', cardId), cacheSafeTag('language', language));

  const admin = createAdminClient();
  const readNeighbours = async (lang: string) => {
    const { data, error } = await admin.rpc(SIMILAR_CARDS_FUNCTION, {
      p_card_id: cardId,
      p_lang: lang,
      p_model: EMBEDDING_MODEL,
      p_limit: SIMILAR_NEIGHBOUR_LIMIT,
    });
    if (error) throw error;
    return normalizeSimilarNeighbours(data);
  };
  let neighbours = await readNeighbours(language);
  if (!neighbours.length && language !== 'en') neighbours = await readNeighbours('en');
  if (!neighbours.length) return { sameArtwork: [], similarLook: [] };
  const { data, error } = await admin
    .from('tcg_cards')
    .select('id,name_json,category,illustrator,tcg_card_dex_ids(dex_id)')
    .in('id', [...new Set([cardId, ...neighbours.map((neighbour) => neighbour.cardId)])]);
  if (error) throw error;
  type SubjectRow = {
    id: string;
    name_json?: unknown;
    category?: unknown;
    illustrator?: unknown;
    tcg_card_dex_ids?: Array<{ dex_id?: unknown }>;
  };
  const subjects = new Map<string, CardSubject>(
    ((data || []) as SubjectRow[]).map((row) => [
      row.id,
      {
        dexIds: (row.tcg_card_dex_ids ?? []).flatMap((link) => (typeof link.dex_id === 'number' ? [link.dex_id] : [])),
        illustrator: typeof row.illustrator === 'string' ? row.illustrator : null,
        category: typeof row.category === 'string' ? row.category : null,
        // Only a real English name: Japanese-only cards have none (name_en falls back to the Japanese one).
        name:
          typeof (row.name_json as { en?: unknown } | null)?.en === 'string'
            ? (row.name_json as { en: string }).en
            : null,
      },
    ]),
  );
  return splitSimilarNeighbours(cardId, neighbours, subjects);
}

/** Similar cards for the app's card detail, as browse cards in each print's own language. */
export async function getSimilarMirroredCards(
  cardId: string,
  language: CardLanguage = 'en',
): Promise<Omit<SimilarCardsResponse, 'cardId' | 'language'>> {
  'use cache: remote';
  cacheLife(MIRROR_CACHE_LIFE);
  cacheTag('tcg-mirror', MIRROR_CACHE_VERSION, cacheSafeTag('similar', cardId), cacheSafeTag('language', language));

  const split = await getSimilarCardNeighbours(cardId, language);
  const ids = [...split.sameArtwork, ...split.similarLook].map((neighbour) => neighbour.cardId);
  if (!ids.length) return { sameArtwork: [], similarLook: [] };
  const { data, error } = await createAdminClient().from('tcg_cards').select(ILLUSTRATOR_CARD_SELECT).in('id', ids);
  if (error) throw error;
  const rows = new Map(((data || []) as unknown as IllustratorCardRow[]).map((row) => [row.id, row]));
  const toCards = (group: readonly SplitNeighbour[]): SimilarCard[] =>
    group.flatMap((neighbour) => {
      const row = rows.get(neighbour.cardId);
      const card = row ? toIllustratorCard(row, neighbour.lang) : null;
      return card ? [{ ...card, similarity: Number(neighbour.similarity.toFixed(3)) }] : [];
    });
  return { sameArtwork: toCards(split.sameArtwork), similarLook: toCards(split.similarLook) };
}
