import type { CardLanguage } from "@/lib/domain/cards"
import type { InventoryCatalogEvidence } from "@/lib/domain/inventory-browse"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"
import type { BinderSnapshot } from "@/lib/domain/binder-slots"
import type { SlotDisplayInput } from "@/lib/binder-display-model"

/** Entries by every ID they answer to (own, canonical, alias), each list in catalog order and holding an entry once.
 * Matches exactly `card.id === id || card.canonicalId === id || card.aliasIds.includes(id)`. Built on first lookup:
 * the evidence is a read's immutable catalog, and a changed catalog arrives as a new array with a new resolver. */
function lazyCatalogIndex(evidence: readonly InventoryCatalogEvidence[]) {
  let index: Map<string, InventoryCatalogEvidence[]> | undefined
  return (id: string): readonly InventoryCatalogEvidence[] => {
    if (!index) {
      index = new Map()
      for (const entry of evidence) for (const key of new Set([entry.card.id, entry.card.canonicalId, ...(entry.card.aliasIds ?? [])])) {
        if (typeof key !== "string") continue
        const entries = index.get(key)
        if (entries) entries.push(entry)
        else index.set(key, [entry])
      }
    }
    return index.get(id) ?? []
  }
}

/** Translated names do not make distinct printings. Conflicting identity evidence
 * remains unknown; never infer species membership from a display name. */
export function browserHostCatalog(evidence: readonly InventoryCatalogEvidence[]): InventoryCatalogResolver {
  const lookup = lazyCatalogIndex(evidence)
  return id => {
    const matches = lookup(id)
    const first = matches[0]
    if (!first || !first.pokemonIds || matches.some(c => c.card.id !== first.card.id || !c.pokemonIds
      || c.card.canonicalId !== first.card.canonicalId || JSON.stringify(c.card.aliasIds ?? []) !== JSON.stringify(first.card.aliasIds ?? [])
      || JSON.stringify(c.pokemonIds) !== JSON.stringify(first.pokemonIds))) return undefined
    return { kind: "card", id: first.card.id, canonicalId: first.card.canonicalId, aliasIds: first.card.aliasIds, pokemonIds: first.pokemonIds }
  }
}

/** Display lookup shares the recorded printing identity, never object insertion order. */
export function browserHostDisplayCatalog(evidence: readonly InventoryCatalogEvidence[]) {
  const lookup = lazyCatalogIndex(evidence)
  return (id: string, language?: CardLanguage) => {
    const matches = lookup(id)
    const first = matches[0]
    if (!first || matches.some(c => c.card.id !== first.card.id || c.card.canonicalId !== first.card.canonicalId
      || JSON.stringify(c.card.aliasIds ?? []) !== JSON.stringify(first.card.aliasIds ?? []))) return undefined
    const translated = language ? matches.filter(c => c.card.language === language) : matches
    return translated.length === 1 ? translated[0].card : undefined
  }
}

/** One slot display input per catalog: the same inventory and binder objects return the same input, so the binder
 * surface keeps its slot display across unrelated renders. Create one per session read catalog, never shared. */
export function browserHostSlotDisplay(evidence: readonly InventoryCatalogEvidence[]) {
  const resolveCard = browserHostDisplayCatalog(evidence)
  let last: SlotDisplayInput | undefined
  return (inventory: InventorySnapshot, binder: BinderSnapshot): SlotDisplayInput =>
    last?.inventory === inventory && last.binder === binder ? last : (last = { inventory, binder, catalog: {}, resolveCard })
}
