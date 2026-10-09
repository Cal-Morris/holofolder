import { createAdminClient } from "@/lib/supabase/admin"
import type { CardFinish } from "@/hooks/use-collection"
import { selectRecentSetSummaries, type TCGSetDexSlot, type TCGSetSlotCard, type TCGSetSummary } from "@/lib/tcg-set-slots"
import { cacheLife, cacheTag } from "next/cache"

export type MirrorLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"

export interface MirroredTCGCard {
  id: string
  localId: string
  name: string
  image?: string
  set: {
    id: string
    name: string
    officialCardCount?: number
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

type MirroredCardQueryResult = {
  id: string
  localId: string
  name: string
  image?: string
  set: {
    id: string
    name: string
    officialCardCount?: number
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
      official_card_count
    )
  )
`

const IMAGE_LANGUAGE_FALLBACKS = ["en", "ja", "fr", "de", "es", "it", "pt-br", "ko"] as const
const MIRROR_CACHE_LIFE = "days"
const HIDDEN_SET_IDS = new Set(["jumbo"])
const MIRROR_CACHE_VERSION = "v2-first-partner-no-jumbo"

function cacheSafeTag(prefix: string, value: string | number) {
  return `${prefix}:${String(value).replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 180)}`
}

function pickLocalizedText(value: unknown, language: MirrorLanguage) {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value !== "object") return null

  const candidateMap = value as Record<string, unknown>
  const directMatch = candidateMap[language]
  if (typeof directMatch === "string" && directMatch.length > 0) {
    return directMatch
  }

  const fallback = candidateMap.en
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback
  }

  for (const candidate of Object.values(candidateMap)) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  return null
}

function buildCardImageUrl(language: string, seriesId: string, setId: string, localId: string) {
  const assetLanguage = encodeURIComponent(language)
  const encodedSeriesId = encodeURIComponent(seriesId)
  const encodedSetId = encodeURIComponent(setId)
  const encodedLocalId = encodeURIComponent(localId)
  return `https://assets.tcgdex.net/${assetLanguage}/${encodedSeriesId}/${encodedSetId}/${encodedLocalId}/high.webp`
}

export function pickExternalCardImageUrl(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const externalIds = value as Record<string, unknown>
  const tcgdex = externalIds.tcgdex && typeof externalIds.tcgdex === "object" && !Array.isArray(externalIds.tcgdex)
    ? externalIds.tcgdex as Record<string, unknown>
    : null
  const pokemonTcg = externalIds.pokemon_tcg && typeof externalIds.pokemon_tcg === "object" && !Array.isArray(externalIds.pokemon_tcg)
    ? externalIds.pokemon_tcg as Record<string, unknown>
    : null
  const tcgplayerProductId = pickTcgplayerProductId(tcgdex)

  return typeof tcgdex?.image === "string" && tcgdex.image.length > 0
    ? tcgdex.image
    : typeof pokemonTcg?.imageLarge === "string" && pokemonTcg.imageLarge.length > 0
      ? pokemonTcg.imageLarge
      : typeof pokemonTcg?.imageSmall === "string" && pokemonTcg.imageSmall.length > 0
        ? pokemonTcg.imageSmall
        : tcgplayerProductId
          ? `https://product-images.tcgplayer.com/${encodeURIComponent(tcgplayerProductId)}.jpg`
          : undefined
}

function pickTcgplayerProductId(tcgdex: Record<string, unknown> | null) {
  if (!tcgdex) {
    return null
  }

  const directThirdParty = tcgdex.thirdParty && typeof tcgdex.thirdParty === "object" && !Array.isArray(tcgdex.thirdParty)
    ? tcgdex.thirdParty as Record<string, unknown>
    : null
  const directProductId = normalizeProductId(directThirdParty?.tcgplayer)
  if (directProductId) {
    return directProductId
  }

  if (!Array.isArray(tcgdex.variantThirdParty)) {
    return null
  }

  for (const candidate of tcgdex.variantThirdParty) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue
    }

    const productId = normalizeProductId((candidate as Record<string, unknown>).tcgplayer)
    if (productId) {
      return productId
    }
  }

  return null
}

function normalizeProductId(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value)
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim()
  }

  return null
}

