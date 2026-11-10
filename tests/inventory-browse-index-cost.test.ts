import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { projectInventoryCollection } from "@/lib/collection/inventory-projection"
import { navigationIndex, resolveNavigation, normalizeNavigationState, type CollectionNavigationRead } from "@/lib/collection-navigation"
import { buildInventoryBrowseIndex } from "@/lib/inventory-query"
import type { InventoryCatalogEvidence } from "@/lib/domain/inventory-browse"
import { completeInventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseFixture, inventoryBrowseLayouts } from "./fixtures/inventory-browse"

// Synthetic copies and synthetic catalog rows only (apart from the fixture's base1-4 coordinates).
const browseScope = { accountUserId: "synthetic-owner", ownerUserId: "synthetic-owner" }
const scope = { sessionId: "synthetic-session", ...browseScope }
const printing = (id: string, language: "en" | "ja", extra: Partial<InventoryCatalogEvidence["card"]> = {}, pokemonIds = [6]): InventoryCatalogEvidence => ({
  card: { id, name: `Synthetic ${id} ${language}`, localId: id, language, set: { id: "synthetic", name: "Synthetic set" },
    image: `https://assets.tcgdex.net/${language}/synthetic/synthetic/${id}/high.webp`, ...extra }, speciesNames: ["Charizard"], pokemonIds })
// Own IDs, a canonical ID, aliases, two languages of one printing, an ambiguous duplicate and an unrelated row.
const catalog: InventoryCatalogEvidence[] = [
  ...inventoryBrowseCatalog,
  printing("canon-row", "en", { canonicalId: "canon-1" }, [4]),
  printing("alias-row", "en", { aliasIds: ["alias-1", "alias-2"] }),
  printing("alias-row", "ja", { aliasIds: ["alias-1", "alias-2"] }),
  printing("dup", "en"), printing("dup", "en", { name: "Synthetic duplicate printing" }),
  printing("other", "en"),
]
const identities = [
  { kind: "card", cardId: "base1-4", language: "en", finish: "holo" }, { kind: "card", cardId: "canon-1", language: "en", finish: "normal" },
  { kind: "card", cardId: "alias-1" }, { kind: "pokemon", pokemonId: 6 }, { kind: "card", cardId: "synthetic-long", language: "en", finish: "holo" },
  { kind: "card", cardId: "dup", language: "en", finish: "normal" }, { kind: "card", cardId: "missing", language: "en", finish: "normal" },
  { kind: "card", cardId: "alias-2", language: "ja", finish: "normal" },
] as const
async function snapshot(count = identities.length) {
  const fixture = inventoryBrowseFixture(count)
  fixture.items.forEach((item, i) => { if (identities[i]) item.identity = { ...identities[i] } })
  return completeInventoryBrowseFixture(fixture)
}

