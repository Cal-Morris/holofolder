import { describe, test } from "node:test"
import assert from "node:assert/strict"
import type { SupabaseClient } from "@supabase/supabase-js"
import { selectTrackedPriceLookups } from "../lib/server/tracked-price-selection"
import { trackedPriceIdentity, trackedPriceRequests } from "../lib/tracked-price-identity"

// All IDs, identities and records below are synthetic; no database/provider access.
type Row = Record<string, unknown>
function fixtures() {
  return {
    inventory_owner_state: [{ owner_user_id: "owner", inventory_revision: 3 }],
    storage_collection_state: [{ collection_id: "native", owner_user_id: "owner", authority: "slots", conversion_version: 1, version: 2, layout_revision: 1 }],
    binders: [{ id: "native", owner_user_id: "owner" }, { id: "legacy", owner_user_id: "owner" }],
    pokemon_collection: [
      { id: "frozen", user_id: "owner", binder_id: "native", card_id: "stale", card_language: "en", card_finish: null, wanted_cards: [] },
      { id: "old", user_id: "owner", binder_id: "legacy", card_id: "legacy-card", card_language: null, card_finish: null, wanted_cards: [{ card_id: "legacy-want", card_language: " FR " }] },
    ],
    inventory_items: [
      { id: "unassigned-trainer", owner_user_id: "owner", identity: { kind: "card", cardId: "trainer", language: "ja", finish: "holo" } },
      { id: "copy-two", owner_user_id: "owner", identity: { kind: "card", cardId: "trainer", language: "ja", finish: "reverse_holo" } },
      { id: "unknown", owner_user_id: "owner", identity: { kind: "card", cardId: "no-language" } },
      { id: "species", owner_user_id: "owner", identity: { kind: "pokemon", pokemonId: 1 } },
    ],
    binder_slots: [
      { id: "empty-target", target: { kind: "card", cardId: "not-an-owned-or-wanted-card" }, owner_user_id: "owner", collection_id: "native", wanted_cards: [] },
      { id: "want", owner_user_id: "owner", collection_id: "native", wanted_cards: [{ card_id: "energy", card_language: "de", card_finish: "normal" }] },
    ],
  } as Record<string, Row[]>
}
interface Call { table: string; projection: string; filters: [string, unknown][]; from: number; to: number; key: string }
function database(data = fixtures(), alter?: (call: Call, result: { data: Row[] | null; count: number | null; error: { code: string } | null }) => void) {
  const calls: Call[] = []
  const sorted = new Map<string, Row[]>()
  const client = { from(table: string) {
    const call: Call = { table, projection: "", filters: [], from: 0, to: 0, key: "" }
    const builder = {
      select(projection: string, options: unknown) { assert.deepEqual(options, { count: "exact" }); call.projection = projection; return builder },
      order(key: string) { call.key = key; return builder },
      range(from: number, to: number) { call.from = from; call.to = to; return builder },
      eq(key: string, value: unknown) { call.filters.push([key, value]); return builder },
      async abortSignal(signal: AbortSignal) {
        assert.equal(signal.aborted, false)
        calls.push(call)
        const cacheKey = JSON.stringify([table, call.filters, call.key])
        if (!sorted.has(cacheKey)) sorted.set(cacheKey, (data[table] ?? []).filter(r => call.filters.every(([k, v]) => r[k] === v)).sort((a, b) => String(a[call.key]).localeCompare(String(b[call.key]))))
        const rows = sorted.get(cacheKey)!
        const result = { data: rows.slice(call.from, call.to + 1).map(r => Object.fromEntries(call.projection.split(",").map(k => [k, r[k]]))), count: rows.length, error: null } as { data: Row[] | null; count: number | null; error: { code: string } | null }
        alter?.(call, result)
        return result
      },
    }
    return builder
  } } as unknown as SupabaseClient
  return { client, calls }
}

