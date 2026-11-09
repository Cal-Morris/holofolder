import { test } from "node:test"
import assert from "node:assert/strict"
import { fixture, owner, collection } from "./fixtures/inventory-read-server"
import { readOwnerInventoryState } from "../lib/server/inventory-read"
import { handleInventoryCompleteRead } from "../lib/server/inventory-read-http"
import { fetchCurrentCollectionNavigationRead } from "../lib/collection/inventory-navigation-read"
import { navigationLocation, navigationIndex } from "../lib/collection-navigation"
import { normalizeInventorySnapshot } from "../lib/domain/inventory"
import { createBinderBackupV2, parseBinderBackupV2, hydrateBackupSnapshot } from "../lib/binder-backup-v2"

const scope = { actorUserId: owner, ownerUserId: owner, authSessionId: "synthetic-auth-session", sessionId: "synthetic-lifecycle" }
function metadata() {
  const f = fixture(25)
  f.tables.storage_collection_state[0].kind = "custom"
  f.tables.storage_collection_state[0].default_presentation = "list"
  f.tables.storage_collection_state[0].location = "Synthetic cupboard"
  f.tables.binders[0].binder_rows = 2; f.tables.binders[0].binder_cols = null
  f.tables.user_settings = [{ user_id: owner, binder_rows: 3, binder_cols: 4, updated_at: "synthetic-settings-1" }]
  f.tables.inventory_items[0].legacy_source = { card_name: "Original synthetic", wanted_cards: [{ arbitrary: "preserve" }] }
  f.tables.binder_legacy_rows = [{ legacy_row_id: "synthetic-original", slot_id: "synthetic-00000", collection_id: collection, owner_user_id: owner,
    source_row: { id: "synthetic-original", pokemon_name: "Original synthetic", wanted_cards: [{ duplicate: true }, { duplicate: true }] } }]
  return f
}
test("private location and full immutable sources survive canonical normalization and JSON-v2", async () => {
  const f = metadata(), result = await readOwnerInventoryState(f.client)
  const normalized = normalizeInventorySnapshot(JSON.parse(JSON.stringify(result.snapshot)))!
  assert.equal(normalized.collections[0].location, "Synthetic cupboard")
  assert.deepEqual(normalized.items[0].legacySource, f.tables.inventory_items[0].legacy_source)
  assert.deepEqual(normalized.binders[0].slots[0].legacySource, { legacyRowId: "synthetic-original", sourceRow: f.tables.binder_legacy_rows[0].source_row })
  const backup = createBinderBackupV2({ snapshot: normalized, completeness: "complete-owner", scope: "all-inventory" })
  const roundTrip = hydrateBackupSnapshot(parseBinderBackupV2(JSON.stringify(backup)), owner)
  assert.deepEqual(roundTrip, normalized)
})
test("real binder overrides inherit owner dimensions individually and fence concurrent settings", async () => {
  const f = metadata()
  const first = await readOwnerInventoryState(f.client)
  assert.deepEqual(first.navigation.layouts, [{ collectionId: collection, layoutRevision: 4, rows: 2, cols: 4 }])
  let changed = false
  f.intercept(table => { if (table === "inventory_items" && !changed) { changed = true; f.tables.user_settings[0].binder_cols = 5 } })
  assert.equal((await readOwnerInventoryState(f.client)).navigation.layouts[0].cols, 5)
  let settingsChanges = 0
  f.intercept(table => { if (table === "inventory_items") f.tables.user_settings[0].updated_at = String(++settingsChanges) })
  await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_conflict" })
})
test("genuine JSON reconstruction supplies partner scope and stable-ID navigation", async () => {
  const f = metadata(), partner = "33333333-3333-4333-8333-333333333333"
  f.setActor(partner); f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
  const saved = globalThis.fetch
  try {
    globalThis.fetch = async (input, init) => handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test"), init), f.client)
    const result = await fetchCurrentCollectionNavigationRead(() => ({ ...scope, actorUserId: partner }))
    assert.equal(result.status, "complete")
    if (result.status !== "complete") return
    assert.equal(result.read.scope.accountUserId, partner)
    assert.equal(navigationIndex(result.read.scope, result.read).kind, "complete")
    const location = navigationLocation(result.read.scope, result.read, { itemId: "synthetic-00024", collectionId: "stale", slotId: "stale" })
    assert.equal(location.kind, "assigned")
    if (location.kind === "assigned") { assert.equal(location.page, 4); assert.equal(location.intent.slotId, "synthetic-00024") }
  } finally { globalThis.fetch = saved }
})

