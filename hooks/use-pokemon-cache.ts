"use client"

import { useEffect, useState } from "react"

interface PokemonData {
  id: number
  name: string
}

const CACHE_KEY = "pokemon_cache"
const CACHE_EXPIRY_KEY = "pokemon_cache_expiry"
const COLLECTED_KEY = "pokemon_collected"
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days

export function usePokemonCache() {
  const [pokemonList, setPokemonList] = useState<PokemonData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const loadCache = async () => {
      try {
        // Check if cache exists and is valid
        const cachedData = localStorage.getItem(CACHE_KEY)
        const cachedExpiry = localStorage.getItem(CACHE_EXPIRY_KEY)

        if (cachedData && cachedExpiry && Date.now() < Number.parseInt(cachedExpiry)) {
          console.log("[v0] Loading Pokemon from cache")
          setPokemonList(JSON.parse(cachedData))
          setIsLoading(false)
          return
        }

        // Fetch fresh data
        console.log("[v0] Fetching Pokemon data from API")
        const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1025&offset=0")
        const data = await response.json()

        // Extract just name and id for fast searching
        const simplified = data.results.map((p: any, index: number) => ({
          id: index + 1,
          name: p.name,
        }))

        // Cache the data
        localStorage.setItem(CACHE_KEY, JSON.stringify(simplified))
        localStorage.setItem(CACHE_EXPIRY_KEY, (Date.now() + CACHE_DURATION).toString())

        setPokemonList(simplified)
        setIsLoading(false)
        setProgress(100)
      } catch (error) {
        console.error("[v0] Error loading Pokemon cache:", error)
        setIsLoading(false)
      }
    }

    loadCache()
  }, [])

  const toggleCollected = (pokemonId: number) => {
    const collected = getCollected()
    if (collected.has(pokemonId)) {
      collected.delete(pokemonId)
    } else {
      collected.add(pokemonId)
    }
    localStorage.setItem(COLLECTED_KEY, JSON.stringify(Array.from(collected)))
  }

  const getCollected = (): Set<number> => {
    const stored = localStorage.getItem(COLLECTED_KEY)
    return new Set(stored ? JSON.parse(stored) : [])
  }

  const isCollected = (pokemonId: number): boolean => {
    const collected = getCollected()
    return collected.has(pokemonId)
  }

  return { pokemonList, isLoading, progress, toggleCollected, isCollected }
}