describe("tracked price authority selection", () => {
  test("mixed authority includes Unassigned/non-Pokémon and explicit wants, excludes frozen/empty targets and deduplicates transport", async () => {
    const db = database()
    assert.deepEqual(await selectTrackedPriceLookups(db.client, "owner"), [
      { cardId: "legacy-card", language: "en" }, { cardId: "legacy-want", language: "fr" },
      { cardId: "trainer", language: "ja" }, { cardId: "energy", language: "de" },
    ])
    for (const call of db.calls) {
      assert.deepEqual(call.filters, [[call.table === "pokemon_collection" ? "user_id" : "owner_user_id", "owner"]])
      assert.equal(call.to - call.from, 499)
    }
    assert.ok(!db.calls.some(c => c.table === "inventory_placements"))
  })
  test("pages every stream beyond 1000, including lifetime copies and duplicate quote identities", async () => {
    const data = fixtures()
    data.inventory_items = Array.from({ length: 1201 }, (_, i) => ({ id: `copy-${String(i).padStart(4, "0")}`, owner_user_id: "owner", identity: { kind: "card", cardId: `card-${i % 1001}`, language: "en" } }))
    data.binder_slots = Array.from({ length: 1201 }, (_, i) => ({ id: `slot-${i}`, owner_user_id: "owner", collection_id: "native", wanted_cards: [] }))
    data.pokemon_collection = Array.from({ length: 1201 }, (_, i) => ({ id: `old-${i}`, user_id: "owner", binder_id: "legacy", card_id: null, card_language: null, card_finish: null, wanted_cards: [] }))
    data.binders.push(...Array.from({ length: 1201 }, (_, i) => ({ id: `binder-${i}`, owner_user_id: "owner" })))
    for (let i = 0; i < 1201; i++) {
      data.inventory_owner_state.push({ owner_user_id: `other-${i}`, inventory_revision: 0 })
      data.storage_collection_state.push({ collection_id: `binder-${i}`, owner_user_id: "owner", authority: "legacy", conversion_version: null, version: 0, layout_revision: 0 })
    }
    const db = database(data)
    assert.equal((await selectTrackedPriceLookups(db.client, null)).length, 1001)
    for (const table of ["inventory_items", "binder_slots", "pokemon_collection", "binders", "inventory_owner_state", "storage_collection_state"]) assert.ok(db.calls.some(c => c.table === table && c.from === 1000))
    assert.ok(db.calls.every(c => c.filters.length === 0))
  })
  test("native-only and legacy-only owners, plus empty selection", async () => {
    const native = fixtures()
    native.binders = native.binders.slice(0, 1); native.pokemon_collection = native.pokemon_collection.slice(0, 1)
    assert.deepEqual(await selectTrackedPriceLookups(database(native).client, "owner"), [{ cardId: "trainer", language: "ja" }, { cardId: "energy", language: "de" }])
    const legacy = fixtures()
    legacy.inventory_owner_state = []; legacy.storage_collection_state = []; legacy.inventory_items = []; legacy.binder_slots = []
    assert.equal((await selectTrackedPriceLookups(database(legacy).client, "owner")).length, 3)
    assert.deepEqual(await selectTrackedPriceLookups(database().client, "empty-owner"), [])
  })
  test("projects only actual selector columns, with deterministic primary-key order", async () => {
    const db = database()
    await selectTrackedPriceLookups(db.client, "owner")
    const expected: Record<string, [string, string]> = {
      inventory_owner_state: ["owner_user_id,inventory_revision", "owner_user_id"],
      storage_collection_state: ["collection_id,owner_user_id,authority,conversion_version,version,layout_revision", "collection_id"],
      binders: ["id,owner_user_id", "id"],
      pokemon_collection: ["id,user_id,binder_id,card_id,card_language,card_finish,wanted_cards", "id"],
      inventory_items: ["id,owner_user_id,identity", "id"],
      binder_slots: ["id,owner_user_id,collection_id,wanted_cards", "id"],
    }
    for (const c of db.calls) assert.deepEqual([c.projection, c.key], expected[c.table])
  })
  test("isolates owner and verifies collection ownership", async () => {
    const data = fixtures()
    data.inventory_items.push({ id: "private-other", owner_user_id: "other", identity: { kind: "card", cardId: "private", language: "en" } })
    assert.ok(!(await selectTrackedPriceLookups(database(data).client, "owner")).some(x => x.cardId === "private"))
    data.pokemon_collection[1].binder_id = "missing"
    await assert.rejects(selectTrackedPriceLookups(database(data).client, "owner"))
    data.pokemon_collection[1].binder_id = "legacy"
    data.binders[1].owner_user_id = "other"
    await assert.rejects(selectTrackedPriceLookups(database(data).client, null))
  })
  test("pre-073 absent schema preserves legacy; partial schema and permission errors fail closed", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const db = database(fixtures(), (c, r) => { if (["inventory_owner_state", "storage_collection_state"].includes(c.table)) r.error = { code } })
      const result = await selectTrackedPriceLookups(db.client, "owner")
      assert.ok(result.some(x => x.cardId === "stale"))
      assert.ok(!db.calls.some(c => c.table === "inventory_items"))
    }
    for (const code of ["42501", "42703", "PGRST204", "NETWORK"]) {
      await assert.rejects(selectTrackedPriceLookups(database(fixtures(), (c, r) => { if (c.table === "storage_collection_state") r.error = { code } }).client, "owner"))
    }
    await assert.rejects(selectTrackedPriceLookups(database(fixtures(), (c, r) => { if (c.table === "storage_collection_state") r.error = { code: "42P01" } }).client, "owner"))
  })
  test("root survives last native collection deletion, retaining Unassigned", async () => {
    const data = fixtures()
    data.binders = []; data.storage_collection_state = []; data.pokemon_collection = []; data.binder_slots = []
    assert.deepEqual(await selectTrackedPriceLookups(database(data).client, "owner"), [{ cardId: "trainer", language: "ja" }])
  })
  test("rejects incomplete/malformed pages, duplicates, orphan roots, wants and unknown authority", async () => {
    for (const alter of [
      (_c: Call, r: { data: Row[] | null }) => { r.data = null },
      (_c: Call, r: { data: Row[] | null }) => { delete r.data![0].owner_user_id },
      (_c: Call, r: { count: number | null }) => { r.count = null },
      (_c: Call, r: { count: number | null }) => { r.count = (r.count ?? 0) + 1 },
    ]) await assert.rejects(selectTrackedPriceLookups(database(fixtures(), alter).client, "owner"))
    for (const mutate of [
      (d: Record<string, Row[]>) => { d.inventory_items.push(d.inventory_items[0]) },
      (d: Record<string, Row[]>) => { d.inventory_owner_state = [] },
      (d: Record<string, Row[]>) => { d.binder_slots[0].wanted_cards = {} },
      (d: Record<string, Row[]>) => { d.binder_slots[0].wanted_cards = [null] },
      (d: Record<string, Row[]>) => { d.inventory_items[0].identity = { kind: "card", cardId: "bad", language: "zz" } },
      (d: Record<string, Row[]>) => { d.storage_collection_state[0].authority = "unknown" },
    ]) { const data = fixtures(); mutate(data); await assert.rejects(selectTrackedPriceLookups(database(data).client, "owner")) }
  })
  test("rejects oversized reads and cross-owner responses despite query filters", async () => {
    await assert.rejects(selectTrackedPriceLookups(database(fixtures(), (c, r) => {
      if (c.table === "inventory_items") r.data![0].identity = { kind: "card", cardId: "x".repeat(33 * 1024 * 1024) }
    }).client, "owner"))
    await assert.rejects(selectTrackedPriceLookups(database(fixtures(), (c, r) => {
      if (c.table === "inventory_items") r.data![0].owner_user_id = "other"
    }).client, "owner"))
  })
  test("rejects changed authority/revision and stops at request budget", async () => {
    let roots = 0
    await assert.rejects(selectTrackedPriceLookups(database(fixtures(), (c, r) => { if (c.table === "inventory_owner_state" && ++roots === 2) r.data![0].inventory_revision = 4 }).client, "owner"))
    let states = 0
    await assert.rejects(selectTrackedPriceLookups(database(fixtures(), (c, r) => { if (c.table === "storage_collection_state" && ++states === 2) r.data![0].authority = "legacy" }).client, "owner"))
    const data = fixtures()
    data.inventory_items = Array.from({ length: 256001 }, (_, i) => ({ id: `copy-${i}`, owner_user_id: "owner", identity: { kind: "card", cardId: "copy", language: "en" } }))
    const db = database(data)
    await assert.rejects(selectTrackedPriceLookups(db.client, "owner"))
    assert.equal(db.calls.length, 512)
  })
})

describe("tracked identity contract", () => {
  test("preserves exact IDs and known finishes, deduplicates by existing card/language key", () => {
    const identities = [trackedPriceIdentity("set-1-stamped", " JA ", "holo")!, trackedPriceIdentity("set-1-stamped", "ja", "reverse_holo")!]
    assert.equal(identities[0].finish, "holo")
    assert.deepEqual(trackedPriceRequests(identities), [{ cardId: "set-1-stamped", language: "ja" }])
    assert.equal(trackedPriceIdentity("card", null, null), null)
    assert.deepEqual(trackedPriceIdentity("card", null, null, true), { cardId: "card", language: "en", finish: null })
    assert.throws(() => trackedPriceIdentity("card", "zz", "normal"))
    assert.throws(() => trackedPriceIdentity("card", "en", "foil"))
    assert.throws(() => trackedPriceIdentity(" ", "en", null))
  })
})
