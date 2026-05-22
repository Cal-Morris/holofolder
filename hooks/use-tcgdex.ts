"use client"

import { useState, useCallback } from "react"

export type CardLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"

export interface TCGCard {
  id: string
  localId: string
  name: string
  image?: string
  language?: CardLanguage
  set: {
    id: string
    name: string
    logo?: string
  }
  rarity?: string
  variants?: {
    normal?: boolean
    reverse?: boolean
    holo?: boolean
    firstEdition?: boolean
  }
  hp?: number
  types?: string[]
  illustrator?: string
}

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
    return cards.filter((card) => {
      if (filters.set && card.set.id !== filters.set) return false
      if (filters.rarity && card.rarity !== filters.rarity) return false
      if (filters.variant) {
        if (filters.variant === "normal" && !card.variants?.normal) return false
        if (filters.variant === "reverse" && !card.variants?.reverse) return false
        if (filters.variant === "holo" && !card.variants?.holo) return false
        if (filters.variant === "firstEdition" && !card.variants?.firstEdition) return false
      }
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase()
        if (!card.name.toLowerCase().includes(query) && 
            !card.localId.toLowerCase().includes(query) &&
            !card.set.name.toLowerCase().includes(query)) {
          return false
        }
      }
      return true
    })
  }, [])

  return { fetchCardsForPokemon, filterCards, isLoading, error }
}
