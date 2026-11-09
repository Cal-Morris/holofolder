import { cardSearchSetCandidates, correctedCardSearchQuery, resolveCardSearchQuery } from "@/lib/card-search-query"
import type { ImportLookup } from "@/lib/collection-import"
import { resolveSetSearchAlias } from "@/lib/set-search-aliases"
import type { CardCatalogIdentity } from "@/lib/domain/cards"
import { deduplicateCatalogCards, readCatalogMetadata } from "@/lib/card-catalog"
import { createAdminClient } from "@/lib/supabase/admin"
import { selectRecentSetSummaries, type TCGSetDexSlot, type TCGSetSlotCard, type TCGSetSummary } from "@/lib/tcg-set-slots"
import { cacheLife, cacheTag } from "next/cache"
import { buildTcgdexAssetImageUrl, pickLocalizedText, TCGDEX_LANGUAGE_FALLBACKS } from "@/lib/tcgdex-shared"
import { pickExternalCardImageUrl } from "@/lib/card-image-sources"
import {
  compareBrowseCards,
  inferCardFinish,
  normalizeLocalId,
  parseCardSearchQuery,
  type SearchCardResult,
} from "@/lib/pokemon-card-browse"
import {
  buildIllustratorDirectory,
  cleanIllustratorName,
  type IllustratorCard,
  type IllustratorSummary,
} from "@/lib/illustrators"

export type MirrorLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"

export interface MirroredTCGCard extends CardCatalogIdentity {
  id: string
  localId: string
  name: string
  image?: string
  set: {
    id: string
    name: string
    officialCardCount?: number
    releaseDate?: string
  }
  rarity?: string
  variants?: {
    normal?: boolean
    reverse?: boolean
    holo?: boolean
    firstEdition?: boolean
    wPromo?: boolean
    jumbo?: boolean
  }
  hp?: number
  types?: string[]
  illustrator?: string
}

