import catalog from "./pokemon-catalog.json"

export interface PokemonEntry {
  id: number
  name: string
}

export const POKEMON_CATALOG: PokemonEntry[] = catalog as PokemonEntry[]

const POKEMON_BY_ID = new Map<number, PokemonEntry>(
  POKEMON_CATALOG.map((entry) => [entry.id, entry]),
)

export function getPokemonById(id: number): PokemonEntry | undefined {
  return POKEMON_BY_ID.get(id)
}

export function getOfficialArtworkUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
}

export interface PokemonSummary extends PokemonEntry {
  sprites: {
    front_default: string
    other: {
      "official-artwork": { front_default: string }
    }
  }
}

export function getPokemonSummary(id: number): PokemonSummary | null {
  const entry = getPokemonById(id)
  if (!entry) return null
  const artwork = getOfficialArtworkUrl(id)
  return {
    ...entry,
    sprites: {
      front_default: artwork,
      other: { "official-artwork": { front_default: artwork } },
    },
  }
}
