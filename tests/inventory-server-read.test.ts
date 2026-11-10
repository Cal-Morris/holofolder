import { test } from "node:test"
import assert from "node:assert/strict"
import { fixture, owner, collection } from "./fixtures/inventory-read-server"
import { isCompleteInventorySnapshot } from "../lib/collection/slot-snapshot"
import { readOwnerInventorySnapshot } from "../lib/server/inventory-read"

test("authenticated table requests collect >1025 copies and ordered slots, then brand", async () => {
  const f = fixture()
  const snapshot = await readOwnerInventorySnapshot(f.client)
  assert.ok(isCompleteInventorySnapshot(snapshot))
  assert.equal(snapshot.items.length, 1031)
  assert.equal(snapshot.binders[0].slots.length, 1031)
  assert.equal(snapshot.collections[0].version, 3)
  assert.equal(snapshot.binders[0].layoutRevision, 4)
  assert.equal(snapshot.binders[0].slots.at(-1)?.version, 1030)
  assert.equal(snapshot.items[1].identity.kind, "card")
  const slotRequests = f.requests.filter(r => r.table === "binder_slots" && r.method !== "HEAD")
  assert.ok(slotRequests.length >= 3)
  assert.ok(f.requests.filter(r => r.method === "HEAD").every(r => r.headers.get("prefer")?.includes("count=exact")))
  assert.ok(slotRequests.every(r => r.url.searchParams.get("limit") === "500"))
  assert.ok(slotRequests.every(r => r.url.searchParams.get("order") === "position.asc" && r.url.searchParams.get("owner_user_id") === `eq.${owner}`))
  assert.ok(slotRequests.some(r => r.url.searchParams.get("position")?.startsWith("gt.")))
  assert.ok(f.requests.every(r => !r.url.search.includes("select=*") && !/slot_page|recovery|command_evidence/.test(r.url.href)))
})

test("zero slots do not make an existing binder an untouched new owner", async () => {
  const f = fixture(0)
  assert.ok(isCompleteInventorySnapshot(await readOwnerInventorySnapshot(f.client)))
  f.tables.inventory_owner_state = []
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: "inventory_not_initialized" })
})

test("legacy and missing schema are explicit unavailable boundaries", async () => {
  const f = fixture(0)
  f.tables.storage_collection_state[0].authority = "legacy"
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: "legacy_inventory_incomplete" })
  f.intercept(table => table === "inventory_owner_state" ? Response.json({ code: "42P01", message: "private details" }, { status: 404 }) : undefined)
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: "inventory_read_unavailable" })
})

test("forged caller owner is never accepted; actor and current partnership bind all reads", async () => {
  const f = fixture(0)
  const partner = "33333333-3333-4333-8333-333333333333"
  f.setActor(partner)
  f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
  assert.equal((await readOwnerInventorySnapshot(f.client)).ownerUserId, owner)
  f.tables.partnerships = []
  const unlinked = await readOwnerInventorySnapshot(f.client)
  assert.equal(unlinked.ownerUserId, partner)
  assert.equal(unlinked.inventoryRevision, 0)
  assert.deepEqual(unlinked.collections, [])
  f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
  f.deny()
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: "inventory_read_forbidden" })
  f.oauth()
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: "inventory_sign_in_required" })
})

test("missing item or placement cannot become a branded snapshot", async () => {
  for (const table of ["inventory_items", "inventory_placements", "storage_collection_state"]) {
    const f = fixture(2)
    f.tables[table].pop()
    await assert.rejects(readOwnerInventorySnapshot(f.client))
  }
})

test("revision change between streams restarts the entire snapshot with bounded attempts", async () => {
  const f = fixture(2)
  let changes = 0
  f.intercept(table => {
    if (table === "inventory_items" && changes++ === 0) f.tables.inventory_owner_state[0].inventory_revision = 8
  })
  assert.equal((await readOwnerInventorySnapshot(f.client)).inventoryRevision, 8)
  assert.equal(f.requests.filter(r => r.table === "inventory_items" && r.method === "HEAD").length, 4)
  f.intercept(table => { if (table === "inventory_items") f.tables.inventory_owner_state[0].inventory_revision = Number(f.tables.inventory_owner_state[0].inventory_revision) + 1 })
  await assert.rejects(readOwnerInventorySnapshot(f.client, { attempts: 2 }), { code: "inventory_read_conflict" })
})

