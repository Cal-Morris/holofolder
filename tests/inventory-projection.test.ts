import { test } from "node:test"
import assert from "node:assert/strict"
import { projectInventoryCollection, valueInventoryCollection } from "@/lib/collection/inventory-projection"
import { inventoryBrowseFixture, inventoryBrowseCatalog } from "./fixtures/inventory-browse"

// Synthetic copies and explicit wants, never real inventory or price evidence.
test("copies and explicit destinations survive This binder/All storage, targets are not wants", () => {
  const snapshot = inventoryBrowseFixture()
  snapshot.binders[0].slots[0].target = { kind: "pokemon", pokemonId: 143 }
  const want = { card_id: "synthetic-trainer", card_name: "Synthetic Trainer", added_at: "2026-11-09T00:00:00Z" }
  snapshot.binders[0].slots[0].wantedCards = [want]
  snapshot.binders[0].slots[1].wantedCards = [want]
  const all = projectInventoryCollection(snapshot, inventoryBrowseCatalog)
  assert.equal(all.owned.length, 5)
  assert.equal(all.wants.length, 2)
  assert.notEqual(all.wants[0].slotId, all.wants[1].slotId)
  assert.equal(all.priceIdentities.length, 2)
  assert.equal(all.priceRequests.length, 2)
  const binder = projectInventoryCollection(snapshot, inventoryBrowseCatalog, "alpha")
  assert.deepEqual(binder.owned.map(i => i.itemId), ["copy-00001"])
  assert.equal(binder.wants.length, 2)
  assert.equal(projectInventoryCollection(snapshot, inventoryBrowseCatalog, "missing").owned.length, 0)
})

test("nullable catalog species, non-Pokémon and canonical price identities", () => {
  const snapshot = inventoryBrowseFixture()
  snapshot.items[0].identity = { kind: "card", cardId: "alias", language: "en", finish: "normal" }
  snapshot.items[1].identity = { kind: "card", cardId: "synthetic-trainer", language: "en", finish: "normal" }
  snapshot.items[2].identity = { kind: "card", cardId: "synthetic-energy", language: "en", finish: "normal" }
  const catalog = [{ card: { id: "printing", canonicalId: "canonical", aliasIds: ["alias"], localId: "1", name: "Synthetic Snorlax", language: "en" as const, set: { id: "synthetic", name: "Synthetic" } }, speciesNames: ["Snorlax"], pokemonIds: [143] },
    ...["trainer", "energy"].map(kind => ({ card: { id: `synthetic-${kind}`, localId: "2", name: `Synthetic ${kind}`, language: "en" as const, set: { id: "synthetic", name: "Synthetic" } }, speciesNames: [], pokemonIds: [] }))]
  const result = projectInventoryCollection(snapshot, catalog)
  assert.deepEqual(result.speciesIds, [6, 143])
  assert.deepEqual(result.owned[1].pokemonIds, [])
  assert.equal(result.owned[4].pokemonIds, null)
  assert.equal(result.owned[0].priceIdentity?.cardId, "canonical")
  snapshot.items[0].identity = { kind: "card", cardId: "alias" }
  assert.equal(projectInventoryCollection(snapshot, catalog).owned[0].priceIdentity, null)
})

test("one exact finish quote applies per raw copy, graded values remain unknown", () => {
  const snapshot = inventoryBrowseFixture(3)
  snapshot.items[1].grading = null
  const projection = projectInventoryCollection(snapshot, inventoryBrowseCatalog)
  const price = syntheticPrice()
  const value = valueInventoryCollection(projection, [price], "UK", Date.parse("2026-11-09T00:00:00Z"))
  assert.equal(value.rawTotalGbp, 20)
  assert.equal(value.rawPricedCopies, 2)
  assert.equal(value.gradedUnknownCopies, 1)
  assert.equal(value.copies[2].amountGbp, null)
  assert.equal(value.copies[2].referenceGbp, 10)
  assert.equal(value.copies[2].basis, "raw-reference")
  assert.equal(value.copies[0].quote?.confidence, "low")
  assert.equal(value.copies[0].quote?.updatedAt, "2026-09-01T00:00:00Z")
  assert.equal(value.copies[0].quote?.buySignal, null)
  price.finishPrices = []
  assert.equal(valueInventoryCollection(projection, [price], "UK").rawPricedCopies, 0)
})

function syntheticPrice(): import("@/lib/card-pricing").CardPriceSnapshot {
  const base = { cardId: "base1-4", language: "en" as const, gbpAmount: 999, marketGbpAmount: 999, goodGbpAmount: null,
    lowGbpAmount: null, highGbpAmount: null, confidence: "high" as const, sourcePrices: [], trendPoints: [], buySignal: null,
    originalAmount: null, originalCurrency: null, source: null, variantLabel: null, updatedAt: "2026-09-01T00:00:00Z", fxDate: null }
  return { ...base, finishPrices: [{ ...base, finish: "holo", variantKey: "holo", gbpAmount: 10, marketGbpAmount: 10 }] }
}

test("different finishes share one transport request and unknown/invalid amounts stay unknown", () => {
  const snapshot = inventoryBrowseFixture(3)
  snapshot.items.forEach(i => { i.grading = null })
  snapshot.items[1].identity = { kind: "card", cardId: "base1-4", language: "en", finish: "normal" }
  snapshot.items[2].identity = { kind: "card", cardId: "base1-4", language: "en" }
  const projection = projectInventoryCollection(snapshot, inventoryBrowseCatalog)
  assert.equal(projection.priceIdentities.length, 2)
  assert.equal(projection.priceRequests.length, 1)
  for (const amount of [0, -1, NaN, Infinity]) {
    const price = syntheticPrice()
    price.finishPrices![0].gbpAmount = amount
    assert.equal(valueInventoryCollection(projection, [price], "UK").rawPricedCopies, 0)
  }
  const result = valueInventoryCollection(projection, [], "UK")
  assert.equal(result.rawUnknownCopies, 3)
  assert.equal(result.rawPricedCopies, 0)
})
