import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { browserHostCatalog, browserHostDisplayCatalog } from "@/lib/collection/browser-host-catalog"
import { inventoryBrowseCatalog } from "./fixtures/inventory-browse"
import { parseNavigationEvidence } from "@/lib/collection/inventory-read-transport"
import { inventoryBrowseFixture, inventoryBrowseLayouts } from "./fixtures/inventory-browse"

describe("browser host catalog", () => {
  test("old display names cannot invent target membership", () => {
    assert.equal(browserHostCatalog(inventoryBrowseCatalog)("base1-4"), undefined)
  })
  test("translated metadata retains one printing and actual mirror dex identities", () => {
    const en = { ...inventoryBrowseCatalog[0], pokemonIds: [6] }
    const fr = { ...en, card: { ...en.card, name: "Dracaufeu", language: "fr" as const } }
    assert.deepEqual(browserHostCatalog([en, fr])("base1-4")?.pokemonIds, [6])
    assert.equal(browserHostCatalog([en, { ...fr, pokemonIds: [143] }])("base1-4"), undefined)
  })
  test("wire and device metadata preserve real dex links and reject malformed links", () => {
    const snapshot = inventoryBrowseFixture()
    const evidence = { layouts: inventoryBrowseLayouts, catalog: [{ ...inventoryBrowseCatalog[0], pokemonIds: [6] }] }
    assert.deepEqual(parseNavigationEvidence(evidence, snapshot)?.catalog[0].pokemonIds, [6])
    for (const pokemonIds of [[0], [6, 6], ["6"], [-1], [1.5]])
      assert.equal(parseNavigationEvidence({ ...evidence, catalog: [{ ...evidence.catalog[0], pokemonIds }] }, snapshot), undefined)
  })
})

test("host display resolves each recorded language and rejects ambiguous aliases", async () => {
  const { buildSlotDisplay } = await import("@/lib/binder-display-model")
  const snapshot = inventoryBrowseFixture()
  snapshot.items[1].identity = { kind: "card", cardId: "base1-4", language: "ja", finish: "holo" }
  const en = { ...inventoryBrowseCatalog[0], pokemonIds: [6] }
  const ja = { ...en, card: { ...en.card, name: "Synthetic Japanese title", language: "ja" as const } }
  const resolve = browserHostDisplayCatalog([en, ja])
  assert.equal(buildSlotDisplay(snapshot.binders[0], snapshot, resolve)[9].card?.name, en.card.name)
  assert.equal(buildSlotDisplay(snapshot.binders[1], snapshot, resolve)[9].card?.name, ja.card.name)
  assert.equal(resolve("base1-4", "fr"), undefined)
  const ambiguous = browserHostDisplayCatalog([en, { ...en, card: { ...en.card, id: "other-printing", aliasIds: ["base1-4"], name: "Ambiguous title" } }])
  assert.equal(ambiguous("base1-4", "en"), undefined)
  assert.equal(buildSlotDisplay(snapshot.binders[0], snapshot, ambiguous)[9].card?.name, "base1-4")
  const target = snapshot.binders[0].slots[0]
  target.target = { kind: "card", cardId: "base1-4", language: "ja" }
  assert.equal(buildSlotDisplay(snapshot.binders[0], snapshot, resolve)[0].card?.name, ja.card.name)
})
