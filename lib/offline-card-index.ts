import { appPath } from "@/lib/app-path"
import { correctedCardSearchQuery, resolveCardSearchQuery } from "@/lib/card-search-query"
import { resolveSetSearchAlias } from "@/lib/set-search-aliases"
// Offline card search: an index built from what is already on the device (the user's own cards and the card
// data the service worker cached: set coverage, per-Pokémon card lists and earlier search results), matched
// with the same query rules as /app/api/tcg-card-search (name, set name/id, "44/102" numbers, card ids).
import type { CollectedPokemon } from "@/lib/domain/cards"
import { normalizeLocalId, type SearchCardResult } from "@/lib/pokemon-card-browse"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"

export const CACHED_CARD_API_PREFIXES = ["/app/api/tcg-set-slots", "/app/api/tcgdex-cache", "/app/api/tcg-card-search"] as const
const MAX_CACHED_RESPONSES = 600

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value)

function toSearchCard(value: unknown, dexIds: number[]): SearchCardResult | null {
  if (!isRecord(value)) return null
  const set = isRecord(value.set) ? value.set : null
  if (typeof value.id !== "string" || typeof value.name !== "string" || !set || typeof set.id !== "string") return null
  return {
    id: value.id,
    ...(typeof value.canonicalId === "string" ? { canonicalId: value.canonicalId } : {}),
    ...(Array.isArray(value.aliasIds) ? { aliasIds: value.aliasIds.filter((id): id is string => typeof id === "string") } : {}),
    localId: typeof value.localId === "string" ? value.localId : value.id.split("-").pop() ?? "",
    name: value.name,
    image: typeof value.image === "string" ? value.image : undefined,
    language: typeof value.language === "string" ? value.language : undefined,
    set: {
      id: set.id,
      name: typeof set.name === "string" ? set.name : set.id,
      officialCardCount: typeof set.officialCardCount === "number" ? set.officialCardCount : undefined,
      releaseDate: typeof set.releaseDate === "string" ? set.releaseDate : undefined,
    },
    rarity: typeof value.rarity === "string" ? value.rarity : undefined,
    variants: isRecord(value.variants) ? (value.variants as SearchCardResult["variants"]) : undefined,
    illustrator: typeof value.illustrator === "string" && value.illustrator ? value.illustrator : undefined,
    dexIds,
  }
}

const positiveInts = (value: unknown) =>
  Array.isArray(value) ? value.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0) : []

/** Cards inside one cached API response, with the Pokémon they belong to. */
export function extractCardsFromCachedResponse(url: string, payload: unknown): SearchCardResult[] {
  if (!isRecord(payload)) return []
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url, "http://local")
  } catch {
    return []
  }
  const path = appPath(parsedUrl.pathname)
  const cards: SearchCardResult[] = []

  if (path.startsWith("/app/api/tcg-set-slots") && Array.isArray(payload.slots)) {
    for (const slot of payload.slots) {
      if (!isRecord(slot) || typeof slot.dexId !== "number" || !Array.isArray(slot.cards)) continue
      for (const card of slot.cards) {
        const result = toSearchCard(card, [slot.dexId])
        if (result) cards.push(result)
      }
    }
  } else if (path.startsWith("/app/api/tcgdex-cache") && Array.isArray(payload.cards)) {
    const pokemonId = Number(parsedUrl.searchParams.get("pokemonId"))
    if (Number.isInteger(pokemonId) && pokemonId > 0) {
      for (const card of payload.cards) {
        const result = toSearchCard(card, [pokemonId])
        if (result) cards.push(result)
      }
    }
  } else if ((path.startsWith("/app/api/tcg-card-search") || path.startsWith("/app/api/tcg-illustrators")) && Array.isArray(payload.cards)) {
    for (const card of payload.cards) {
      const result = toSearchCard(card, positiveInts(isRecord(card) ? card.dexIds : null))
      if (result && (path.startsWith("/app/api/tcg-card-search") || result.dexIds.length > 0)) cards.push(result)
    }
  }

  return cards
}

