import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { browserHostCatalog } from "@/lib/collection/browser-host-catalog"
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
