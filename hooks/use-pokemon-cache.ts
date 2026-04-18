"use client"

import { POKEMON_CATALOG } from "@/lib/pokemon-catalog"

export function usePokemonCache() {
  return {
    pokemonList: POKEMON_CATALOG,
    isLoading: false,
    progress: 100,
  }
}
