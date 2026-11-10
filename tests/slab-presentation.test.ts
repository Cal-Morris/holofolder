import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { selectSlabStyle, slabPresentation, slabCatalogImage, SLAB_STYLES } from "../lib/slabs/presentation"
import { slabCollectionCopies } from "../lib/slabs/collection"
import { navigationIndex, normalizeNavigationState, resolveNavigation, type CollectionNavigationRead } from "../lib/collection-navigation"
import { completeInventoryBrowseFixture, inventoryBrowseLayouts } from "./fixtures/inventory-browse"
import { slabFixture, slabCatalog } from "./fixtures/slabs"
const scope = { sessionId: "synthetic-session", accountUserId: "synthetic-owner", ownerUserId: "synthetic-owner" }
async function read(): Promise<CollectionNavigationRead> {
  return { scope, evidence: { kind: "complete", snapshot: await completeInventoryBrowseFixture(slabFixture()) }, catalog: slabCatalog, layouts: inventoryBrowseLayouts }
}
describe("recorded slab presentation", () => {
  test("every explicit provider/holder/label selects its supported layout", () => {
    const items = slabFixture().items
    for (const item of items.slice(0, 9).filter((_, i) => i !== 5)) assert.equal(selectSlabStyle(item.grading), item.grading!.label.variant)
    assert.equal(selectSlabStyle(items[5].grading), "neutral")
    assert.equal(new Set(items.slice(0, 9).filter((_, i) => i !== 5).map(i => selectSlabStyle(i.grading))).size, Object.keys(SLAB_STYLES).length)
  })
  test("grade 10 and four 10 subgrades never infer Black Label, Pristine, holder or version", () => {
    const record = slabFixture().items[8].grading!
    assert.equal(selectSlabStyle({ ...record, label: { variant: null, assetIds: [] } }), "neutral")
    assert.equal(selectSlabStyle({ ...record, label: { variant: "beckett-gold", assetIds: [] } }), "beckett-gold")
    assert.equal(selectSlabStyle({ ...record, holder: "unknown" }), "neutral")
    assert.equal(selectSlabStyle({ ...record, provider: { kind: "known", id: "psa" } }), "neutral")
    const cgc = slabFixture().items[4].grading!
    assert.equal(selectSlabStyle({ ...cgc, holder: "cgc-2025" }), "neutral")
    assert.equal(cgc.grade, "9.5")
  })
  test("safe DTO preserves entered metadata, missing values, identity and catalog fallback, and leaves ungraded cards out", async () => {
    const r = await read(), copies = slabCollectionCopies(scope, r, "alpha")
    // 15 placed copies in the synthetic fixture, one of them ungraded: a card without a grade is not a slab.
    assert.equal(copies.length, 14)
    assert.ok(copies.every(c => c.slab.style !== "raw"))
    assert.equal(copies[4].slab.grade, "9.5")
    assert.equal(copies[9].slab.style, "neutral"); assert.equal(copies[9].slab.grade, "10")
    assert.equal(copies[12].slab.grade, null); assert.deepEqual(copies[12].slab.subgrades, [])
    assert.equal(copies[13].slab.image, null)
    assert.ok(copies[0].slab.image)
    assert.match(copies[11].slab.note!, /artwork unavailable/)
    assert.doesNotMatch(JSON.stringify(copies), /SYNTHETIC-PRIVATE|certificate|assetIds|ownerUserId|legacySource/)
    assert.equal(new Set(copies.map(c => c.itemId)).size, copies.length)
    const row = navigationIndex(scope, r).rows[0], record = slabFixture().items[0].grading!
    const original = structuredClone(record)
    slabPresentation(row, record)
    assert.deepEqual(record, original)
  })
  test("image input cannot become a private photo, certificate URL, data URL or query channel", () => {
    for (const url of ["https://www.psacard.com/cert/12345678/psa", "https://private.example/photo.jpg", "data:image/png;base64,abc", "https://assets.tcgdex.net/en/base/base1/4/high.webp?cert=private", "https://assets.holofolder.com/cards/a.webp#private"])
      assert.equal(slabCatalogImage(url), null)
  })
  test("custom color selection is bounded and never restyles an unsupported known holder", async () => {
    const r = await read(), row = navigationIndex(scope, r).rows[0], record = slabFixture().items[11].grading!
    assert.equal(slabPresentation(row, { ...record, label: { variant: "custom-teal", assetIds: [] } }).tint, "teal")
    assert.equal(slabPresentation(row, { ...record, label: { variant: "url(private)", assetIds: [] } }).tint, "slate")
    assert.equal(slabPresentation(row, { ...record, provider: { kind: "known", id: "psa" }, label: { variant: "custom-teal", assetIds: [] } }).tint, "slate")
  })
  test("gallery fences exact session/account/owner, allows linked partner, displays cached subset honestly", async () => {
    const r = await read()
    for (const next of [{ ...scope, sessionId: "relinked" }, { ...scope, accountUserId: "other" }, { ...scope, ownerUserId: "other" }]) assert.deepEqual(slabCollectionCopies(next, r, "alpha"), [])
    assert.deepEqual(slabCollectionCopies(scope, r, "unknown"), [])
    assert.deepEqual(slabCollectionCopies(scope, JSON.parse(JSON.stringify(r)), "alpha"), [])
    r.scope = { ...scope, accountUserId: "partner" }
    assert.equal(slabCollectionCopies(r.scope, r, "alpha").length, 14)
    r.evidence = { kind: "cached", snapshot: slabFixture() }
    assert.equal(slabCollectionCopies(r.scope, r, "alpha").length, 14)
  })
  test("staged view restores locally; deep targets win; default and hosted admission remain denied", async () => {
    const r = await read(), saved = normalizeNavigationState({ main: "collection", collectionId: "alpha", collections: { alpha: { view: "slabs", search: "charizard", scroll: 400 } } })
    assert.equal(resolveNavigation(saved, scope, r, undefined, true).state.collections.alpha.view, "slabs")
    assert.equal(resolveNavigation(saved, scope, r).state.collections.alpha.view, "binder")
    assert.match(resolveNavigation(saved, scope, r).notice, /not available/)
    assert.equal(resolveNavigation(saved, scope, r, new URLSearchParams("binder=alpha&view=slabs"), true).state.collections.alpha.view, "slabs")
    assert.equal(resolveNavigation(saved, scope, r, new URLSearchParams("binder=alpha&view=slabs&page=1"), true).state.collections.alpha.view, "binder")
    assert.doesNotMatch(JSON.stringify(saved), /certificate|asset|selectedId/)
  })
})
