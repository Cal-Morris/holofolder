import { test } from "node:test"
import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"
import { normalizeInventorySnapshot, type InventorySnapshot } from "@/lib/domain/inventory"
import { readInventoryCatalog } from "@/lib/server/inventory-read-catalog"
import { readOwnerInventoryState } from "@/lib/server/inventory-read"
import { navigationIndex } from "@/lib/collection-navigation"
import { inventoryBrowseFixture } from "./fixtures/inventory-browse"
import { fixture } from "./fixtures/inventory-read-server"

test("indexed snapshot validation retains every owner, duplicate and placement bijection check", () => {
  const valid = inventoryBrowseFixture()
  assert.deepEqual(normalizeInventorySnapshot(valid), valid)
  const changes: Array<(s: InventorySnapshot) => void> = [
    s => { s.items.push(s.items[0]) },
    s => { s.collections.push(s.collections[0]) },
    s => { s.binders.push(s.binders[0]) },
    s => { s.collections.pop() },
    s => { s.binders.pop() },
    s => { s.collections[0].id = "missing" },
    s => { s.items[0].ownerUserId = "foreign" },
    s => { s.collections[0].ownerUserId = "foreign" },
    s => { s.binders[0].ownerUserId = "foreign" },
    s => { s.binders[0].slots[0].ownerUserId = "foreign" },
    s => { s.binders[0].slots[0].collectionId = "foreign" },
    s => { s.binders[1].slots[0].id = s.binders[0].slots[0].id },
    s => { s.placements.push(s.placements[0]) },
    s => { s.placements[1].inventoryItemId = s.placements[0].inventoryItemId },
    s => { s.placements[1].slotId = s.placements[0].slotId },
    s => { s.placements[0].inventoryItemId = "missing" },
    s => { s.placements[0].slotId = "missing" },
    s => { s.placements[0].collectionId = s.collections[1].id },
    s => { s.placements.pop() },
    s => { s.binders[0].slots[9].inventoryItemId = s.items[4].id },
    s => { s.placements[0].version = -1 },
  ]
  for (const [index, change] of changes.entries()) {
    const bad = structuredClone(valid)
    change(bad)
    assert.equal(normalizeInventorySnapshot(bad), undefined, `malformed case ${index}`)
  }
  const opaque = structuredClone(valid)
  opaque.items[0].id = opaque.placements[0].inventoryItemId = opaque.binders[0].slots[9].inventoryItemId = "__proto__"
  opaque.placements[0].slotId = opaque.binders[0].slots[9].id = "constructor"
  assert.deepEqual(normalizeInventorySnapshot(opaque), opaque)
})

function catalogFixture(count: number) {
  const f = fixture(0), snapshot = inventoryBrowseFixture(count)
  snapshot.binders = []; snapshot.collections = []; snapshot.placements = []
  snapshot.items.forEach((item, i) => { item.identity = { kind: "card", cardId: `synthetic-card-${String(i).padStart(4, "0")}`, language: "en" } })
  f.tables.tcg_sets = [{ id: "synthetic-set", name_en: "Synthetic set" }]
  f.tables.tcg_cards = snapshot.items.map((item, i) => ({ id: item.identity.kind === "card" ? item.identity.cardId : "", set_id: "synthetic-set", local_id: String(i), name_en: `Synthetic ${i}`, name_json: { en: `Synthetic ${i}` }, external_ids_json: {} }))
  return { ...f, snapshot }
}

function delayedClient(f: ReturnType<typeof fixture>, delays: (url: URL) => number) {
  let active = 0, peak = 0
  const client = createClient("https://synthetic.supabase.test", "synthetic-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    active++; peak = Math.max(peak, active)
    try {
      await new Promise(resolve => setTimeout(resolve, delays(new URL(String(input)))))
      return await f.transport(input, init)
    } finally { active-- }
  } } })
  return { client, peak: () => peak }
}
const readCatalog = (f: ReturnType<typeof catalogFixture>, client = f.client) => readInventoryCatalog(client, f.snapshot, new AbortController().signal, () => {})