/** Sets mentioned by cached set-coverage responses. */
export function extractSetsFromCachedResponse(url: string, payload: unknown): TCGSetSummary[] {
  if (!url.includes("/api/tcg-set-slots") || !isRecord(payload)) return []
  const sets = [...(Array.isArray(payload.sets) ? payload.sets : []), payload.selectedSet]
  return sets.filter((set): set is TCGSetSummary => isRecord(set) && typeof set.id === "string" && typeof set.name === "string")
}

/** The user's own cards (owned printing per slot and every wanted printing) as search results. */
export function collectionToSearchCards(collection: CollectedPokemon[]): SearchCardResult[] {
  const cards: SearchCardResult[] = []
  for (const item of collection) {
    const printings = [
      ...(item.card_id && item.status !== "wishlisted"
        ? [{ id: item.card_id, name: item.card_name, image: item.card_image, setName: item.card_set, language: item.card_language }]
        : []),
      ...item.wanted_cards.map((card) => ({ id: card.card_id, name: card.card_name, image: card.card_image, setName: card.card_set, language: card.card_language, localId: card.local_id, total: card.set_total, rarity: card.rarity, illustrator: card.illustrator })),
    ]
    for (const printing of printings) {
      const separator = printing.id.lastIndexOf("-")
      const setId = separator > 0 ? printing.id.slice(0, separator) : printing.id
      cards.push({
        id: printing.id,
        localId: ("localId" in printing && printing.localId) || (separator > 0 ? printing.id.slice(separator + 1) : ""),
        name: printing.name || item.pokemon_name,
        image: printing.image,
        language: printing.language,
        set: { id: setId, name: printing.setName || setId, officialCardCount: "total" in printing ? printing.total : undefined },
        rarity: "rarity" in printing ? printing.rarity : undefined,
        ...("illustrator" in printing && printing.illustrator ? { illustrator: printing.illustrator } : {}),
        dexIds: [item.pokemon_id],
      })
    }
  }
  return cards
}

/** Merge duplicates (same card id and language): first seen wins, Pokémon ids are combined. */
export function mergeSearchCards(lists: SearchCardResult[][]): SearchCardResult[] {
  const byId = new Map<string, SearchCardResult>()
  for (const list of lists) {
    for (const card of list) {
      const key = `${card.id}:${card.language ?? "unknown"}`
      const existing = byId.get(key)
      if (!existing) {
        byId.set(key, { ...card, dexIds: [...new Set(card.dexIds)] })
      } else {
        existing.dexIds = [...new Set([...existing.dexIds, ...card.dexIds])]
        existing.canonicalId ??= card.canonicalId
        if (card.aliasIds?.length) existing.aliasIds = [...new Set([...(existing.aliasIds ?? []), ...card.aliasIds])]
        existing.image ??= card.image
        existing.rarity ??= card.rarity
        if (!existing.set.officialCardCount && card.set.officialCardCount) existing.set = { ...existing.set, ...card.set }
      }
    }
  }
  return [...byId.values()]
}

/** Same rules as the server search: card id, or name / set name / set id containing the text, optionally a number. */
export function searchOfflineCards(cards: SearchCardResult[], query: string, limit = 60): SearchCardResult[] {
  // Supplement identities can have stamped suffixes that the collector-number parser cannot infer.
  const exactId = cards.filter(card => [card.id, card.canonicalId, ...(card.aliasIds ?? [])].some(id => id?.toLowerCase() === query.trim().toLowerCase()))
  if (exactId.length) return exactId.slice(0, limit)
  const parsed = resolveCardSearchQuery(query, Array.from(new Map(cards.map(card => [card.set.id, card.set])).values()))
  if (parsed.cardId) {
    const exact = cards.filter((card) => card.id.toLowerCase() === parsed.cardId)
    if (exact.length > 0) return exact.slice(0, limit)
  }
  if (!parsed.text && !parsed.number && !parsed.setIds.length) return []

  const text = parsed.text
  const number = parsed.number ? normalizeLocalId(parsed.number) : null
  const results: SearchCardResult[] = []
  for (const card of cards) {
    if (parsed.setIds.length && !parsed.setIds.includes(card.set.id)) continue
    if (text) {
      const matchesText = card.name.toLowerCase().includes(text) || (!parsed.setIds.length && (
        card.set.name.toLowerCase().includes(text) ||
        card.set.id.toLowerCase() === text ||
        card.set.id.toLowerCase() === resolveSetSearchAlias(text) ||
        (text.length >= 3 && Boolean(card.illustrator?.toLowerCase().includes(text)))))
      if (!matchesText) continue
    }
    if (number && normalizeLocalId(card.localId) !== number) continue
    results.push(card)
    if (results.length >= limit) break
  }
  return results
}

