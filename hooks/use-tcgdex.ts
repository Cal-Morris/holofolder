"use client"

import { useState, useCallback } from "react"
import { filterAndRankCards } from "@/lib/card-search"

import type { CardLanguage, TCGCard } from "@/lib/domain/cards"

export type { CardLanguage, TCGCard } from "@/lib/domain/cards"

export interface CardFilters {
  set?: string
  rarity?: string
  variant?: string
  searchQuery?: string
}

const CARDS_CACHE_TTL_MS = 5 * 60 * 1000
const CARDS_CACHE_MAX_ENTRIES = 300

type CardsCacheEntry = { promise: Promise<TCGCard[]>; settledAt: number | null }

// Shared across hook instances: the binder slot previews, card selector and all-cards browser ask for
// the same Pokémon lists, and an effect re-run used to drop an in-flight batch and fetch it again.
const cardsCache = new Map<string, CardsCacheEntry>()

async function requestCardsForPokemon(dexId: number, language: CardLanguage): Promise<TCGCard[]> {
  const response = await fetch(`/api/tcgdex-cache?pokemonId=${dexId}&language=${encodeURIComponent(language)}`)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || `API error: ${response.status}`)
  }

  const data = await response.json()
  return Array.isArray(data.cards)
    ? data.cards.map((card: TCGCard) => ({ ...card, language }))
    : []
}

/** Fetch a Pokémon's card list, sharing in-flight requests and reusing results for a few minutes. Failures are not cached. */
export function loadCardsForPokemon(dexId: number, language: CardLanguage = "en", now = Date.now()): Promise<TCGCard[]> {
  const key = `${dexId}:${language}`
  const cached = cardsCache.get(key)
  if (cached && (cached.settledAt === null || now - cached.settledAt < CARDS_CACHE_TTL_MS)) {
    // Refresh recency for the LRU order.
    cardsCache.delete(key)
    cardsCache.set(key, cached)
    return cached.promise
  }

  const entry: CardsCacheEntry = { promise: Promise.resolve([]), settledAt: null }
  entry.promise = requestCardsForPokemon(dexId, language).then(
    (cards) => {
      entry.settledAt = Date.now()
      return cards
    },
    (error) => {
      if (cardsCache.get(key) === entry) cardsCache.delete(key)
      throw error
    },
  )
  cardsCache.set(key, entry)

  while (cardsCache.size > CARDS_CACHE_MAX_ENTRIES) {
    const oldestKey = cardsCache.keys().next().value
    if (oldestKey === undefined) break
    cardsCache.delete(oldestKey)
  }

  return entry.promise
}

/** Test helper. */
export function clearCardsForPokemonCache() {
  cardsCache.clear()
}

export function useTCGdex() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCardsForPokemon = useCallback(async (dexId: number, language: CardLanguage = "en"): Promise<TCGCard[]> => {
    setIsLoading(true)
    setError(null)

    try {
      // Copy so a caller sorting or filtering in place cannot affect the shared cached list.
      const cards = [...await loadCardsForPokemon(dexId, language)]

      setIsLoading(false)
      return cards
    } catch (err: any) {
      setError(err.message || "Failed to fetch cards")
      setIsLoading(false)
      return []
    }
  }, [])

  const filterCards = useCallback((cards: TCGCard[], filters: CardFilters): TCGCard[] => {
    return filterAndRankCards(cards, filters)
  }, [])

  return { fetchCardsForPokemon, filterCards, isLoading, error }
}