test("owner defaults are canonical, missing/invalid/ambiguous grid never locates a page", async () => {
  const f = fixture(1)
  assert.deepEqual((await readOwnerInventoryState(f.client)).navigation.layouts, [{ collectionId: collection, layoutRevision: 4, rows: 4, cols: 4 }])
  delete f.tables.binders[0].binder_cols
  assert.deepEqual((await readOwnerInventoryState(f.client)).navigation.layouts, [])
  f.tables.binders[0].binder_cols = 0
  assert.deepEqual((await readOwnerInventoryState(f.client)).navigation.layouts, [])
  f.tables.user_settings = [{ user_id: owner, binder_rows: 2, binder_cols: 3 }, { user_id: owner, binder_rows: 4, binder_cols: 4 }]
  await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_unavailable" })
})
test("changes to per-binder grid and settings during catalog reads cannot stamp unrelated layout evidence", async () => {
  for (const field of ["binder_rows", "binder_cols"]) {
    const f = metadata()
    f.intercept(table => { if (table === "tcg_cards") f.tables.binders[0][field] = Number(f.tables.binders[0][field] ?? 0) + 1 })
    await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_conflict" })
  }
})
test("catalog reads batch >1000 actual target/item IDs, retain non-Pokémon and known species, leave gaps unknown", async () => {
  const f = fixture(1031)
  f.tables.tcg_sets = [{ id: "synthetic-set", name_en: "Synthetic set" }]
  for (let i = 0; i < 1031; i++) {
    const id = `synthetic-card-${String(i).padStart(5, "0")}`
    f.tables.inventory_items[i].identity = { kind: "card", cardId: id, language: "en" }
    f.tables.tcg_cards.push({ id, set_id: "synthetic-set", local_id: String(i + 1), name_en: i % 2 ? "Synthetic Trainer" : "Synthetic Energy", name_json: { en: i % 2 ? "Synthetic Trainer" : "Synthetic Energy" }, external_ids_json: {} })
  }
  f.tables.tcg_card_dex_ids = [{ card_id: "synthetic-card-00000", dex_id: 25 }]
  const result = await readOwnerInventoryState(f.client)
  assert.equal(result.navigation.catalog.length, 1031)
  assert.deepEqual(result.navigation.catalog[0].speciesNames, ["Pikachu"])
  assert.deepEqual(result.navigation.catalog[0].pokemonIds, [25])
  assert.deepEqual(result.navigation.catalog[1].speciesNames, [])
  assert.ok(f.requests.filter(r => r.table === "tcg_cards").length > 10)
  assert.ok(f.requests.filter(r => /^tcg_/.test(r.table)).every(r => !r.url.searchParams.has("owner_user_id")))
  f.tables.tcg_cards.pop()
  const gap = await readOwnerInventoryState(f.client)
  assert.equal(gap.snapshot.items.length, 1031)
  assert.equal(gap.navigation.catalog.length, 1030)
  await assert.rejects(readOwnerInventoryState(f.client, { maxRequests: 10 }), { code: "inventory_read_unavailable" })
})
test("catalog dex associations page beyond 1000 and target-only cards are read", async () => {
  const f = fixture(1)
  f.tables.binder_slots[0].target = { kind: "card", cardId: "synthetic-target" }
  f.tables.tcg_cards = [{ id: "synthetic-target", set_id: "synthetic-set", local_id: "1", name_en: "Synthetic", name_json: { en: "Synthetic" }, external_ids_json: {} }]
  f.tables.tcg_sets = [{ id: "synthetic-set", name_en: "Synthetic set" }]
  f.tables.tcg_card_dex_ids = Array.from({ length: 1025 }, (_, i) => ({ card_id: "synthetic-target", dex_id: i + 1 }))
  const read = await readOwnerInventoryState(f.client)
  assert.equal(read.navigation.catalog[0].speciesNames.length, 1025)
  assert.deepEqual(read.navigation.catalog[0].pokemonIds, Array.from({ length: 1025 }, (_, i) => i + 1))
  assert.equal(f.requests.filter(r => r.table === "tcg_card_dex_ids").length, 3)
})
test("location omission stays unknown, null stays null, invalid locations fail and public projection redacts private metadata", async () => {
  const { normalizeStorageCollection } = await import("../lib/domain/inventory")
  const { publicCollectionItems } = await import("../lib/binder-share")
  const f = metadata(), result = await readOwnerInventoryState(f.client)
  const c = result.snapshot.collections[0]
  assert.equal(normalizeStorageCollection({ ...c, location: null })!.location, null)
  const { location: _location, ...old } = c
  assert.equal("location" in normalizeStorageCollection(old)!, false)
  for (const location of ["", " padded ", "x".repeat(201), 42]) assert.equal(normalizeStorageCollection({ ...c, location }), undefined)
  assert.equal(normalizeStorageCollection({ ...c, kind: "binder" }), undefined)
  const safe = navigationIndex({ accountUserId: owner, ownerUserId: owner, sessionId: scope.sessionId }, {
    scope: { accountUserId: owner, ownerUserId: owner, sessionId: scope.sessionId }, evidence: { kind: "complete", snapshot: result.snapshot }, ...result.navigation,
  })
  assert.ok(!JSON.stringify(safe).includes("Synthetic cupboard"))
  assert.ok(!JSON.stringify(safe).includes("Original synthetic"))
  const publicRows = publicCollectionItems([{ pokemon_id: 25, location: c.location, legacySource: result.snapshot.items[0].legacySource } as never])
  assert.ok(!JSON.stringify(publicRows).includes("Synthetic cupboard"))
  assert.ok(!JSON.stringify(publicRows).includes("Original synthetic"))
})
test("old v2 files preserve omitted metadata, malformed source input fails instead of stripping", async () => {
  const f = metadata(), { snapshot } = await readOwnerInventoryState(f.client)
  delete snapshot.collections[0].location
  snapshot.items.forEach(i => { delete i.legacySource })
  snapshot.binders.forEach(b => b.slots.forEach(s => { delete s.legacySource }))
  const backup = createBinderBackupV2({ snapshot, completeness: "complete-owner", scope: "all-inventory" })
  assert.deepEqual(hydrateBackupSnapshot(parseBinderBackupV2(JSON.stringify(backup)), owner), snapshot)
  const invalid = structuredClone(snapshot)
  Object.assign(invalid.items[0], { legacySource: { value: undefined } })
  assert.equal(normalizeInventorySnapshot(invalid), undefined)
})