test("partial pages, repeated IDs and deadline reject without publishing", async () => {
  const f = fixture(1031)
  f.intercept((table, url) => table === "inventory_items" && url.searchParams.has("id") ? Response.json([]) : undefined)
  await assert.rejects(readOwnerInventorySnapshot(f.client))
  const duplicate = fixture(3)
  duplicate.tables.inventory_items[1].id = duplicate.tables.inventory_items[0].id
  await assert.rejects(readOwnerInventorySnapshot(duplicate.client))
  await assert.rejects(readOwnerInventorySnapshot(fixture(0).client, { timeoutMs: 0 }), { code: "inventory_read_deadline" })
})

test("recorded grades and unknown printing identities survive without catalog/provider inference", async () => {
  const f = fixture(6)
  const providers = ["psa", "ace", "cgc", "beckett"]
  for (let i = 0; i < 5; i++) {
    f.tables.inventory_items[i].identity = { kind: "card", cardId: "synthetic-unknown-trainer" }
    f.tables.inventory_items[i].grading = { provider: i < 4 ? { kind: "known", id: providers[i] } : { kind: "custom", name: "Synthetic provider" },
      grade: "recorded not numeric", scale: "recorded", designation: null, subgrades: [{ name: "Surface", grade: "A" }], certificate: "synthetic-private-certificate",
      holder: "recorded", label: { variant: null, assetIds: ["synthetic-private-label-id"] } }
    f.tables.inventory_items[i].legacy_source = { original: "synthetic private source" }
  }
  const result = await readOwnerInventorySnapshot(f.client)
  assert.deepEqual(result.items.map(i => i.grading), f.tables.inventory_items.map(i => i.grading))
  assert.ok(f.requests.every(r => !/provider|certificate/.test(r.table)))
  assert.deepEqual(result.items[0].legacySource, { original: "synthetic private source" })
})

test("spacers, empty collections and initialized empty owner retain honest zero state", async () => {
  const f = fixture(0)
  f.tables.binder_slots.push({ id: "synthetic-spacer", owner_user_id: owner, collection_id: collection, position: 20, target: null, status: null, wanted_cards: [], preset_origin: null, version: 0 })
  assert.equal((await readOwnerInventorySnapshot(f.client)).binders[0].slots[0].inventoryItemId, null)
  f.tables.binder_slots = []; f.tables.binders = []; f.tables.storage_collection_state = []
  const empty = await readOwnerInventorySnapshot(f.client)
  assert.equal(empty.items.length, 0)
  assert.equal(empty.collections.length, 0)
  assert.ok(isCompleteInventorySnapshot(empty))
})

test("owner change, unlink and billing permission loss during a read reject the whole result", async () => {
  for (const change of ["unlink", "billing", "actor"]) {
    const f = fixture(2), partner = "33333333-3333-4333-8333-333333333333"
    f.setActor(partner)
    f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
    f.intercept(table => {
      if (table !== "inventory_items") return
      if (change === "unlink") f.tables.partnerships = []
      if (change === "billing") f.deny()
      if (change === "actor") f.setActor("44444444-4444-4444-8444-444444444444")
    })
    await assert.rejects(readOwnerInventorySnapshot(f.client))
  }
})

test("metadata versions, counts and names changing between streams restart all reads", async () => {
  for (const field of ["version", "layout_revision", "name"]) {
    const f = fixture(2)
    let changed = false
    // The item page read follows the overlapped initial reads, so metadata has already been read once.
    f.intercept((table, _url, init) => {
      if (table !== "inventory_items" || init?.method === "HEAD" || changed) return
      changed = true
      if (field === "name") f.tables.binders[0].name = "Synthetic renamed"
      else f.tables.storage_collection_state[0][field] = 19
    })
    const snapshot = await readOwnerInventorySnapshot(f.client)
    if (field === "name") assert.equal(snapshot.collections[0].name, "Synthetic renamed")
    else if (field === "version") assert.equal(snapshot.collections[0].version, 19)
    else assert.equal(snapshot.binders[0].layoutRevision, 19)
    assert.equal(f.requests.filter(r => r.table === "inventory_items" && r.method === "GET").length, 2)
  }
})

test("actual PostgREST permission errors sanitize private details without legacy fallback", async () => {
  const f = fixture(0)
  f.intercept(table => table === "inventory_items" ? Response.json({ code: "42501", message: "synthetic-private-provider-data" }, { status: 403 }) : undefined)
  await assert.rejects(readOwnerInventorySnapshot(f.client), error => {
    assert.equal((error as Error).message, "inventory_read_unavailable")
    return true
  })
  assert.ok(f.requests.every(r => r.table !== "pokemon_collection"))
})

