import type { InventorySnapshot } from "@/lib/domain/inventory"
import type { InventoryCatalogEvidence, InventoryLayoutEvidence } from "@/lib/domain/inventory-browse"
import { readCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"

/** Synthetic owned copies/locations/grades only. Catalog metadata below describes real base1-4. */
export function inventoryBrowseFixture(count = 5): InventorySnapshot {
  const ownerUserId = "synthetic-owner"
  const items: InventorySnapshot["items"] = Array.from({ length: count }, (_, i) => ({
    id: `copy-${String(i + 1).padStart(5, "0")}`, ownerUserId,
    identity: i === 3 ? { kind: "pokemon", pokemonId: 6 } : { kind: "card", cardId: i === 4 ? "synthetic-long" : "base1-4", language: "en", finish: "holo" },
    grading: i === 1 || i === 2 || i === 4 ? {
      provider: i === 4 ? { kind: "custom", name: "SyntheticIndependentGradingProviderWithAnUnbrokenLongName" } : { kind: "known", id: i === 1 ? "psa" : "cgc" },
      grade: i === 4 ? "Synthetic recorded descriptive grade with a deliberately long designation" : i === 1 ? "10" : null,
      scale: i === 1 ? "1–10" : null, designation: null, subgrades: [],
      certificate: "SYNTHETIC-PRIVATE-CERT", holder: "SYNTHETIC-PRIVATE-HOLDER", label: { variant: "SYNTHETIC-PRIVATE-LABEL", assetIds: [] },
    } : null, acquiredAt: null, version: 1,
  }))
  const collections: InventorySnapshot["collections"] = ["Alpha", "Trades"].map(name => ({ id: name.toLowerCase(), ownerUserId, name,
    kind: "binder", defaultPresentation: "binder", version: 1 }))
  const placements = items.slice(0, 2).map((item, i) => ({ inventoryItemId: item.id, collectionId: collections[i].id, slotId: `slot-${i}`, version: 1 }))
  return { ownerUserId, inventoryRevision: 1, items, placements, collections, binders: collections.map((collection, i) => ({
    ownerUserId, collectionId: collection.id, layoutRevision: 1, presetManifest: null,
    slots: Array.from({ length: 12 }, (_, n) => ({ id: n === 9 ? `slot-${i}` : `${collection.id}-empty-${n}`,
      ownerUserId, collectionId: collection.id, target: null, inventoryItemId: n === 9 ? placements[i]?.inventoryItemId ?? null : null,
      wantedCards: [], status: n === 9 && placements[i] ? "collected" : null, version: 1, presetOrigin: null })),
  })) }
}
export const inventoryBrowseCatalog: InventoryCatalogEvidence[] = [
  { card: { id: "base1-4", name: "Charizard", localId: "4", language: "en", set: { id: "base1", name: "Base Set" },
    image: "https://assets.tcgdex.net/en/base/base1/4/high.webp" }, speciesNames: ["Charizard"] },
  // This row is deliberately synthetic stress data, not a real catalog printing.
  { card: { id: "synthetic-long", name: "Synthetic Charizard with a very long collector supplied display name 火リザードン",
    localId: "SYNTHETIC-123", language: "en", set: { id: "synthetic", name: "Synthetic extremely long catalog set display evidence" } }, speciesNames: ["Charizard"] },
]
export const inventoryBrowseLayouts: InventoryLayoutEvidence[] = [
  { collectionId: "alpha", layoutRevision: 1, rows: 3, cols: 3 }, { collectionId: "trades", layoutRevision: 1, rows: 2, cols: 2 },
]

/** Uses the same completeness validator, without any server/network access or casts. */
export function completeInventoryBrowseFixture(snapshot = inventoryBrowseFixture()) {
  const reader = <T,>(rows: T[]) => async () => ({ inventoryRevision: snapshot.inventoryRevision, total: rows.length, rows, next: null })
  return readCompleteInventorySnapshot(snapshot.ownerUserId, snapshot.inventoryRevision, {
    items: reader(snapshot.items), placements: reader(snapshot.placements),
    collections: reader(snapshot.collections), binders: reader(snapshot.binders),
  })
}