test("partner inherits the actual owner grid, never their own settings", async () => {
  const f = metadata(), partner = "33333333-3333-4333-8333-333333333333"
  f.setActor(partner)
  f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
  f.tables.user_settings.push({ user_id: partner, binder_rows: 8, binder_cols: 8 })
  assert.deepEqual((await readOwnerInventoryState(f.client)).navigation.layouts, [{ collectionId: collection, layoutRevision: 4, rows: 2, cols: 4 }])
  f.tables.binders[0].binder_cols = 3
  assert.deepEqual((await readOwnerInventoryState(f.client)).navigation.layouts, [{ collectionId: collection, layoutRevision: 4, rows: 2, cols: 3 }])
})

test("adapter propagates genuine conflicts, unavailability and cached-only response rejection", async () => {
  const { readCurrentCollectionNavigation, CollectionNavigationReadError } = await import("../lib/collection/inventory-navigation-read")
  const saved = globalThis.fetch
  try {
    for (const [status, code] of [[409, "inventory_read_conflict"], [503, "inventory_operations_staged"]] as const) {
      globalThis.fetch = async () => Response.json({ error: code }, { status })
      await assert.rejects(readCurrentCollectionNavigation(() => scope), e => e instanceof CollectionNavigationReadError && e.code === code && e.status === (status === 409 ? "conflict" : "unavailable"))
    }
    globalThis.fetch = async () => Response.json({ cached: true }, { headers: { "cache-control": "public, max-age=60" } })
    assert.equal((await fetchCurrentCollectionNavigationRead(() => scope)).status, "unavailable")
  } finally { globalThis.fetch = saved }
})
test("untrusted/mismatched/duplicate layout evidence cannot reconstruct current navigation", async () => {
  const saved = globalThis.fetch
  try {
    for (const alter of [
      (b: Record<string, unknown>) => { const n = b.navigation as { layouts: { layoutRevision: number }[] }; n.layouts[0].layoutRevision++ },
      (b: Record<string, unknown>) => { const n = b.navigation as { layouts: unknown[] }; n.layouts.push(n.layouts[0]) },
      (b: Record<string, unknown>) => { delete b.navigation },
      (b: Record<string, unknown>) => { b.version = 1 },
    ]) {
      globalThis.fetch = async (input, init) => {
        const response = await handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test"), init), fixture(1).client)
        const json = await response.json(); alter(json)
        return Response.json(json, { headers: response.headers })
      }
      assert.equal((await fetchCurrentCollectionNavigationRead(() => scope)).status, "unavailable")
    }
  } finally { globalThis.fetch = saved }
})
test("copied preset manifests and source identities survive the private read and v2 serialization", async () => {
  const f = metadata(), source = { id: "synthetic-detached-preset", version: "old-version" }
  f.tables.storage_collection_state[0].preset_manifest = { source, name: "Synthetic copied preset", entries: [{ id: "original", target: { kind: "pokemon", pokemonId: 25 } }] }
  f.tables.binder_slots[0].preset_origin = { source, entryId: "original" }
  f.tables.binder_slots[0].target = { kind: "pokemon", pokemonId: 25 }
  const { snapshot } = await readOwnerInventoryState(f.client)
  const backup = createBinderBackupV2({ snapshot, completeness: "complete-owner", scope: "all-inventory" })
  assert.deepEqual(backup.binders[0].presetManifest, f.tables.storage_collection_state[0].preset_manifest)
  assert.deepEqual(backup.binders[0].slots[0].presetOrigin, f.tables.binder_slots[0].preset_origin)
  assert.deepEqual(hydrateBackupSnapshot(parseBinderBackupV2(JSON.stringify(backup)), owner), snapshot)
})
test("incomplete or changing immutable legacy-source streams never publish a result", async () => {
  const f = metadata()
  f.intercept((table, url) => table === "binder_legacy_rows" && url.searchParams.has("order") ? Response.json([]) : undefined)
  await assert.rejects(readOwnerInventoryState(f.client))
  let sourceChanges = 0
  f.intercept(table => { if (table === "tcg_cards") f.tables.binder_legacy_rows[0].source_row = { changed: ++sourceChanges } })
  await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_conflict" })
})

