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
}

export function toCacheableCardImageUrl(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return null
  if (value.startsWith("/")) return value

  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return `/api/card-image-proxy?url=${encodeURIComponent(url.toString())}`
  } catch {
    return null
  }
}

export function buildOfflineCacheWarmupUrls(input: OfflineCacheWarmupInput) {
  const language = typeof input.language === "string" && input.language.length > 0 ? input.language : "en"
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

  return [...urls]
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
