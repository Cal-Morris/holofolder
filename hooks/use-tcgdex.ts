"use client"

import { useState, useCallback } from "react"

export interface TCGCard {
  id: string
  localId: string
  name: string
  image?: string
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

const SETS_CACHE_KEY = "tcgdex_sets_cache"
const CARDS_CACHE_KEY = "tcgdex_cards_cache"

export function useTCGdex() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSets = useCallback(async (): Promise<{ id: string; name: string }[]> => {
    try {
      const cached = localStorage.getItem(SETS_CACHE_KEY)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          return data
        }
      }

      const response = await fetch("https://api.tcgdex.net/v2/en/sets")
      if (!response.ok) throw new Error("Failed to fetch sets")
      const data = await response.json()
      
      const sets = Array.isArray(data) ? data.map((s: any) => ({ id: s.id, name: s.name })) : []
      localStorage.setItem(SETS_CACHE_KEY, JSON.stringify({ data: sets, timestamp: Date.now() }))
      return sets
    } catch (err) {
      console.error("[v0] Error fetching sets:", err)
      return []
    }
  }, [])

  const fetchCardsForPokemon = useCallback(async (dexId: number): Promise<TCGCard[]> => {
    setIsLoading(true)
    setError(null)

    try {
      const cacheKey = `${CARDS_CACHE_KEY}_${dexId}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        if (Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
          setIsLoading(false)
          return data
        }
      }

      const response = await fetch(`https://api.tcgdex.net/v2/en/cards?dexId=${dexId}`)
      if (!response.ok) throw new Error(`API error: ${response.status}`)
      
      const data = await response.json()
      const cards: TCGCard[] = []

      if (Array.isArray(data)) {
        for (const card of data) {
          try {
            const detailRes = await fetch(`https://api.tcgdex.net/v2/en/cards/${card.id}`)
            if (detailRes.ok) {
              const detail = await detailRes.json()
              cards.push({
                id: detail.id,
                localId: detail.localId || card.localId,
                name: detail.name || card.name,
                image: detail.image ? `${detail.image}/high.webp` : undefined,
                set: {
                  id: detail.set?.id || "",
                  name: detail.set?.name || "",
                  logo: detail.set?.logo,
                },
                rarity: detail.rarity,
                variants: detail.variants,
                hp: detail.hp,
                types: detail.types,
                illustrator: detail.illustrator,
              })
            }
          } catch {
            cards.push({
              id: card.id,
              localId: card.localId,
              name: card.name,
              image: card.image ? `${card.image}/high.webp` : undefined,
              set: { id: "", name: "" },
            })
          }
        }
      }

      localStorage.setItem(cacheKey, JSON.stringify({ data: cards, timestamp: Date.now() }))
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

  return { fetchCardsForPokemon, fetchSets, filterCards, isLoading, error }
}