test("mirror canonical/alias identities resolve without treating legacy source JSON as catalog", async () => {
  const f = fixture(2)
  f.tables.inventory_items[0].identity = { kind: "card", cardId: "synthetic-alias", language: "en" }
  f.tables.inventory_items[1].identity = { kind: "card", cardId: "synthetic-canonical", language: "en" }
  f.tables.inventory_items[0].legacy_source = { card_name: "Forged catalog name", pokemon_id: 1 }
  f.tables.tcg_cards = [{ id: "synthetic-mirror", local_id: "1", name_en: "Synthetic Energy", name_json: { en: "Synthetic Energy" }, set_id: "synthetic-set",
    external_ids_json: { catalog: { canonicalId: "synthetic-canonical", aliasIds: ["synthetic-alias"] } } }]
  f.tables.tcg_sets = [{ id: "synthetic-set", name_en: "Synthetic set" }]
  const result = await readOwnerInventoryState(f.client)
  const index = navigationIndex({ accountUserId: owner, ownerUserId: owner, sessionId: scope.sessionId }, {
    scope: { accountUserId: owner, ownerUserId: owner, sessionId: scope.sessionId }, evidence: { kind: "complete", snapshot: result.snapshot }, ...result.navigation,
  })
  assert.deepEqual(index.rows.map(r => r.name), ["Synthetic Energy", "Synthetic Energy"])
  assert.deepEqual(index.rows.map(r => r.speciesNames), [[], []])
})

for (const kind of ["alias", "canonical"] as const) {
  test(`all ${kind} matches are paged before language-specific catalog resolution`, async () => {
    const f = fixture(1)
    f.tables.inventory_items[0].identity = { kind: "card", cardId: "synthetic-probe", language: "en" }
    f.tables.tcg_sets = [{ id: "synthetic-set", name_en: "Synthetic set" }]
    f.tables.tcg_cards = Array.from({ length: 501 }, (_, n) => ({
      id: `synthetic-mirror-${String(n).padStart(4, "0")}`, local_id: String(n), set_id: "synthetic-set",
      name_en: `Synthetic name ${n}`, name_json: { [n === 0 || n === 500 ? "en" : "fr"]: `Synthetic name ${n}` },
      external_ids_json: { catalog: kind === "alias" ? { aliasIds: ["synthetic-probe"] } : { canonicalId: "synthetic-probe" } },
    }))
    const result = await readOwnerInventoryState(f.client)
    const currentScope = { accountUserId: owner, ownerUserId: owner, sessionId: scope.sessionId }
    const index = navigationIndex(currentScope, { scope: currentScope, evidence: { kind: "complete", snapshot: result.snapshot }, ...result.navigation })
    assert.equal(index.rows[0].name, null, "a later English match makes the printing ambiguous")
    assert.equal(result.navigation.catalog.length, 501)
    assert.ok(f.requests.some(r => r.table === "tcg_cards" && r.url.searchParams.get("id")?.startsWith("gt.")))
    f.intercept((table, url) => {
      if (table === "tcg_cards" && url.searchParams.get("id")?.startsWith("gt.")) {
        return Response.json({ message: "Synthetic rejected catalog page" }, { status: 400 })
      }
    })
    await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_unavailable" })
  })
}


