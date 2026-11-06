/** Printed code verified against TCGplayer group 24831 (ME06: Delta Reign). */
export function resolveSetSearchAlias(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase()
  return normalized === "dlr" ? "me06" : normalized
}