type MirroredCardQueryResult = CardCatalogIdentity & {
  id: string
  localId: string
  name: string
  image?: string
  set: {
    id: string
    name: string
    officialCardCount?: number
    releaseDate?: string
  }
  rarity?: string
  variants?: {
    normal?: boolean
    reverse?: boolean
    holo?: boolean
    firstEdition?: boolean
    wPromo?: boolean
    jumbo?: boolean
  }
  hp?: number
  types?: string[]
  illustrator?: string
} | null

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
`

const IMAGE_LANGUAGE_FALLBACKS = TCGDEX_LANGUAGE_FALLBACKS
const MIRROR_CACHE_LIFE = "days"
const HIDDEN_SET_IDS = new Set(["jumbo"])
const MIRROR_CACHE_VERSION = "v5-catalog-printings"

function cacheSafeTag(prefix: string, value: string | number) {
  return `${prefix}:${String(value).replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 180)}`
}

function buildCardImageUrl(language: string, seriesId: string, setId: string, localId: string) {
  return buildTcgdexAssetImageUrl(language, seriesId, setId, localId)
}

export { pickExternalCardImageUrl }

function pickImageLanguage(value: unknown, requestedLanguage: MirrorLanguage) {
  if (!Array.isArray(value)) {
    return null
  }

  const languages = value.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
  if (languages.length === 0) {
    return null
  }

  if (languages.includes(requestedLanguage)) {
    return requestedLanguage
  }

  for (const fallback of IMAGE_LANGUAGE_FALLBACKS) {
    if (languages.includes(fallback)) {
      return fallback
    }
  }

  return languages[0] || null
}

function compareLocalIds(a: MirroredTCGCard, b: MirroredTCGCard) {
  const aNumeric = Number.parseInt(a.localId.replace(/\D+/g, ""), 10)
  const bNumeric = Number.parseInt(b.localId.replace(/\D+/g, ""), 10)

  if (Number.isFinite(aNumeric) && Number.isFinite(bNumeric) && aNumeric !== bNumeric) {
    return aNumeric - bNumeric
  }

  if (a.set.id !== b.set.id) {
    return a.set.id.localeCompare(b.set.id)
  }

  return a.localId.localeCompare(b.localId)
}

export async function getMirroredCardsForPokemon(pokemonId: number, language: MirrorLanguage = "en") {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, cacheSafeTag("pokemon", pokemonId), cacheSafeTag("language", language))

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tcg_card_dex_ids")
    .select(MIRRORED_CARD_SELECT)
    .eq("dex_id", pokemonId)

  if (error) {
    throw error
  }

  const cards = deduplicateCatalogCards(((data || []) as any[]).map(row => row.tcg_cards).filter(Boolean))
    .map((card): MirroredCardQueryResult => {
      const set = card?.tcg_sets

      if (!card?.id || !card?.local_id || !card?.set_id || !card?.series_id || !set?.id) {
        return null
      }
      if (HIDDEN_SET_IDS.has(card.set_id)) {
        return null
      }

      const imageLanguage = pickImageLanguage(card.image_languages_json, language)
      const image = readCatalogMetadata(card.external_ids_json).image ?? (imageLanguage
        ? buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id)
        : pickExternalCardImageUrl(card.external_ids_json))

      return {
        id: card.id,
        canonicalId: readCatalogMetadata(card.external_ids_json).canonicalId,
        aliasIds: readCatalogMetadata(card.external_ids_json).aliasIds,
        localId: readCatalogMetadata(card.external_ids_json).localId ?? card.local_id,
        name: pickLocalizedText(card.name_json, language) || `Pokemon #${pokemonId}`,
        image,
        set: {
          id: set.id,
          name: pickLocalizedText(set.name_json, language) || set.id,
          officialCardCount: typeof set.official_card_count === "number" ? set.official_card_count : undefined,
          releaseDate: typeof set.release_date === "string" ? set.release_date : undefined,
        },
        rarity: typeof card.rarity === "string" ? card.rarity : undefined,
        variants: card.variants_json && typeof card.variants_json === "object" ? card.variants_json : undefined,
        hp: typeof card.hp === "number" ? card.hp : undefined,
        types: Array.isArray(card.types_json)
          ? card.types_json.filter((value: unknown): value is string => typeof value === "string")
          : undefined,
        illustrator: typeof card.illustrator === "string" ? card.illustrator : undefined,
      } satisfies MirroredTCGCard
    })
    .filter((card): card is MirroredTCGCard => Boolean(card))
    .sort(compareLocalIds)

  return cards
}

export async function searchMirroredSets(query: string, limit = 8): Promise<TCGSetSummary[]> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)

  const admin = createAdminClient()
  const trimmedQuery = resolveSetSearchAlias(query.replace(/[,%()]/g, " "))
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, "tcg-sets", cacheSafeTag("set-query", trimmedQuery), cacheSafeTag("limit", limit))

  if (trimmedQuery.length < 2) {
    return []
  }

  const { data, error } = await admin
    .from("tcg_sets")
    .select(`
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
    `)
    .or(`id.ilike.%${trimmedQuery}%,name_en.ilike.%${trimmedQuery}%`)
    .order("release_date", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    throw error
  }

  return ((data || []) as any[])
    .filter((set) => !HIDDEN_SET_IDS.has(set.id))
    .map((set) => ({
      id: set.id,
      name: pickLocalizedText(set.name_json, "en") || set.name_en || set.id,
      seriesName: pickLocalizedText(set.tcg_series?.name_json, "en") || set.tcg_series?.name_en || undefined,
      officialCardCount: typeof set.official_card_count === "number" ? set.official_card_count : undefined,
      releaseDate: typeof set.release_date === "string" ? set.release_date : undefined,
    }))
}

export async function getRecentMirroredSets(asOfDate: string, limit = 6): Promise<TCGSetSummary[]> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, "tcg-sets", "recent-sets", cacheSafeTag("as-of", asOfDate), cacheSafeTag("limit", limit))

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tcg_sets")
    .select(`
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
    `)
    .not("release_date", "is", null)
    .lte("release_date", asOfDate)
    .order("release_date", { ascending: false, nullsFirst: false })
    .limit(Math.max(limit * 4, 24))

  if (error) {
    throw error
  }

  const sets = ((data || []) as any[])
    .filter((set) => !HIDDEN_SET_IDS.has(set.id))
    .map((set) => ({
      id: set.id,
      name: pickLocalizedText(set.name_json, "en") || set.name_en || set.id,
      seriesName: pickLocalizedText(set.tcg_series?.name_json, "en") || set.tcg_series?.name_en || undefined,
      officialCardCount: typeof set.official_card_count === "number" ? set.official_card_count : undefined,
      releaseDate: typeof set.release_date === "string" ? set.release_date : undefined,
    }))

  return selectRecentSetSummaries(sets, { asOfDate, limit })
}

