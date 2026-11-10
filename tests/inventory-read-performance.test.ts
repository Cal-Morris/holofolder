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

function delayedClient(f: ReturnType<typeof fixture>, delays: (url: URL) => number, counted: (url: URL) => boolean = () => true) {
  let active = 0, peak = 0
  const client = createClient("https://synthetic.supabase.test", "synthetic-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)), counts = counted(url)
    if (counts) { active++; peak = Math.max(peak, active) }
    try {
      await new Promise(resolve => setTimeout(resolve, delays(url)))
      return await f.transport(input, init)
    } finally { if (counts) active-- }
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
  const delayed = delayedClient(f, url => url.searchParams.has("external_ids_json->catalog->aliasIds") ? 8 : 1)
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

// Synthetic owner with several binders, each needing two slot pages.
function binderStreamsFixture(binders = 6, slotsPer = 520) {
  const f = fixture(0), T = f.tables, owner = String(T.inventory_owner_state[0].owner_user_id)
  T.binders = []; T.storage_collection_state = []
  const collections = Array.from({ length: binders }, (_, i) => `synthetic-collection-${i}`)
  collections.forEach((id, i) => {
    T.binders.push({ id, owner_user_id: owner, name: `Synthetic ${i}`, is_default: i === 0, sort_order: i, binder_rows: null, binder_cols: null, updated_at: null })
    T.storage_collection_state.push({ collection_id: id, owner_user_id: owner, kind: "binder", default_presentation: "binder", version: 3, layout_revision: 4, authority: "slots", preset_manifest: null, location: null })
    for (let p = 0; p < slotsPer; p++) T.binder_slots.push({ id: `synthetic-slot-${i}-${String(p).padStart(4, "0")}`, owner_user_id: owner, collection_id: id,
      position: p, target: null, status: null, wanted_cards: [], preset_origin: null, version: 1 })
  })
  return { ...f, collections }
}
// delayedClient builds a fresh client, so carry over the fixture's synthetic auth.
function delayedBinders(f: ReturnType<typeof binderStreamsFixture>, delays: (url: URL) => number) {
  // Peak counts slot requests only: other streams legitimately overlap the four binder streams.
  const delayed = delayedClient(f, delays, url => url.pathname.endsWith("/binder_slots"))
  delayed.client.auth.getClaims = f.client.auth.getClaims
  delayed.client.auth.getUser = f.client.auth.getUser
  return delayed
}
const slotCollection = (table: string, url: URL) => table === "binder_slots" ? url.searchParams.get("collection_id")?.slice(3) ?? null : null

test("binder slot streams run four at a time and publish the same snapshot in collection order", async () => {
  const f = binderStreamsFixture()
  const expected = await readOwnerInventoryState(f.client, { attempts: 1 })
  const requests = f.requests.length
  // The first collection finishes last, so completion order differs from page order.
  const delayed = delayedBinders(f, url => slotCollection(url.pathname.split("/").at(-1)!, url) === f.collections[0] ? 15 : 1)
  const actual = await readOwnerInventoryState(delayed.client, { attempts: 1 })
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
  assert.deepEqual(actual.snapshot.binders.map(b => b.collectionId), f.collections)
  assert.equal(f.requests.length - requests, requests)
  assert.equal(delayed.peak(), 4)
})

test("initial metadata, legacy source and placement reads overlap without changing the state or failure order", async () => {
  const f = binderStreamsFixture(2, 10)
  const expected = await readOwnerInventoryState(f.client, { attempts: 1 })
  const requests = f.requests.length
  const metadataTable = (url: URL) => ["binders", "storage_collection_state"].includes(url.pathname.split("/").at(-1)!)
  // Metadata is slowest, so the other two initial reads finish first.
  const delayed = delayedBinders(f, url => metadataTable(url) ? 15 : 1)
  const actual = await readOwnerInventoryState(delayed.client, { attempts: 1 })
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
  assert.equal(f.requests.length - requests, requests)
  const landed = f.requests.slice(requests).map(r => r.table)
  for (const table of ["binder_legacy_rows", "inventory_placements"]) assert.ok(landed.indexOf(table) < landed.indexOf("binders"), `${table} overlaps metadata`)
  // Metadata fails last but was first in the serial order, so its error still wins, and nothing is left running.
  f.tables.storage_collection_state[0].authority = "legacy"
  f.intercept((table, _url, init) => table === "binder_legacy_rows" && init?.method !== "HEAD" ? Response.json({ message: "Synthetic failure" }, { status: 500 }) : undefined)
  await assert.rejects(readOwnerInventoryState(delayed.client, { attempts: 1 }), { message: "legacy_inventory_incomplete" })
  const settled = f.requests.length
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(f.requests.length, settled)
})

test("binder streams fail closed without starting queued streams after a failure", async () => {
  for (const failure of ["query", "count", "requests"] as const) {
    const f = binderStreamsFixture()
    const baseline = await readOwnerInventoryState(f.client, { attempts: 1 }).then(() => f.requests.length)
    f.requests.length = 0
    let counts = 0
    f.intercept((table, url, init) => {
      if (slotCollection(table, url) !== f.collections[0]) return
      if (failure === "query" && init?.method !== "HEAD") return Response.json({ message: "Synthetic failure" }, { status: 500 })
      // The per-stream count after the read moves, as if a slot was added mid-read.
      if (failure === "count" && init?.method === "HEAD" && ++counts === 2) return new Response(null, { headers: { "Content-Range": "0-0/521" } })
    })
    const delayed = delayedBinders(f, url => slotCollection(url.pathname.split("/").at(-1)!, url) === f.collections[0] ? 1 : 25)
    const maxRequests = failure === "requests" ? baseline - 20 : undefined
    await assert.rejects(readOwnerInventoryState(delayed.client, { attempts: 1, maxRequests }),
      { message: failure === "count" ? "inventory_read_conflict" : "inventory_read_unavailable" })
    const settled = f.requests.length
    await new Promise(resolve => setTimeout(resolve, 80))
    // The synthetic delay ignores the abort signal, so only the three already-active sibling requests may land.
    assert.ok(f.requests.length - settled <= 3, `${failure}: only active requests land after rejection`)
    if (failure !== "requests") for (const late of f.collections.slice(4))
      assert.ok(!f.requests.some(r => slotCollection(r.table, r.url) === late), `${failure}: queued stream ${late} never started`)
  }
})

test("a retried conflict does not leave the failed attempt's queued streams spending the shared budget", async () => {
  const f = binderStreamsFixture()
  let counts = 0
  f.intercept((table, url, init) => slotCollection(table, url) === f.collections[0] && init?.method === "HEAD" && ++counts === 2
    ? new Response(null, { headers: { "Content-Range": "0-0/521" } }) : undefined)
  const delayed = delayedBinders(f, url => slotCollection(url.pathname.split("/").at(-1)!, url) === f.collections[0] ? 1 : 25)
  const state = await readOwnerInventoryState(delayed.client, { attempts: 2 })
  assert.deepEqual(state.snapshot.binders.map(b => b.collectionId), f.collections)
  await new Promise(resolve => setTimeout(resolve, 150))
  // Count, two pages and the after-count, from the successful attempt only.
  assert.equal(f.requests.filter(r => slotCollection(r.table, r.url) === f.collections[5]).length, 4)
})

test("deadline abort stops active and queued binder streams", async () => {
  const f = binderStreamsFixture()
  const delayed = delayedBinders(f, url => url.pathname.endsWith("binder_slots") ? 30 : 1)
  await assert.rejects(readOwnerInventoryState(delayed.client, { attempts: 1, timeoutMs: 60 }), { message: "inventory_read_deadline" })
  const settled = f.requests.length
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.ok(f.requests.length - settled <= 4, "only already-active requests land after the deadline")
  assert.ok(!f.requests.some(r => slotCollection(r.table, r.url) === f.collections[5]))
})
