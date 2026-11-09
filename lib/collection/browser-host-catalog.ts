import type { InventoryCatalogEvidence } from "@/lib/domain/inventory-browse"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"

/** Translated names do not make distinct printings. Conflicting identity evidence
 * remains unknown; never infer species membership from a display name. */
export function browserHostCatalog(evidence: readonly InventoryCatalogEvidence[]): InventoryCatalogResolver {
  return id => {
    const matches = evidence.filter(c => c.card.id === id || c.card.canonicalId === id || c.card.aliasIds?.includes(id))
    const first = matches[0]
    if (!first || !first.pokemonIds || matches.some(c => c.card.id !== first.card.id || !c.pokemonIds
      || c.card.canonicalId !== first.card.canonicalId || JSON.stringify(c.card.aliasIds ?? []) !== JSON.stringify(first.card.aliasIds ?? [])
      || JSON.stringify(c.pokemonIds) !== JSON.stringify(first.pokemonIds))) return undefined
    return { kind: "card", id: first.card.id, canonicalId: first.card.canonicalId, aliasIds: first.card.aliasIds, pokemonIds: first.pokemonIds }
  }
}