describe("inventory browse index cost", () => {
  test("indexed catalog matching gives the same rows and projection as scanning the catalog per copy", async () => {
    const complete = await snapshot()
    const index = buildInventoryBrowseIndex(browseScope, { kind: "complete", snapshot: complete }, catalog, inventoryBrowseLayouts)
    // The scan this index replaced, kept here as the reference: catalog order, one match or nothing.
    const scanned = complete.items.map(item => {
      const identity = item.identity
      const matches = identity.kind === "card" ? catalog.filter(e => matchesCatalogCardId(e.card, identity.cardId)
        && (!identity.language || e.card.language === identity.language)) : []
      return matches.length === 1 ? matches[0] : undefined
    })
    assert.deepEqual(index.rows.map(r => [r.itemId, r.name, r.setName, r.setId, r.number, r.image]),
      complete.items.map((item, i) => [item.id, scanned[i]?.card.name ?? null, scanned[i]?.card.set.name ?? null, scanned[i]?.card.set.id ?? null,
        scanned[i]?.card.localId ?? null, scanned[i]?.card.image ?? null]))
    assert.deepEqual(index.rows.map(r => r.name), ["Charizard", "Synthetic canon-row en", null, null, inventoryBrowseCatalog[1].card.name, null, null, "Synthetic alias-row ja"])
    assert.deepEqual(index.projection?.owned.map(o => [o.itemId, o.pokemonIds, o.priceIdentity]), complete.items.map((item, i) => {
      const identity = item.identity, card = scanned[i]
      return [item.id, identity.kind === "pokemon" ? [identity.pokemonId] : card?.pokemonIds ?? null,
        identity.kind === "card" && identity.language && identity.finish && card
          ? { cardId: card.card.canonicalId ?? card.card.id, language: identity.language, finish: identity.finish } : null]
    }))
    // A caller without a prepared lookup, and a scoped projection, still get the same answer.
    assert.deepEqual(projectInventoryCollection(complete, catalog), index.projection)
    assert.deepEqual(projectInventoryCollection(complete, catalog, "alpha").owned.map(o => o.itemId), [complete.items[0].id])
  })

  test("the catalog is read once per build, not once per copy", async () => {
    let reads = 0
    const counted: InventoryCatalogEvidence[] = Array.from({ length: 300 }, (_, i) => {
      const entry = printing(`synthetic-${i}`, "en")
      return { ...entry, card: Object.defineProperty({ ...entry.card }, "id", { enumerable: true, get() { reads++; return `synthetic-${i}` } }) }
    })
    const complete = await completeInventoryBrowseFixture(inventoryBrowseFixture(200))
    const index = buildInventoryBrowseIndex(browseScope, { kind: "complete", snapshot: complete }, [...inventoryBrowseCatalog, ...counted], inventoryBrowseLayouts)
    assert.equal(index.rows.length, 200)
    assert.equal(index.rows[0].name, "Charizard")
    // 200 copies against 300 rows was 60,000 identity reads per pass; it is now a small multiple of the catalog.
    assert.ok(reads <= counted.length * 3, `catalog identity reads: ${reads}`)
  })

  test("navigation reuses one index per read and scope, and rebuilds for changed evidence or scope", async () => {
    const complete = await snapshot()
    const read: CollectionNavigationRead = { scope, evidence: { kind: "complete", snapshot: complete }, catalog, layouts: inventoryBrowseLayouts }
    const index = navigationIndex(scope, read)
    assert.equal(index.kind, "complete")
    assert.equal(navigationIndex(scope, read), index)
    assert.equal(navigationIndex({ ...scope }, read), index)
    const fresh = buildInventoryBrowseIndex(scope, read.evidence, read.catalog, read.layouts)
    assert.deepEqual(index, fresh)
    // Resolving a view uses the same index and leaves it untouched.
    const before = JSON.stringify(index)
    const resolved = resolveNavigation(normalizeNavigationState({ main: "collection", collectionId: "alpha" }), scope, read)
    assert.equal(resolved.state.collectionId, "alpha")
    assert.equal(navigationIndex(scope, read), index)
    assert.equal(JSON.stringify(index), before)

    // Another lifetime of the same account is not this read's scope: fail closed, without disturbing the original.
    const rotated = { ...scope, sessionId: "synthetic-session-2" }
    assert.equal(navigationIndex(rotated, read).kind, "unavailable")
    assert.equal(navigationIndex({ ...scope, accountUserId: "synthetic-partner" }, read).kind, "unavailable")
    // One index is kept per read, so the original scope is rebuilt once and then reused again.
    const again = navigationIndex(scope, read)
    assert.deepEqual(again, fresh)

    // New evidence is a new read object: a changed revision, catalog or evidence kind is never served from the old one.
    const changed = inventoryBrowseFixture(identities.length)
    changed.inventoryRevision = 2
    changed.items = changed.items.slice(0, 3)
    changed.placements = changed.placements.filter(p => changed.items.some(i => i.id === p.inventoryItemId))
    const next: CollectionNavigationRead = { ...read, evidence: { kind: "complete", snapshot: await completeInventoryBrowseFixture(changed) } }
    const nextIndex = navigationIndex(scope, next)
    assert.notEqual(nextIndex, index)
    assert.equal(nextIndex.rows.length, 3)
    assert.notEqual(nextIndex.key, index.key)
    const cached = navigationIndex(scope, { ...read, evidence: { kind: "cached", snapshot: complete } })
    assert.equal(cached.kind, "cached")
    assert.notEqual(cached.key, index.key)
    const renamed = navigationIndex(scope, { ...read, catalog: catalog.map(e => e.card.id === "canon-row" ? { ...e, card: { ...e.card, name: "Synthetic renamed" } } : e) })
    assert.equal(renamed.rows[1].name, "Synthetic renamed")
    assert.equal(index.rows[1].name, "Synthetic canon-row en")
    assert.equal(navigationIndex(scope, read), again)
    // Even a read edited in place is checked by its evidence, catalog, layouts and scope, not by the object alone.
    const edited = { ...read }
    assert.equal(navigationIndex(scope, edited).kind, "complete")
    edited.evidence = { kind: "unavailable" }
    assert.equal(navigationIndex(scope, edited).kind, "unavailable")
    edited.evidence = read.evidence
    edited.scope = { ...scope, ownerUserId: "synthetic-other-owner" }
    assert.equal(navigationIndex(scope, edited).kind, "unavailable")
  })
})