test("request budget and a hanging session obey bounded deadline", async () => {
  await assert.rejects(readOwnerInventorySnapshot(fixture(0).client, { maxRequests: 4 }), { code: "inventory_read_unavailable" })
  const f = fixture(0)
  f.client.auth.getClaims = () => new Promise(() => {})
  await assert.rejects(readOwnerInventorySnapshot(f.client, { timeoutMs: 10 }), { code: "inventory_read_deadline" })
})

test("a new invocation reads freshly current owner state, not an older retained snapshot", async () => {
  const f = fixture(2)
  const first = await readOwnerInventorySnapshot(f.client)
  f.tables.inventory_owner_state[0].inventory_revision = 8
  f.tables.inventory_items[0].version = 30
  const second = await readOwnerInventorySnapshot(f.client)
  assert.equal(first.inventoryRevision, 7)
  assert.equal(second.inventoryRevision, 8)
  assert.equal(second.items[0].version, 30)
})

test("forged owner/actor options cannot redirect the authenticated read", async () => {
  const f = fixture(0)
  const forged = "99999999-9999-4999-8999-999999999999"
  const options = { attempts: 1, ownerUserId: forged, actorId: forged }
  assert.equal((await readOwnerInventorySnapshot(f.client, options)).ownerUserId, owner)
  assert.ok(f.requests.every(r => !r.url.href.includes(forged)))
})

test("all storage kinds, collection streams beyond 1000 and independent layouts map without invented slots", async () => {
  const f = fixture(0)
  f.tables.binders = []; f.tables.storage_collection_state = []
  for (let n = 0; n < 1031; n++) {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
    f.tables.binders.push({ id, owner_user_id: owner, name: `Synthetic ${n}` })
    f.tables.storage_collection_state.push({ collection_id: id, owner_user_id: owner, kind: ["binder", "slab", "custom"][n % 3],
      default_presentation: ["binder", "slabs", "list"][n % 3], version: n, layout_revision: n + 1, authority: "slots", preset_manifest: null, location: null })
  }
  const result = await readOwnerInventorySnapshot(f.client, { maxRequests: 4096, timeoutMs: 30_000 })
  assert.equal(result.collections.length, 1031)
  assert.equal(result.binders.length, 1031)
  assert.equal(result.items.length, 0)
  assert.equal(result.collections[1].kind, "slab")
  assert.equal(result.collections[2].defaultPresentation, "list")
  assert.equal(result.binders.at(-1)?.layoutRevision, 1031)
})

test("orphan storage rows, cross-owner rows and nonincreasing positions fail closed", async () => {
  for (const mode of ["orphan", "owner", "position"]) {
    const f = fixture(3)
    if (mode === "orphan") { f.tables.binders = []; f.tables.storage_collection_state = [] }
    if (mode === "owner") {
      f.intercept((table, url) => table === "inventory_items" && url.searchParams.has("order") ? Response.json([{ ...f.tables.inventory_items[0], owner_user_id: "other" }]) : undefined)
    }
    if (mode === "position") f.tables.binder_slots[1].position = 0
    await assert.rejects(readOwnerInventorySnapshot(f.client))
  }
})

test("a row count changing without a matching complete stream fails explicitly", async () => {
  const f = fixture(2)
  f.intercept((table, url) => {
    if (table === "inventory_items" && url.searchParams.has("order")) f.tables.inventory_items.push({ ...f.tables.inventory_items[0], id: "synthetic-new-unassigned" })
  })
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: "inventory_read_unavailable" })
})

test("session mismatch and unavailable billing policy cannot start inventory reads", async () => {
  const f = fixture(0)
  f.client.auth.getUser = async () => ({ data: { user: { id: "other-actor" } }, error: null }) as never
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: "inventory_sign_in_required" })
  assert.equal(f.requests.length, 0)
  const missing = fixture(0)
  missing.intercept(table => table === "billing_partner_allowed" ? Response.json({ code: "PGRST202", message: "missing policy" }, { status: 404 }) : undefined)
  await assert.rejects(readOwnerInventorySnapshot(missing.client), { code: "inventory_read_unavailable" })
  assert.ok(missing.requests.every(r => r.table === "partnerships" || r.table === "billing_partner_allowed"))
  const stranger = fixture(0)
  stranger.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: "other-actor", user2_id: "another-actor" }]
  await assert.rejects(readOwnerInventorySnapshot(stranger.client), { code: "inventory_read_forbidden" })
})
