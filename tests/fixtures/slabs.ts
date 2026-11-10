import type { GradingRecord } from "@/lib/domain/inventory"
import { inventoryBrowseFixture, inventoryBrowseCatalog } from "./inventory-browse"

/** Synthetic grading/copy data only. No real certificates or privately sourced artwork. */
export const slabVariants = [
  ["psa", "psa-standard", "psa-lighthouse", "10", "GEM MT"],
  ["cgc", "cgc-2025", "cgc-current", "10", "GEM MINT"],
  ["cgc", "cgc-2025", "cgc-pristine", "10", "PRISTINE"],
  ["cgc", "cgc-2023", "cgc-current", "9.5", "MINT+"],
  ["cgc", "cgc-2020", "cgc-blue", "9.5", "GEM MINT"],
  ["cgc", "cgc-2020", "cgc-blue-pristine", "10", "PRISTINE"],
  ["beckett", "beckett-standard", "beckett-silver", "9", "MINT"],
  ["beckett", "beckett-standard", "beckett-gold", "10", "PRISTINE"],
  ["beckett", "beckett-standard", "beckett-black", "10", "PRISTINE"],
] as const
export function slabFixture() {
  const snapshot = inventoryBrowseFixture(15)
  snapshot.items.forEach((item, i) => {
    item.identity = { kind: "card", cardId: i === 11 ? "synthetic-long" : i === 14 ? "synthetic-no-image" : "base1-4", language: "en" }
    const variant = slabVariants[i]
    item.grading = variant ? { provider: { kind: "known", id: variant[0] }, holder: variant[1], label: { variant: variant[2], assetIds: ["SYNTHETIC-PRIVATE-ASSET"] },
      grade: variant[3], designation: variant[4], scale: i === 4 || i === 5 ? "CGC Trading Cards 2020–2023" : "Recorded provider scale",
      certificate: "SYNTHETIC-PRIVATE-CERT", subgrades: i === 8 ? ["Centering", "Corners", "Edges", "Surface"].map(name => ({ name, grade: "10" })) : [] }
      : i === 9 ? null : { provider: i === 11 ? { kind: "custom", name: "SyntheticIndependentGradingProviderWithAnUnbrokenLongName" }
        : { kind: "known", id: i === 12 ? "ace" : i === 13 ? "psa" : "beckett" }, holder: "unsupported historic holder", label: { variant: i === 11 ? "custom-teal" : "unsupported historic label", assetIds: ["SYNTHETIC-PRIVATE-ASSET"] },
        grade: i === 10 ? "10" : i === 11 ? "Recorded descriptive grade with a very long qualifier" : null,
        designation: i === 11 ? "Synthetic qualifier with more text than a real label could reasonably fit" : null,
        scale: null, certificate: "SYNTHETIC-PRIVATE-CERT", subgrades: [] } satisfies GradingRecord
  })
  snapshot.placements = snapshot.items.map((item, i) => ({ inventoryItemId: item.id, collectionId: "alpha", slotId: `slab-slot-${i}`, version: 1 }))
  snapshot.binders[0].slots = snapshot.items.map((item, i) => ({ id: `slab-slot-${i}`, ownerUserId: snapshot.ownerUserId, collectionId: "alpha", target: null,
    inventoryItemId: item.id, wantedCards: [], status: "collected", version: 1, presetOrigin: null }))
  snapshot.binders[1].slots.forEach(s => { s.inventoryItemId = null; s.status = null })
  return snapshot
}
export const slabCatalog = [...inventoryBrowseCatalog, { card: { id: "synthetic-no-image", name: "Synthetic card without catalog image", localId: "1", language: "en" as const,
  set: { id: "synthetic", name: "Synthetic missing image set" } }, speciesNames: [] }]
