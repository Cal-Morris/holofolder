"use client"

import { useState } from "react"

export interface PokemonCard {
  id: string
  name: string
  series: string
  set: string
  cardNumber: string
  imageUrl: string
  rarity?: string
}

const CARDS_CACHE_KEY = "pokemon_cards_cache"
const CARDS_CACHE_EXPIRY_KEY = "pokemon_cards_cache_expiry"
const CARDS_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days
const SELECTED_CARDS_KEY = "pokemon_selected_cards"

export function usePokemonCards() {
  const [cardsCache, setCardsCache] = useState<Record<number, PokemonCard[]>>({})

  // Fetch cards for a specific Pokemon
  const fetchCardsForPokemon = async (pokemonName: string, pokemonId: number): Promise<PokemonCard[]> => {
    // Check cache first
    const cacheKey = `${CARDS_CACHE_KEY}_${pokemonId}`
    const cacheExpiryKey = `${CARDS_CACHE_EXPIRY_KEY}_${pokemonId}`
    const cachedCards = localStorage.getItem(cacheKey)
    const cachedExpiry = localStorage.getItem(cacheExpiryKey)

    if (cachedCards && cachedExpiry && Date.now() < Number.parseInt(cachedExpiry)) {
      return JSON.parse(cachedCards)
    }

    try {
      // Fetch from Pokemon TCG API
      const response = await fetch(
        `https://api.pokemontcg.io/v2/cards?q=name:"${pokemonName}" (card.name:*${pokemonName}*)`,
      )
      const data = await response.json()

      const cards: PokemonCard[] = (data.data || [])
        .slice(0, 20) // Limit to 20 cards
        .map((card: any) => ({
          id: card.id,
          name: card.name,
          series: card.set?.series || "Unknown",
          set: card.set?.name || "Unknown",
          cardNumber: card.cardNumber,
          imageUrl: card.images?.small || card.images?.large || "/placeholder.svg",
          rarity: card.rarity,
        }))

      // Cache the cards
      localStorage.setItem(cacheKey, JSON.stringify(cards))
      localStorage.setItem(cacheExpiryKey, (Date.now() + CARDS_CACHE_DURATION).toString())

      return cards
    } catch (error) {
      console.error("[v0] Error fetching cards:", error)
      return []
    }
  }

  // Save selected card for a slot
  const saveSelectedCard = (page: number, slot: string, card: PokemonCard) => {
    const selected = getSelectedCards()
    selected[`${page}-${slot}`] = card
    localStorage.setItem(SELECTED_CARDS_KEY, JSON.stringify(selected))
  }

  // Get selected card for a slot
  const getSelectedCard = (page: number, slot: string): PokemonCard | null => {
    const selected = getSelectedCards()
    return selected[`${page}-${slot}`] || null
  }

  // Get all selected cards
  const getSelectedCards = (): Record<string, PokemonCard> => {
    const stored = localStorage.getItem(SELECTED_CARDS_KEY)
    return stored ? JSON.parse(stored) : {}
  }

  return { fetchCardsForPokemon, saveSelectedCard, getSelectedCard, getSelectedCards }
}