test("086 absent retains safe unknown partner inheritance and explicit per-dimension overrides", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const f = metadata(), partner = "33333333-3333-4333-8333-333333333333"
    f.setActor(partner); f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
    f.intercept(table => table === "inventory_grid_read_v1" ? Response.json({ code, message: "function public.inventory_grid_read_v1() does not exist" }, { status: 404 }) : undefined)
    assert.deepEqual((await readOwnerInventoryState(f.client)).navigation.layouts, [])
    f.tables.binders[0].binder_cols = 3
    assert.equal((await readOwnerInventoryState(f.client)).navigation.layouts[0].cols, 3)
    f.setActor(owner)
    f.tables.binders[0].binder_cols = null
    assert.equal((await readOwnerInventoryState(f.client)).navigation.layouts[0].cols, 4)
  }
})

test("RPC proves partner row absence, validates partial/malformed values and rejects denied reads", async () => {
  const f = metadata(), partner = "33333333-3333-4333-8333-333333333333"
  f.setActor(partner); f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
  f.tables.user_settings = [{ user_id: partner, binder_rows: 8, binder_cols: 8 }]
  assert.equal((await readOwnerInventoryState(f.client)).navigation.layouts[0].cols, 4)
  for (const settings of [{ binder_rows: 3 }, { binder_rows: 3, binder_cols: 0, updated_at: null },
    { binder_rows: 3, binder_cols: "4", updated_at: null }]) {
    f.intercept(table => table === "inventory_grid_read_v1" ? Response.json({ owner_user_id: owner, partnership: f.tables.partnerships[0], settings }) : undefined)
    if (!("binder_cols" in settings)) await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_unavailable" })
    else assert.deepEqual((await readOwnerInventoryState(f.client)).navigation.layouts, [])
  }
  f.intercept(table => table === "inventory_grid_read_v1" ? Response.json({ code: "42883", message: "function private_helper() does not exist" }, { status: 404 }) : undefined)
  await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_unavailable" })
  f.intercept(table => table === "inventory_grid_read_v1" ? Response.json({ code: "42501" }, { status: 403 }) : undefined)
  await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_unavailable" })
  assert.equal(f.requests.filter(r => r.table === "user_settings").length, 0)
})

test("partner owner grid and non-key membership changes during catalog work reject under the shared budget", async () => {
  for (const change of ["grid", "membership", "unlink"]) {
    const f = metadata(), partner = "33333333-3333-4333-8333-333333333333"
    f.setActor(partner); f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
    f.intercept(table => {
      if (table !== "tcg_cards") return
      if (change === "grid") f.tables.user_settings[0].binder_cols = Number(f.tables.user_settings[0].binder_cols) + 1
      if (change === "membership") f.tables.partnerships[0].user1_id = "44444444-4444-4444-8444-444444444444"
      if (change === "unlink") f.tables.partnerships = []
    })
    await assert.rejects(readOwnerInventoryState(f.client, { attempts: 1 }), { code: "inventory_read_conflict" })
  }
})


test("grid RPC auth failures preserve first-party status and never use the table fallback", async () => {
  for (const [message, status] of [["inventory_sign_in_required", 401], ["inventory_read_forbidden", 403]] as const) {
    const f = fixture(1)
    f.intercept(table => table === "inventory_grid_read_v1" ? Response.json({ code: "42501", message }, { status: 403 }) : undefined)
    await assert.rejects(readOwnerInventoryState(f.client), { code: message, status })
    assert.ok(f.requests.every(r => r.table !== "user_settings"))
  }
})
