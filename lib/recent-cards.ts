import { formatCardNumber, type SearchCardResult } from "@/lib/pokemon-card-browse"

export const RECENT_CARDS_STORAGE_KEY = "binderdex:recent-cards:v1"
export const RECENT_CARDS_LIMIT = 20

/** A card opened from search, kept on this device so it can be reopened from an empty search. */
export interface RecentCard {
  id: string
  name: string
  number: string
  setName: string
  image?: string
  language?: string
  dexId: number
  pokemonName: string
  viewedAt: string
}

export function toRecentCard(card: SearchCardResult, pokemon: { id: number; name: string }, viewedAt = new Date().toISOString()): RecentCard {
  return {
    id: card.id,
    name: card.name,
    number: formatCardNumber(card),
    setName: card.set.name,
    ...(card.image ? { image: card.image } : {}),
    ...(card.language ? { language: card.language } : {}),
    dexId: pokemon.id,
    pokemonName: pokemon.name,
    viewedAt,
  }
}

/** Newest first; viewing a card again moves it to the front instead of listing it twice. */
export function addRecentCard(list: RecentCard[], card: RecentCard, limit = RECENT_CARDS_LIMIT): RecentCard[] {
  return [card, ...list.filter((entry) => entry.id !== card.id)].slice(0, limit)
}

function isRecentCard(value: unknown): value is RecentCard {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === "string" && entry.id.length > 0
    && typeof entry.name === "string"
    && typeof entry.number === "string"
    && typeof entry.setName === "string"
    && typeof entry.pokemonName === "string"
    && typeof entry.viewedAt === "string"
    && Number.isInteger(entry.dexId) && (entry.dexId as number) > 0
    && (entry.image === undefined || typeof entry.image === "string")
    && (entry.language === undefined || typeof entry.language === "string")
}

/** Reads a stored list, dropping malformed or duplicate entries rather than failing. */
export function parseRecentCards(raw: string | null | undefined): RecentCard[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const cards: RecentCard[] = []
    for (const entry of parsed) {
      if (!isRecentCard(entry) || seen.has(entry.id)) continue
      seen.add(entry.id)
      cards.push(entry)
      if (cards.length === RECENT_CARDS_LIMIT) break
    }
    return cards
  } catch {
    return []
  }
}

type RecentCardStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

export function readRecentCards(storage: RecentCardStorage | undefined): RecentCard[] {
  try {
    return parseRecentCards(storage?.getItem(RECENT_CARDS_STORAGE_KEY))
  } catch {
    return []
  }
}

/** Best effort: a full or blocked storage just means the list isn't remembered. */
export function writeRecentCards(storage: RecentCardStorage | undefined, cards: RecentCard[]) {
  try {
    if (cards.length) storage?.setItem(RECENT_CARDS_STORAGE_KEY, JSON.stringify(cards))
    else storage?.removeItem(RECENT_CARDS_STORAGE_KEY)
  } catch {
    // Ignore quota and privacy-mode errors.
  }
}
