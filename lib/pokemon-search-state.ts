export type PokemonSearchStateFilter = "all" | "current" | "needed" | "upgrade" | "wanted" | "perfect"

export function getInitialPokemonSearchFilter(): PokemonSearchStateFilter {
  return "all"
}
