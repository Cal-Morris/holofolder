import type { WantedCard } from "@/lib/domain/cards"
import type { WantedDashboardEntry } from "@/lib/wanted-dashboard"

export const wantedPrintingKey = (card: WantedCard) => `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`

export function mergeWantedPeople(base: readonly string[] | undefined, local: readonly string[] | undefined, server: readonly string[] | undefined) {
  if (local === undefined) return server === undefined ? undefined : [...server]
  const merged = new Set(server)
  for (const id of local) if (!base?.includes(id)) merged.add(id)
  for (const id of base ?? []) if (!local.includes(id)) merged.delete(id)
  return [...merged].sort()
}

export function wantedPeopleLabel(ids: readonly string[] | undefined, viewerId: string | null, partnerId: string | null, partnerLabel: string) {
  if (!ids?.length) return "Unassigned"
  return [...new Set(ids.map(id => id === viewerId ? "You" : id === partnerId ? partnerLabel : "Another collector"))].join(", ")
}

export function groupGlobalWanted(entries: readonly WantedDashboardEntry[]) {
  const grouped = new Map<string, WantedDashboardEntry>()
  for (const entry of entries) {
    const key = wantedPrintingKey(entry.card)
    const previous = grouped.get(key)
    const locations = entry.binderId ? [{ binderId: entry.binderId, binderName: entry.binderName ?? "Binder", pokemonId: entry.pokemonId, pokemonName: entry.pokemonName, card: entry.card }] : []
    if (!previous) {
      grouped.set(key, { ...entry, card: { ...entry.card }, locations })
      continue
    }
    previous.locations!.push(...locations)
    const ids = [...new Set([...(previous.card.wanted_by ?? []), ...(entry.card.wanted_by ?? [])])].sort()
    if (ids.length) previous.card.wanted_by = ids
  }
  return [...grouped.values()]
}
