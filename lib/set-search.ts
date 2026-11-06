// Set hits for the Search sheet and Quick mode: which mirrored sets a typed query names, best match first.
// Pure (no React), so the ranking is unit-tested; the fetch lives in hooks/use-card-search.ts.
import { resolveSetSearchAlias } from "@/lib/set-search-aliases"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"

/** How many set rows the Search sheet and Quick mode show above their card results. */
export const SEARCH_SET_RESULT_LIMIT = 3

const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()

/** Same threshold as the set search API (two characters). */
export function isSetSearchQuery(query: string) {
  return normalize(query).length >= 2
}

function matchScore(set: TCGSetSummary, needle: string) {
  const id = normalize(set.id)
  const name = normalize(set.name)
  if (id === needle || name === needle) return 4
  if (name.startsWith(needle)) return 3
  if (name.split(" ").some((word) => word.startsWith(needle)) || id.startsWith(needle)) return 2
  if (needle.length >= 3 && (name.includes(needle) || id.includes(needle))) return 1
  return 0
}

/**
 * Sets whose name or id match the query: exact id or name first, then name prefix, then a word or id prefix,
 * then (3+ characters) a substring. Ties keep the input order (the API returns newest first). Duplicate ids
 * are dropped; sets that don't match at all (e.g. a stale offline list) are left out.
 */
export function rankSetMatches(sets: readonly TCGSetSummary[], query: string, limit = SEARCH_SET_RESULT_LIMIT): TCGSetSummary[] {
  const needle = normalize(resolveSetSearchAlias(query))
  if (needle.length < 2) return []
  const seen = new Set<string>()
  const scored: Array<{ set: TCGSetSummary; score: number; index: number }> = []
  sets.forEach((set, index) => {
    if (!set?.id || !set.name || seen.has(set.id)) return
    const score = matchScore(set, needle)
    if (!score) return
    seen.add(set.id)
    scored.push({ set, score, index })
  })
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.set)
}

/** "Mega Evolution · 102 cards · 2026-01-30", with unknown parts left out. */
export function formatSetHitMeta(set: TCGSetSummary) {
  return [set.seriesName, set.officialCardCount ? `${set.officialCardCount} cards` : null, set.releaseDate].filter(Boolean).join(" · ")
}
