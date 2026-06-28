export type PokemonSearchStateFilter = "all" | "current" | "needed" | "upgrade" | "wanted" | "perfect"

export interface PokemonSearchPageJump {
  page: number
  label: string
}

export function getInitialPokemonSearchFilter(): PokemonSearchStateFilter {
  return "all"
}

export function getPokemonSearchPageJump(query: string, totalPages: number): PokemonSearchPageJump | null {
  const trimmedQuery = query.trim().toLowerCase()
  const match = /^(?:page\s*)?(\d+)$/.exec(trimmedQuery)

  if (!match) return null

  const page = Number.parseInt(match[1], 10)
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return null

  return {
    page,
    label: `Jump to page ${page}`,
  }
}
