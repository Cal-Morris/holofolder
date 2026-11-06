import { parseCardSearchQuery, sanitizeSearchText } from "@/lib/pokemon-card-browse"
import { resolveSetSearchAlias } from "@/lib/set-search-aliases"

type SearchSet = { id: string; name: string }

/** Candidate set phrases, before bare numbers are interpreted as collector numbers. */
export function cardSearchSetCandidates(raw: string) {
  if (parseCardSearchQuery(raw).cardId) return []
  const words = sanitizeSearchText(raw).toLowerCase().split(" ").filter(Boolean)
  if (words.length < 2) return []
  const candidates: Array<{ phrase: string; remainder: string }> = []
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= words.length; end++) {
      const phrase = words.slice(start, end).join(" ")
      // Explicit collector syntax must never become a set constraint.
      if (/[#/]/.test(phrase)) continue
      candidates.push({ phrase: resolveSetSearchAlias(phrase), remainder: [...words.slice(0, start), ...words.slice(end)].join(" ") })
    }
  }
  return candidates.sort((a, b) => b.phrase.length - a.phrase.length)
}

/** Exact catalog names/codes win over ambiguous bare numbers; no guessed set aliases. */
export function resolveCardSearchQuery(raw: string, sets: SearchSet[]) {
  for (const candidate of cardSearchSetCandidates(raw)) {
    const matches = sets.filter(set => set.id.toLowerCase() === candidate.phrase || set.name.toLowerCase() === candidate.phrase)
    if (matches.length) {
      const parsed = parseCardSearchQuery(candidate.remainder)
      const numberOnly = /^#?(\d{1,4}[a-z]?)$/.exec(candidate.remainder)
      return { ...parsed, ...(numberOnly ? { text: "", number: numberOnly[1] } : {}), setIds: matches.map(set => set.id) }
    }
  }
  return { ...parseCardSearchQuery(raw), setIds: [] as string[] }
}