/** Sets whose name or id matches, for the Sets view while offline. */
export function searchOfflineSets(sets: TCGSetSummary[], query: string) {
  const text = query.trim().replace(/\s+/g, " ").toLowerCase()
  const code = resolveSetSearchAlias(query)
  if (text.length < 2) return []
  const byId = new Map<string, TCGSetSummary>()
  for (const set of sets) {
    if (set.id.toLowerCase() === code || set.name.toLowerCase().includes(text) || set.id.toLowerCase().includes(text)) byId.set(set.id, set)
  }
  return [...byId.values()]
}

interface CachedApiResponse {
  url: string
  payload: unknown
}

/** JSON card-data responses the service worker has cached (empty without Cache Storage). */
export async function readCachedCardApiResponses(cacheStorage: CacheStorage | undefined = typeof caches === "undefined" ? undefined : caches, apiPrefixes: readonly string[] = CACHED_CARD_API_PREFIXES): Promise<CachedApiResponse[]> {
  if (!cacheStorage) return []
  const results: CachedApiResponse[] = []
  try {
    const names = (await cacheStorage.keys()).filter((name) => name.endsWith("-data"))
    for (const name of names) {
      const cache = await cacheStorage.open(name)
      const requests = (await cache.keys()).filter((request) => {
        const path = appPath(new URL(request.url).pathname)
        return apiPrefixes.some((prefix) => path.startsWith(prefix))
      })
      for (const request of requests.slice(0, MAX_CACHED_RESPONSES - results.length)) {
        const response = await cache.match(request)
        const payload = await response?.json().catch(() => null)
        if (payload) results.push({ url: request.url, payload })
      }
      if (results.length >= MAX_CACHED_RESPONSES) break
    }
  } catch {
    // Cache Storage unavailable (private mode etc.): search the user's own cards only.
  }
  return results
}

export async function buildOfflineCardIndex(collection: CollectedPokemon[], cacheStorage?: CacheStorage) {
  const responses = await readCachedCardApiResponses(cacheStorage)
  return mergeSearchCards([
    collectionToSearchCards(collection),
    ...responses.map((response) => extractCardsFromCachedResponse(response.url, response.payload)),
  ])
}

export async function readOfflineSets(cacheStorage?: CacheStorage) {
  // Other card responses contain no set summaries; skip their bodies before reading and parsing JSON.
  const responses = await readCachedCardApiResponses(cacheStorage, ["/app/api/tcg-set-slots"])
  return responses.flatMap((response) => extractSetsFromCachedResponse(response.url, response.payload))
}

/** Literal matches win, with the same conservative correction retry as the online search. */
export function searchOfflineCardsWithCorrection(cards: SearchCardResult[], query: string, limit = 60) {
  const exact = searchOfflineCards(cards, query, limit)
  if (exact.length) return { cards: exact, correction: null }
  const sets = Array.from(new Map(cards.map(card => [card.set.id, card.set])).values())
  const corrected = correctedCardSearchQuery(query, sets)
  const matches = corrected ? searchOfflineCards(cards, corrected, limit) : []
  return { cards: matches, correction: matches.length ? corrected : null }
}
