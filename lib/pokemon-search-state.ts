export type PokemonSearchStateFilter = "all" | "current" | "needed" | "upgrade" | "wanted" | "perfect"

export interface PokemonSearchPageJump {
  page: number
  label: string
}

export interface PokemonSearchItem {
  id: number
  name: string
}

export interface PokemonSearchScoredItem<T extends PokemonSearchItem> extends PokemonSearchItem {
  score: number
  item: T
}

export function getInitialPokemonSearchFilter(): PokemonSearchStateFilter {
  return "all"
}

export function normalizePokemonSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/♀/g, " female ")
    .replace(/♂/g, " male ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function compactSearchText(value: string) {
  return normalizePokemonSearchText(value).replace(/\s+/g, "")
}

export function getPokemonSearchTerms(name: string) {
  const normalizedName = normalizePokemonSearchText(name)
  const compactName = compactSearchText(name)
  const terms = new Set([normalizedName, compactName])

  const dashParts = name.split("-").filter(Boolean)
  if (dashParts.length > 1) {
    terms.add(normalizePokemonSearchText(dashParts[0]))
    terms.add(compactSearchText(dashParts[0]))
  }

  if (name === "nidoran-f") {
    terms.add("nidoran female")
    terms.add("nidoranfemale")
  }

  if (name === "nidoran-m") {
    terms.add("nidoran male")
    terms.add("nidoranmale")
  }

  return Array.from(terms).filter(Boolean)
}

export function scorePokemonSearchItem(query: string, item: PokemonSearchItem) {
  const normalizedQuery = normalizePokemonSearchText(query)
  const compactQuery = compactSearchText(query)

  if (!normalizedQuery) return 0

  const terms = getPokemonSearchTerms(item.name)
  let bestScore = 0

  for (const term of terms) {
    const comparableQuery = term.includes(" ") ? normalizedQuery : compactQuery
    let score = 0

    if (comparableQuery === "male" && term.includes("female")) {
      score = 0
    } else if (term === comparableQuery) {
      score = 1000
    } else if (term.startsWith(comparableQuery)) {
      score = 900
    } else if (term.includes(comparableQuery)) {
      score = 800
    } else {
      let queryIndex = 0
      for (let index = 0; index < term.length && queryIndex < comparableQuery.length; index++) {
        if (term[index] === comparableQuery[queryIndex]) {
          queryIndex++
        }
      }

      if (queryIndex !== comparableQuery.length) {
        score = 0
      } else {
        score = 100 + queryIndex * 20
      }
    }

    bestScore = Math.max(bestScore, score)
  }

  return bestScore
}

export function searchPokemonItems<T extends PokemonSearchItem>(query: string, items: T[], limit = 8) {
  if (!query.trim()) return []

  return items
    .map((item): PokemonSearchScoredItem<T> => ({
      ...item,
      item,
      score: scorePokemonSearchItem(query, item),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, limit)
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
