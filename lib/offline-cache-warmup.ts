export const OFFLINE_CACHE_WARMUP_MESSAGE_TYPE = "BINDERDEX_WARM_CACHE"

type CardLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"

interface OfflineCacheWarmupWantedCard {
  card_image?: unknown
}

interface OfflineCacheWarmupCollectionItem {
  pokemon_id?: unknown
  card_image?: unknown
  wanted_cards?: unknown
}

interface OfflineCacheWarmupInput {
  visiblePokemonIds?: unknown
  selectedPokemonId?: unknown
  collection?: unknown
  language?: unknown
  maxUrls?: number
}

const SUPPORTED_CARD_LANGUAGES: CardLanguage[] = ["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"]

export function toCacheableCardImageUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return null

  const trimmed = value.trim()
  if (trimmed.startsWith("/")) return trimmed

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return `/api/card-image-proxy?url=${encodeURIComponent(url.toString())}`
  } catch {
    return null
  }
}

export function buildOfflineCacheWarmupUrls(input: OfflineCacheWarmupInput) {
  const language = normalizeCardLanguage(input.language)
  const maxUrls = typeof input.maxUrls === "number" && Number.isInteger(input.maxUrls) && input.maxUrls > 0
    ? input.maxUrls
    : 500
  const urls = new Set<string>(["/"])

  addPokemonCacheUrls(urls, input.visiblePokemonIds, language)
  addPokemonCacheUrls(urls, [input.selectedPokemonId], language)

  if (Array.isArray(input.collection)) {
    for (const item of input.collection as OfflineCacheWarmupCollectionItem[]) {
      addPokemonCacheUrls(urls, [item?.pokemon_id], language)
      addCardImageUrl(urls, item?.card_image)

      if (Array.isArray(item?.wanted_cards)) {
        for (const wantedCard of item.wanted_cards as OfflineCacheWarmupWantedCard[]) {
          addCardImageUrl(urls, wantedCard?.card_image)
        }
      }
    }
  }

  return [...urls].slice(0, maxUrls)
}

function addPokemonCacheUrls(urls: Set<string>, values: unknown, language: string) {
  if (!Array.isArray(values)) return

  for (const value of values) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) continue
    urls.add(`/api/tcgdex-cache?pokemonId=${value}&language=${encodeURIComponent(language)}`)
  }
}

function addCardImageUrl(urls: Set<string>, value: unknown) {
  const imageUrl = toCacheableCardImageUrl(value)
  if (imageUrl) {
    urls.add(imageUrl)
  }
}

function normalizeCardLanguage(value: unknown): CardLanguage {
  if (typeof value !== "string") return "en"
  const normalized = value.trim().toLowerCase()
  return SUPPORTED_CARD_LANGUAGES.includes(normalized as CardLanguage) ? normalized as CardLanguage : "en"
}