function inferCardFinish(rarity: unknown, variants: unknown): CardFinish {
  const rarityLabel = typeof rarity === "string" ? rarity.toLowerCase() : ""
  const variantMap = variants && typeof variants === "object"
    ? variants as Record<string, unknown>
    : {}

  if (rarityLabel.includes("special illustration")) return "special_illustration_rare"
  if (rarityLabel.includes("illustration")) return "illustration_rare"
  if (rarityLabel.includes("hyper")) return "hyper_rare"
  if (rarityLabel.includes("secret")) return "secret_rare"
  if (rarityLabel.includes("radiant")) return "radiant_rare"
  if (rarityLabel.includes("ace")) return "ace_spec"
  if (rarityLabel.includes("amazing")) return "amazing_rare"
  if (rarityLabel.includes("shiny")) return "shiny_rare"
  if (rarityLabel.includes("ultra")) return "ultra_rare"
  if (rarityLabel.includes("double")) return "double_rare"
  if (Boolean(variantMap.jumbo)) return "jumbo"
  if (Boolean(variantMap.holo)) return "holo"

  return "normal"
}

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

  const cards = ((data || []) as any[])
    .map((row): MirroredCardQueryResult => {
      const card = row.tcg_cards
      const set = card?.tcg_sets

      if (!card?.id || !card?.local_id || !card?.set_id || !card?.series_id || !set?.id) {
        return null
      }
      if (HIDDEN_SET_IDS.has(card.set_id)) {
        return null
      }

      const imageLanguage = pickImageLanguage(card.image_languages_json, language)
      const image = imageLanguage
        ? buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id)
        : pickExternalCardImageUrl(card.external_ids_json)

      return {
        id: card.id,
        localId: card.local_id,
        name: pickLocalizedText(card.name_json, language) || `Pokemon #${pokemonId}`,
        image,
        set: {
          id: set.id,
          name: pickLocalizedText(set.name_json, language) || set.id,
          officialCardCount: typeof set.official_card_count === "number" ? set.official_card_count : undefined,
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
  const trimmedQuery = query.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim()
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

export async function getMirroredSetDexSlots(
  setId: string,
  language: MirrorLanguage = "en",
  pokemonNames = new Map<number, string>(),
): Promise<{ selectedSet: TCGSetSummary | null; slots: TCGSetDexSlot[] }> {
  "use cache: remote"
  cacheLife(MIRROR_CACHE_LIFE)
  cacheTag("tcg-mirror", MIRROR_CACHE_VERSION, cacheSafeTag("set", setId), cacheSafeTag("language", language))

  if (HIDDEN_SET_IDS.has(setId)) {
    return { selectedSet: null, slots: [] }
  }

  const admin = createAdminClient()

  const { data, error } = await admin
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
    .order("local_id_sort", { ascending: true, nullsFirst: false })

  if (error) {
    throw error
  }

  const rows = (data || []) as any[]
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

  for (const card of rows) {
    const dexLinks = Array.isArray(card.tcg_card_dex_ids) ? card.tcg_card_dex_ids : []
    if (dexLinks.length === 0 || !card?.id || !card?.local_id || !card?.series_id || !card?.set_id || !card?.tcg_sets?.id) {
      continue
    }

    const imageLanguage = pickImageLanguage(card.image_languages_json, language)
    const image = imageLanguage
      ? buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id)
      : pickExternalCardImageUrl(card.external_ids_json)
    const setSummary: TCGSetSummary = {
      id: card.tcg_sets.id,
      name: pickLocalizedText(card.tcg_sets.name_json, language) || card.tcg_sets.name_en || card.tcg_sets.id,
      seriesName: pickLocalizedText(card.tcg_sets.tcg_series?.name_json, language) || card.tcg_sets.tcg_series?.name_en || undefined,
      officialCardCount: typeof card.tcg_sets.official_card_count === "number" ? card.tcg_sets.official_card_count : undefined,
      releaseDate: typeof card.tcg_sets.release_date === "string" ? card.tcg_sets.release_date : undefined,
    }
    const slotCard: TCGSetSlotCard = {
      id: card.id,
      localId: card.local_id,
      name: pickLocalizedText(card.name_json, language) || card.name_en || card.id,
      image,
      language,
      set: setSummary,
      rarity: typeof card.rarity === "string" ? card.rarity : undefined,
      variants: card.variants_json && typeof card.variants_json === "object" ? card.variants_json : undefined,
      inferredFinish: inferCardFinish(card.rarity, card.variants_json),
    }

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
    slots: [...slotMap.values()].sort((left, right) => left.dexId - right.dexId),
  }
}
