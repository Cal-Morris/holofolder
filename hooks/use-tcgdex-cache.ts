"use client"

import { useEffect, useState } from "react"

interface TCGCard {
  id: string
  name: string
  set: string
  setId: string
  number: string
  image: string
  rarity?: string
  cardType?: string
  language: "en" | "ja"
}

const TCGDEX_CACHE_KEY = "tcgdex_cards_cache"
const TCGDEX_METADATA_KEY = "tcgdex_cache_metadata"
const SELECTED_CARDS_KEY = "tcgdex_selected_cards"

export function useTCGdexCache() {
  const [cacheMetadata, setCacheMetadata] = useState<{
    lastFetch: number
    pokemonCached: number
  } | null>(null)
  const [isBackgroundCaching, setIsBackgroundCaching] = useState(false)

  useEffect(() => {
    const metadata = localStorage.getItem(TCGDEX_METADATA_KEY)
    if (metadata) {
      setCacheMetadata(JSON.parse(metadata))
    }
  }, [])

  const fetchCardsForPokemon = async (
    pokemonName: string,
    pokemonId: number,
    language: "en" | "ja" = "en",
  ): Promise<TCGCard[]> => {
    const cacheKey = `${TCGDEX_CACHE_KEY}_${pokemonId}_${language}`
    const cachedCards = localStorage.getItem(cacheKey)

    if (cachedCards) {
      console.log(`[v0] Cache hit: Retrieved ${JSON.parse(cachedCards).length} cards for Pokemon #${pokemonId}`)
      return JSON.parse(cachedCards)
    }

    try {
      console.log(`[v0] Fetching cards for Pokemon #${pokemonId} (${pokemonName})`)

      const lang = language === "ja" ? "jp" : "en"
      const apiUrl = `https://api.tcgdex.dev/v2/${lang}/cards?q=dexIds:${pokemonId}`

      console.log(`[v0] Calling API: ${apiUrl}`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      })

      clearTimeout(timeoutId)

      console.log(`[v0] Response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API returned status ${response.status}: ${errorText}`)
      }

      const data = await response.json()
      console.log(`[v0] Parsed API response:`, data)

      if (!data) {
        console.log(`[v0] API returned empty response for Pokemon #${pokemonId}`)
        localStorage.setItem(cacheKey, JSON.stringify([]))
        return []
      }

      let cardsArray: any[] = []
      if (Array.isArray(data)) {
        cardsArray = data
      } else if (data && typeof data === "object") {
        if (Array.isArray(data.data)) {
          cardsArray = data.data
        } else if (Array.isArray(data.results)) {
          cardsArray = data.results
        } else if (Array.isArray(data.cards)) {
          cardsArray = data.cards
        } else {
          console.warn(`[v0] Unexpected API response structure:`, Object.keys(data))
          cardsArray = []
        }
      }

      console.log(`[v0] Found ${cardsArray.length} cards for Pokemon #${pokemonId}`)

      const cards: TCGCard[] = cardsArray
        .map((card: any) => {
          try {
            return {
              id: card.id || `${pokemonId}-${card.localId}`,
              name: card.name || pokemonName,
              set: card.set?.name || "Unknown",
              setId: card.set?.id || "unknown",
              number: card.localId || "?",
              image: card.image?.hires || card.image?.original || "/placeholder.svg",
              rarity: card.rarity?.name,
              cardType: card.type,
              language,
            }
          } catch (err) {
            console.error(`[v0] Error mapping card:`, err)
            return null
          }
        })
        .filter((card): card is TCGCard => card !== null)

      console.log(`[v0] Successfully cached ${cards.length} cards for Pokemon #${pokemonId}`)
      localStorage.setItem(cacheKey, JSON.stringify(cards))
      return cards
    } catch (error) {
      let errorMessage = "Unknown error"
      if (error instanceof TypeError) {
        errorMessage = `Network error: ${error.message}`
      } else if (error instanceof Error) {
        if (error.name === "AbortError") {
          errorMessage = "Request timeout (>10s)"
        } else {
          errorMessage = error.message
        }
      }
      console.error(`[v0] Error fetching cards for ${pokemonName}:`, errorMessage, error)
      throw new Error(`Failed to load cards for ${pokemonName}: ${errorMessage}`)
    }
  }

  const startBackgroundCaching = async (
    pokemonList: Array<{ id: number; name: string }>,
    language: "en" | "ja" = "en",
  ) => {
    setIsBackgroundCaching(true)

    for (const pokemon of pokemonList) {
      const cacheKey = `${TCGDEX_CACHE_KEY}_${pokemon.id}_${language}`
      if (!localStorage.getItem(cacheKey)) {
        try {
          await fetchCardsForPokemon(pokemon.name, pokemon.id, language)

          const metadata = localStorage.getItem(TCGDEX_METADATA_KEY)
          const current = metadata ? JSON.parse(metadata) : {}
          localStorage.setItem(
            TCGDEX_METADATA_KEY,
            JSON.stringify({
              lastFetch: Date.now(),
              pokemonCached: (current.pokemonCached || 0) + 1,
            }),
          )
          setCacheMetadata({
            lastFetch: Date.now(),
            pokemonCached: (current.pokemonCached || 0) + 1,
          })
        } catch (err) {
          console.warn(`[v0] Failed to cache Pokemon #${pokemon.id}:`, err)
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    setIsBackgroundCaching(false)
  }

  const clearAndRebuildCache = async (
    pokemonList: Array<{ id: number; name: string }>,
    language: "en" | "ja" = "en",
  ) => {
    const keys = Object.keys(localStorage)
    keys.forEach((key) => {
      if (key.startsWith(TCGDEX_CACHE_KEY)) {
        localStorage.removeItem(key)
      }
    })

    localStorage.setItem(
      TCGDEX_METADATA_KEY,
      JSON.stringify({
        lastFetch: Date.now(),
        pokemonCached: 0,
      }),
    )

    await startBackgroundCaching(pokemonList, language)
  }

  const saveSelectedCard = (page: number, slot: string, card: TCGCard) => {
    const selected = getSelectedCards()
    selected[`${page}-${slot}`] = card
    localStorage.setItem(SELECTED_CARDS_KEY, JSON.stringify(selected))
  }

  const getSelectedCard = (page: number, slot: string): TCGCard | null => {
    const selected = getSelectedCards()
    return selected[`${page}-${slot}`] || null
  }

  const getSelectedCards = (): Record<string, TCGCard> => {
    const stored = localStorage.getItem(SELECTED_CARDS_KEY)
    return stored ? JSON.parse(stored) : {}
  }

  return {
    fetchCardsForPokemon,
    startBackgroundCaching,
    clearAndRebuildCache,
    saveSelectedCard,
    getSelectedCard,
    getSelectedCards,
    cacheMetadata,
    isBackgroundCaching,
  }
}