export async function readSetCardPages<T>(fetchPage:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>) {
  const rows:T[]=[]
  for(let from=0;;from+=500) {
    const {data,error}=await fetchPage(from,from+499)
    if(error)throw error
    rows.push(...data??[])
    if(!data||data.length<500)return rows
  }
}

export async function getMirroredSetDexSlots(
  setId: string,
  language: MirrorLanguage = "en",
  pokemonNames = new Map<number, string>(),
  includeHidden = false,
): Promise<{ selectedSet: TCGSetSummary | null; slots: TCGSetDexSlot[]; cards: TCGSetSlotCard[] }> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, cacheSafeTag("set", setId), cacheSafeTag("language", language))

  if (!includeHidden && HIDDEN_SET_IDS.has(setId)) {
    return { selectedSet: null, slots: [], cards: [] }
  }

  const admin = createAdminClient()

  const data = await readSetCardPages((from,to)=>admin
    .from("tcg_cards")
    .select(`
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
    `)
    .eq("set_id", setId)
    .order("local_id_sort", { ascending: true, nullsFirst: false }).order("id").range(from,to))

  const rows = deduplicateCatalogCards((data || []) as any[])
  const firstSet = rows[0]?.tcg_sets
  const selectedSet: TCGSetSummary | null = firstSet?.id
    ? {
        id: firstSet.id,
        name: pickLocalizedText(firstSet.name_json, language) || firstSet.name_en || firstSet.id,
        seriesName: pickLocalizedText(firstSet.tcg_series?.name_json, language) || firstSet.tcg_series?.name_en || undefined,
        officialCardCount: typeof firstSet.official_card_count === "number" ? firstSet.official_card_count : undefined,
        releaseDate: typeof firstSet.release_date === "string" ? firstSet.release_date : undefined,
      }
    : null
  const slotMap = new Map<number, TCGSetDexSlot>()
  const cards: TCGSetSlotCard[] = []

  for (const card of rows) {
    const dexLinks = Array.isArray(card.tcg_card_dex_ids) ? card.tcg_card_dex_ids : []
    if (!card?.id || !card?.local_id || !card?.series_id || !card?.set_id || !card?.tcg_sets?.id) {
      continue
    }

    const imageLanguage = pickImageLanguage(card.image_languages_json, language)
    const image = readCatalogMetadata(card.external_ids_json).image ?? (imageLanguage
      ? buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id)
      : pickExternalCardImageUrl(card.external_ids_json))
    const setSummary: TCGSetSummary = {
      id: card.tcg_sets.id,
      name: pickLocalizedText(card.tcg_sets.name_json, language) || card.tcg_sets.name_en || card.tcg_sets.id,
      seriesName: pickLocalizedText(card.tcg_sets.tcg_series?.name_json, language) || card.tcg_sets.tcg_series?.name_en || undefined,
      officialCardCount: typeof card.tcg_sets.official_card_count === "number" ? card.tcg_sets.official_card_count : undefined,
      releaseDate: typeof card.tcg_sets.release_date === "string" ? card.tcg_sets.release_date : undefined,
    }
    const slotCard: TCGSetSlotCard = {
      id: card.id,
      canonicalId: readCatalogMetadata(card.external_ids_json).canonicalId,
      aliasIds: readCatalogMetadata(card.external_ids_json).aliasIds,
      localId: readCatalogMetadata(card.external_ids_json).localId ?? card.local_id,
      name: pickLocalizedText(card.name_json, language) || card.name_en || card.id,
      image,
      language,
      set: setSummary,
      rarity: typeof card.rarity === "string" ? card.rarity : undefined,
      variants: card.variants_json && typeof card.variants_json === "object" ? card.variants_json : undefined,
      inferredFinish: inferCardFinish(card.rarity, card.variants_json),
    }

    cards.push(slotCard)

    for (const link of dexLinks) {
      const dexId = typeof link?.dex_id === "number" ? link.dex_id : null
      if (!dexId) {
        continue
      }

      const entry: TCGSetDexSlot = slotMap.get(dexId) ?? {
        dexId,
        pokemonName: pokemonNames.get(dexId) || `Pokemon #${dexId}`,
        cards: [],
      }
      entry.cards.push(slotCard)
      slotMap.set(dexId, entry)
    }
  }

  return {
    selectedSet,
    cards,
    slots: [...slotMap.values()].sort((left, right) => left.dexId - right.dexId),
  }
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
`

export function cardSearchSelect(includeNonPokemon = false) {
  return includeNonPokemon ? CARD_SEARCH_SELECT.replace("tcg_card_dex_ids!inner(", "tcg_card_dex_ids(") : CARD_SEARCH_SELECT
}

export function toSearchCardResult(card: any, language: MirrorLanguage, includeNonPokemon = false): SearchCardResult | null {
  const set = card?.tcg_sets
  if (!card?.id || !card?.local_id || !card?.set_id || !card?.series_id || !set?.id || HIDDEN_SET_IDS.has(card.set_id)) {
    return null
  }
  const dexIds = (Array.isArray(card.tcg_card_dex_ids) ? card.tcg_card_dex_ids : [])
    .map((link: any) => (typeof link?.dex_id === "number" ? link.dex_id : null))
    .filter((dexId: number | null): dexId is number => Boolean(dexId))
  if (!includeNonPokemon && dexIds.length === 0) return null

  const confirmedLanguage = (typeof card.name_json?.[language] === "string" && card.name_json[language].trim().length > 0)
    || (Array.isArray(card.image_languages_json) && card.image_languages_json.includes(language))
  const imageLanguage = pickImageLanguage(card.image_languages_json, language)
  return {
    id: card.id,
    canonicalId: readCatalogMetadata(card.external_ids_json).canonicalId,
    aliasIds: readCatalogMetadata(card.external_ids_json).aliasIds,
    localId: readCatalogMetadata(card.external_ids_json).localId ?? card.local_id,
    name: pickLocalizedText(card.name_json, language) || card.name_en || card.id,
    image: readCatalogMetadata(card.external_ids_json).image ?? (imageLanguage
      ? buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id)
      : pickExternalCardImageUrl(card.external_ids_json)),
    language: !includeNonPokemon || confirmedLanguage ? language : undefined,
    set: {
      id: set.id,
      name: pickLocalizedText(set.name_json, language) || set.name_en || set.id,
      officialCardCount: typeof set.official_card_count === "number" ? set.official_card_count : undefined,
      releaseDate: typeof set.release_date === "string" ? set.release_date : undefined,
    },
    rarity: typeof card.rarity === "string" ? card.rarity : undefined,
    variants: card.variants_json && typeof card.variants_json === "object" ? card.variants_json as Record<string, boolean> : undefined,
    illustrator: typeof card.illustrator === "string" && card.illustrator.trim() ? card.illustrator.trim() : undefined,
    dexIds,
  }
}

function localIdCandidates(number: string) {
  const normalized = normalizeLocalId(number)
  const digits = /^(\d+)([a-z]?)$/.exec(normalized)
  if (!digits) return [number]
  const [, value, suffix] = digits
  // Sets store local ids with varying zero padding ("4", "04", "004").
  return Array.from(new Set([value, value.padStart(2, "0"), value.padStart(3, "0")].map((candidate) => `${candidate}${suffix}`)))
}

/** Exact, bounded identity lookup for import. No fuzzy search or language fallback. */
export async function findMirroredImportCandidates(lookup: ImportLookup): Promise<SearchCardResult[]> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION)
  const admin = createAdminClient()
  const escaped = (value: string) => value.replace(/[\\%_]/g, "\\$&")
  let query = admin.from("tcg_cards").select(CARD_SEARCH_SELECT).not(`name_json->>${lookup.language}`, "is", null)
  if (lookup.cardId) {
    const direct = await query.eq("id", lookup.cardId).limit(101)
    if (direct.error) throw direct.error
    if (direct.data?.length) return direct.data.map(card => toSearchCardResult(card, lookup.language)).filter((card): card is SearchCardResult => Boolean(card))
    query = admin.from("tcg_cards").select(CARD_SEARCH_SELECT).not(`name_json->>${lookup.language}`, "is", null).contains("external_ids_json", { catalog: { aliasIds: [lookup.cardId] } })
  } else if (lookup.tcgplayerId) {
    // readImportLookups restricts the filter value to digits.
    if (!/^\d{1,12}$/.test(lookup.tcgplayerId)) return []
    query = query.or(`external_ids_json->catalog->>productId.eq.${lookup.tcgplayerId},external_ids_json->tcgdex->thirdParty->>tcgplayer.eq.${lookup.tcgplayerId}`)
  } else {
    if (!lookup.cardName || !lookup.set || !lookup.number) return []
    const direct = await admin.from("tcg_sets").select("id").eq("id", lookup.set).limit(2)
    if (direct.error) throw direct.error
    const sets = direct.data?.length ? direct : await admin.from("tcg_sets").select("id").ilike(`name_json->>${lookup.language}`, escaped(lookup.set)).limit(2)
    if (sets.error) throw sets.error
    if (sets.data?.length !== 1) return []
    query = query.eq("set_id", sets.data[0].id).ilike(`name_json->>${lookup.language}`, escaped(lookup.cardName))
  }
  const { data, error } = await query.limit(101)
  if (error) throw error
  // A truncated result must never look like a unique match.
  if (!data || data.length > 100) return []
  return data.map(card => toSearchCardResult(card, lookup.language)).filter((card): card is SearchCardResult => Boolean(card))
}

/**
 * Card search across the mirror: card name, card number ("bulbasaur 44/102"), set name/id
 * ("pitch black", "me05 12"), illustrator ("arita") or a TCGdex card id ("base1-44"). Defaults to cards that feature a Pokémon; explicit-slot catalog mode also includes non-Pokémon cards.
 */
export async function searchMirroredCards(query: string, language: MirrorLanguage = "en", limit = 60, includeNonPokemon = false): Promise<{ cards: SearchCardResult[]; correction: string | null }> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)

  let parsed = { ...parseCardSearchQuery(query), setIds: [] as string[] }
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, "tcg-card-search", cacheSafeTag("card-query", `${parsed.text}|${parsed.number ?? ""}|${parsed.cardId ?? ""}`), cacheSafeTag("language", language))

  if (parsed.text.length < 2 && !parsed.cardId) {
    return { cards: [], correction: null }
  }

  const admin = createAdminClient()
  const select = cardSearchSelect(includeNonPokemon)
  let correction: string | null = null
  const candidates = [...new Set(cardSearchSetCandidates(query).map(candidate => candidate.phrase).filter(phrase => !phrase.includes(" ") && phrase.length >= 2))]
  if (candidates.length) {
    const catalog = await admin.from("tcg_sets").select("id,name_en")
      .or(candidates.flatMap(phrase => [`id.ilike.${JSON.stringify(phrase)}`, `name_en.ilike.${JSON.stringify(`%${phrase}%`)}`]).join(","))
      .limit(1000)
    if (catalog.error) throw catalog.error
    const sets = (catalog.data ?? [])
      .filter(set => !HIDDEN_SET_IDS.has(set.id))
      .map(set => ({ id: set.id, name: set.name_en ?? "" }))
    parsed = resolveCardSearchQuery(query, sets)
    correction = correctedCardSearchQuery(query, sets)
  }
  const numberCandidates = parsed.number ? localIdCandidates(parsed.number) : null
  const requests: Array<PromiseLike<{ data: any[] | null; error: unknown }>> = []

  if (parsed.cardId) {
    requests.push(admin.from("tcg_cards").select(select).ilike("id", parsed.cardId).limit(5))
  }

  if (parsed.setIds.length) {
    let bySet = admin.from("tcg_cards").select(select).in("set_id", parsed.setIds)
    if (parsed.text) bySet = bySet.ilike("name_en", `%${parsed.text}%`)
    if (numberCandidates) bySet = bySet.in("local_id", numberCandidates)
    requests.push(bySet.order("local_id_sort", { ascending: true, nullsFirst: false }).limit(limit))
  } else if (parsed.text.length >= 2) {
    let byName = admin.from("tcg_cards").select(select).ilike("name_en", `%${parsed.text}%`)
    if (numberCandidates) byName = byName.in("local_id", numberCandidates)
    requests.push(byName.limit(limit))

    // Illustrator ("arita", "5ban"): newest first, so a dealer's recent cards show up.
    if (parsed.text.length >= 3) {
      let byIllustrator = admin.from("tcg_cards").select(select).ilike("illustrator", `%${parsed.text}%`)
      if (numberCandidates) byIllustrator = byIllustrator.in("local_id", numberCandidates)
      requests.push(byIllustrator.limit(limit))
    }

    // The set lookup and the card query that depends on it run alongside the name query
    // instead of before it.
    requests.push((async () => {
      const setMatches = await admin
        .from("tcg_sets")
        .select("id")
        .or(`id.ilike.${parsed.text},name_en.ilike.%${parsed.text}%`)
        .order("release_date", { ascending: false, nullsFirst: false })
        .limit(4)
      if (setMatches.error) return { data: null, error: setMatches.error }
      const setIds = ((setMatches.data || []) as Array<{ id: string }>).map((set) => set.id).filter((id) => !HIDDEN_SET_IDS.has(id))
      if (setIds.length === 0) return { data: [], error: null }
      let bySet = admin.from("tcg_cards").select(select).in("set_id", setIds)
      if (numberCandidates) bySet = bySet.in("local_id", numberCandidates)
      return await bySet.order("local_id_sort", { ascending: true, nullsFirst: false }).limit(limit)
    })())
  }

  const responses = await Promise.all(requests)
  const results = new Map<string, SearchCardResult>()
  for (const response of responses) {
    if (response.error) throw response.error
  }
  for (const row of deduplicateCatalogCards(responses.flatMap(response => response.data || []))) {
    const card = toSearchCardResult(row, language, includeNonPokemon)
    if (card && !results.has(card.id)) results.set(card.id, card)
  }

  const cards = Array.from(results.values()).slice(0, limit * 2)
  if (!cards.length && correction) {
    const retry = await searchMirroredCards(correction, language, limit, includeNonPokemon)
    return { cards: retry.cards, correction: retry.cards.length ? correction : null }
  }
  return { cards, correction: null }
}

const ILLUSTRATOR_DIRECTORY_FUNCTION = "tcg_illustrator_directory"
const MIRROR_PAGE_SIZE = 1000
const MAX_ILLUSTRATOR_DIRECTORY_PAGES = 60
const MAX_ILLUSTRATOR_CARDS = 3000

function isMissingFunctionError(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code
  const message = String((error as { message?: unknown } | null)?.message ?? "")
  return code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(message)
}

/**
 * Every illustrator in the mirror with their card count. Uses the `tcg_illustrator_directory()` function
 * (migration 030); until that is applied it pages through `tcg_cards.illustrator` instead.
 */
export async function getMirroredIllustratorDirectory(): Promise<IllustratorSummary[]> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, "tcg-illustrators")

  const admin = createAdminClient()
  const { data, error } = await admin.rpc(ILLUSTRATOR_DIRECTORY_FUNCTION)
  if (!error) {
    return buildIllustratorDirectory(((data || []) as Array<{ illustrator?: unknown; card_count?: unknown }>)
      .map((row) => ({ name: row.illustrator, count: typeof row.card_count === "number" ? row.card_count : Number(row.card_count) })))
  }
  if (!isMissingFunctionError(error)) throw error

  const names: Array<{ name: unknown }> = []
  for (let page = 0; page < MAX_ILLUSTRATOR_DIRECTORY_PAGES; page += 1) {
    const from = page * MIRROR_PAGE_SIZE
    const { data: rows, error: pageError } = await admin
      .from("tcg_cards")
      .select("illustrator")
      .not("illustrator", "is", null)
      .not("set_id", "in", `(${[...HIDDEN_SET_IDS].join(",")})`)
      .order("id", { ascending: true })
      .range(from, from + MIRROR_PAGE_SIZE - 1)
    if (pageError) throw pageError
    for (const row of (rows || []) as Array<{ illustrator?: unknown }>) names.push({ name: row.illustrator })
    if (!rows || rows.length < MIRROR_PAGE_SIZE) break
  }
  return buildIllustratorDirectory(names)
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
`

