import { syntheticSlotDisplaySnapshot } from "./slot-display"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

/** Synthetic snapshots and catalog evidence only, never real ownership or provider claims. */
export function syntheticSlotPickerSnapshot() {
  const data = syntheticSlotDisplaySnapshot()
  const id = "00000000-0000-4000-8000-000000000366"
  data.binder.collectionId = id
  data.binder.slots.forEach(s => { s.collectionId = id })
  data.inventory.collections[0].id = id
  data.inventory.placements.forEach(p => { p.collectionId = id })
  const cards: SearchCardResult[] = [
    ["synthetic-snorlax-a", "Snorlax A", [143]], ["synthetic-snorlax-b", "Snorlax B", [143]],
    ["synthetic-trainer", "Trainer", []], ["synthetic-energy", "Energy", []], ["synthetic-item", "Item", []],
    ["synthetic-tandemaus", "Tandemaus", [924]], ["synthetic-maushold", "Maushold", [925]], ["synthetic-multi", "Pikachu and Snorlax", [25, 143]],
  ].map(([cardId, name, dexIds]) => ({ id: cardId as string, name: name as string, dexIds: dexIds as number[], localId: "1", language: "en", set: { id: "synthetic", name: "Synthetic set" }, variants: { normal: true, holo: true }, ...(cardId === "synthetic-trainer" ? { aliasIds: ["trainer-alias"] } : {}) }))
  Object.assign(data.catalog, Object.fromEntries(cards.map(c => [c.id, { name: c.name }])))
  const original = data.inventory.items[0]
  data.inventory.items.push(...["unassigned-b", "unassigned-a", "unassigned-grade"].map((id, index) => ({ ...structuredClone(original), id,
    grading: index === 2 ? { ...structuredClone(data.inventory.items[1].grading!), certificate: "PRIVATE-CERT", label: { variant: "PRIVATE-LABEL", assetIds: ["PRIVATE-ASSET"] } } : null })))
  return { ...data, cards }
}