test("independent catalog batches finish out of order without changing evidence order or exceeding four requests", async () => {
  const f = catalogFixture(401)
  const expected = await readCatalog(f)
  const delayed = delayedClient(f, url => url.search.includes("0000") ? 12 : 1)
  assert.deepEqual(await readCatalog(f, delayed.client), expected)
  assert.equal(delayed.peak(), 4)
})

test("alias/canonical fallback completion order cannot pick an ambiguous printing, including later pages", async () => {
  const f = catalogFixture(2)
  f.snapshot.items.forEach(item => { item.identity = { kind: "card", cardId: "synthetic-probe", language: "en" } })
  f.tables.tcg_cards = Array.from({ length: 501 }, (_, i) => ({
    id: `synthetic-mirror-${String(i).padStart(4, "0")}`, set_id: "synthetic-set", local_id: String(i), name_en: `Synthetic ${i}`,
    name_json: { [i === 0 || i === 500 ? "en" : "fr"]: `Synthetic ${i}` },
    external_ids_json: { catalog: { aliasIds: ["synthetic-probe"], canonicalId: "synthetic-probe" } },
  }))
  const expected = await readCatalog(f)
  const delayed = delayedClient(f, url => url.searchParams.has("external_ids_json") ? 8 : 1)
  const catalog = await readCatalog(f, delayed.client)
  assert.deepEqual(catalog, expected)
  assert.equal(catalog.length, 501)
  const scope = { accountUserId: f.snapshot.ownerUserId, ownerUserId: f.snapshot.ownerUserId, sessionId: "synthetic-session" }
  // Use the real complete-read boundary to exercise ambiguity resolution.
  const { completeInventoryBrowseFixture } = await import("./fixtures/inventory-browse")
  const snapshot = await completeInventoryBrowseFixture(f.snapshot)
  assert.ok(navigationIndex(scope, { scope, evidence: { kind: "complete", snapshot }, catalog, layouts: [] }).rows.every(row => row.name === null))
  f.intercept((table, url) => table === "tcg_cards" && url.searchParams.has("id") && url.searchParams.get("id")!.startsWith("gt.")
    ? Response.json([f.tables.tcg_cards[0]]) : undefined)
  await assert.rejects(readCatalog(f, delayed.client), /inventory_read_unavailable/)
})

test("parallel metadata reads still reject count, metadata and revision races before publication", async () => {
  for (const kind of ["count", "metadata", "revision"] as const) {
    const f = fixture(2)
    f.intercept((table, _url, init) => {
      if (table !== "storage_collection_state" || init?.method !== "HEAD") return
      if (kind === "count") return new Response(null, { headers: { "Content-Range": "0-0/2" } })
      if (kind === "metadata") f.tables.storage_collection_state[0].layout_revision = Number(f.tables.storage_collection_state[0].layout_revision) + 1
      if (kind === "revision") f.tables.inventory_owner_state[0].inventory_revision = Number(f.tables.inventory_owner_state[0].inventory_revision) + 1
    })
    await assert.rejects(readOwnerInventoryState(f.client, { attempts: 1 }))
  }
})

test("catalog concurrency never publishes partial evidence after a page error or shared budget failure", async () => {
  for (const failure of ["query", "requests", "bytes"] as const) {
    const f = catalogFixture(401)
    if (failure === "query") f.intercept((table, url) => table === "tcg_cards" && url.search.includes("0100")
      ? Response.json({ message: "Synthetic failure" }, { status: 500 }) : undefined)
    let requests = 0
    await assert.rejects(readInventoryCatalog(f.client, f.snapshot, new AbortController().signal,
      () => { if (failure === "requests" && ++requests > 2) throw new Error("synthetic-request-budget") },
      () => { if (failure === "bytes") throw new Error("synthetic-byte-budget") }))
  }
})
