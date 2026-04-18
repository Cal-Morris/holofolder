import { createAdminClient } from "@/lib/supabase/admin"

export type MirrorLanguage = "en" | "ja"

export interface MirroredTCGCard {
  id: string
  localId: string
  name: string
  image?: string
  set: {
    id: string
    name: string
  }
  rarity?: string
  variants?: {
    normal?: boolean
    reverse?: boolean
    holo?: boolean
    firstEdition?: boolean
    wPromo?: boolean
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
  }
  rarity?: string
  variants?: {
    normal?: boolean
    reverse?: boolean
    holo?: boolean
    firstEdition?: boolean
    wPromo?: boolean
  }
  hp?: number
  types?: string[]
  illustrator?: string
} | null

const IMAGE_LANGUAGE_FALLBACKS = ["en", "ja", "fr", "de", "es", "it", "pt-br", "ko"] as const

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
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tcg_card_dex_ids")
    .select(`
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
          variants_json,
          tcg_sets!inner(
            id,
            name_json
        )
      )
    `)
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

      const imageLanguage = pickImageLanguage(card.image_languages_json, language)

      return {
        id: card.id,
        localId: card.local_id,
        name: pickLocalizedText(card.name_json, language) || `Pokemon #${pokemonId}`,
        image: imageLanguage ? buildCardImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id) : undefined,
        set: {
          id: set.id,
          name: pickLocalizedText(set.name_json, language) || set.id,
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
