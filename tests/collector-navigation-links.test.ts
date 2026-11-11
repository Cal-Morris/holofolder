import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { defaultCollectionView, normalizeInventoryViewState, normalizeNavigationState, resolveNavigation, type CollectionNavigationRead } from "../lib/collection-navigation"
import { buildInventoryBrowseIndex, queryInventory } from "../lib/inventory-query"
import { completeInventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "./fixtures/inventory-browse"

// Synthetic collection only (tests/fixtures/inventory-browse.ts).
const scope = { sessionId: "synthetic-session", accountUserId: "synthetic-owner", ownerUserId: "synthetic-owner" }
async function read(): Promise<CollectionNavigationRead> {
  return { scope, evidence: { kind: "complete", snapshot: await completeInventoryBrowseFixture() }, catalog: inventoryBrowseCatalog, layouts: inventoryBrowseLayouts }
}

describe("links and filters that used to work", () => {
  test("old view links open that view and leave the binder's own remembered view alone", async () => {
    const saved = normalizeNavigationState({ main: "collection", collectionId: "alpha", collections: { alpha: { ...defaultCollectionView(), view: "list", page: 3 } } })
    for (const view of ["wanted", "sets", "pokemon", "analytics"] as const) {
      const { state } = resolveNavigation(saved, scope, await read(), new URLSearchParams(`binder=alpha&view=${view}`))
      assert.equal(state.main, "dex", view)
      assert.equal(state.dexView, view)
      assert.equal(state.collectionId, "alpha")
      assert.equal(state.collections.alpha.view, "list")
      assert.equal(state.collections.alpha.page, 3)
    }
    // An unknown view name still opens the binder, as before.
    assert.equal(resolveNavigation(saved, scope, await read(), new URLSearchParams("binder=alpha&view=nonsense")).state.main, "collection")
  })

  test("Inventory can be narrowed to one page of one collection", async () => {
    const snapshot = await completeInventoryBrowseFixture()
    const index = buildInventoryBrowseIndex(scope, { kind: "complete", snapshot }, inventoryBrowseCatalog, inventoryBrowseLayouts)
    const placed = queryInventory(index, {}, null, 100).rows.filter(row => row.location.kind === "assigned" && row.location.page)
    assert.ok(placed.length > 0)
    for (const collectionId of new Set(placed.map(row => row.location.kind === "assigned" ? row.location.intent.collectionId : ""))) {
      const inCollection = placed.filter(row => row.location.kind === "assigned" && row.location.intent.collectionId === collectionId)
      let seen = 0
      for (const page of new Set(inCollection.map(row => row.location.kind === "assigned" ? row.location.page! : 0))) {
        const onPage = queryInventory(index, { collectionId, page }, null, 100)
        assert.ok(onPage.total > 0)
        assert.ok(onPage.rows.every(row => row.location.kind === "assigned" && row.location.intent.collectionId === collectionId && row.location.page === page))
        seen += onPage.total
      }
      assert.equal(seen, inCollection.length)
      assert.equal(queryInventory(index, { collectionId, page: 4000 }).total, 0)
    }
    const pages = [placed[0].location.kind === "assigned" ? placed[0].location.page! : 1]
    // A page without a collection means nothing and filters nothing.
    assert.equal(queryInventory(index, { page: pages[0] }).total, queryInventory(index, {}).total)
  })

  test("a saved Inventory page filter survives only as a whole page number", () => {
    assert.equal(normalizeInventoryViewState({ query: { collectionId: "alpha", page: 4 } }).query.page, 4)
    for (const page of [0, -1, 2.5, "4", null, 99999]) assert.equal(normalizeInventoryViewState({ query: { collectionId: "alpha", page } }).query.page, undefined)
  })
})