type IllustratorCardRow = {
  id: string
  series_id?: string | null
  set_id?: string | null
  local_id?: string | null
  name_json?: unknown
  name_en?: string | null
  rarity?: unknown
  illustrator?: unknown
  image_languages_json?: unknown
  external_ids_json?: unknown
  variants_json?: unknown
  tcg_sets?: { id?: string; name_json?: unknown; name_en?: string | null; official_card_count?: unknown; release_date?: unknown } | null
  tcg_card_dex_ids?: Array<{ dex_id?: unknown }> | null
}

function toIllustratorCard(card: IllustratorCardRow, language: MirrorLanguage): IllustratorCard | null {
  const set = card?.tcg_sets
  if (!card?.id || !card.local_id || !card.set_id || !card.series_id || !set?.id || HIDDEN_SET_IDS.has(card.set_id)) {
    return null
  }
  const dexIds = (Array.isArray(card.tcg_card_dex_ids) ? card.tcg_card_dex_ids : [])
    .map((link) => (typeof link?.dex_id === "number" ? link.dex_id : null))
    .filter((dexId): dexId is number => Boolean(dexId))
  const imageLanguage = pickImageLanguage(card.image_languages_json, language)
  const metadata = readCatalogMetadata(card.external_ids_json)
  return {
    id: card.id,
    canonicalId: metadata.canonicalId,
    aliasIds: metadata.aliasIds,
    localId: metadata.localId ?? card.local_id,
    name: pickLocalizedText(card.name_json, language) || card.name_en || card.id,
    image: metadata.image ?? (imageLanguage
      ? buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id)
      : pickExternalCardImageUrl(card.external_ids_json)),
    language,
    set: {
      id: set.id,
      name: pickLocalizedText(set.name_json, language) || set.name_en || set.id,
      officialCardCount: typeof set.official_card_count === "number" ? set.official_card_count : undefined,
      releaseDate: typeof set.release_date === "string" ? set.release_date : undefined,
    },
    rarity: typeof card.rarity === "string" ? card.rarity : undefined,
    variants: card.variants_json && typeof card.variants_json === "object" ? card.variants_json as Record<string, boolean> : undefined,
    dexIds,
    illustrator: typeof card.illustrator === "string" ? card.illustrator : undefined,
  }
}

/** Every mirrored card credited to one illustrator (exact name, as listed in the directory), across all sets. */
export async function getMirroredCardsByIllustrator(name: string, language: MirrorLanguage = "en"): Promise<IllustratorCard[]> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)
  const illustrator = cleanIllustratorName(name)
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, "tcg-illustrators", cacheSafeTag("illustrator", illustrator.toLowerCase()), cacheSafeTag("language", language))
  if (!illustrator) return []

  const admin = createAdminClient()
  const rows: IllustratorCardRow[] = []
  for (let from = 0; from < MAX_ILLUSTRATOR_CARDS; from += MIRROR_PAGE_SIZE) {
    const { data, error } = await admin
      .from("tcg_cards")
      .select(ILLUSTRATOR_CARD_SELECT)
      .eq("illustrator", illustrator)
      .order("id", { ascending: true })
      .range(from, from + MIRROR_PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...((data || []) as unknown as IllustratorCardRow[]))
    if (!data || data.length < MIRROR_PAGE_SIZE) break
  }

  return deduplicateCatalogCards(rows)
    .map((row) => toIllustratorCard(row, language))
    .filter((card): card is IllustratorCard => Boolean(card))
    .sort(compareBrowseCards)
}
