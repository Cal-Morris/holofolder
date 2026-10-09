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

export function useTCGdex() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCardsForPokemon = useCallback(async (dexId: number, language: CardLanguage = "en"): Promise<TCGCard[]> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/tcgdex-cache?pokemonId=${dexId}&language=${encodeURIComponent(language)}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || `API error: ${response.status}`)
      }

      const data = await response.json()
      const cards: TCGCard[] = Array.isArray(data.cards)
        ? data.cards.map((card: TCGCard) => ({ ...card, language }))
        : []

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
