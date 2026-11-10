import { test } from "node:test"
import assert from "node:assert/strict"
import { handleInventoryCompleteRead } from "../lib/server/inventory-read-http"
import { fetchCurrentInventorySnapshot } from "../lib/collection/inventory-read-browser"
import { captureCompleteInventoryReadFence, isCompleteInventoryReadAfter, isCompleteInventorySnapshot } from "../lib/collection/slot-snapshot"
import { fixture, owner, collection } from "./fixtures/inventory-read-server"
import type { InventoryReadScope } from "../lib/collection/inventory-read-transport"

const scope: InventoryReadScope = { actorUserId: owner, ownerUserId: owner, authSessionId: "synthetic-auth-session", sessionId: "synthetic-lifecycle" }
const request = (query = "requestId=synthetic-request&sessionId=synthetic-lifecycle") => new Request(`https://synthetic.test/app/api/inventory?${query}`)
async function withFetch(run: (set: (fn: typeof fetch) => void) => Promise<void>) {
  const saved = globalThis.fetch
  try { await run(fn => { globalThis.fetch = fn }) } finally { globalThis.fetch = saved }
}

test("actual authenticated handler -> JSON -> browser complete reconstruction retains >1000 records and independent fences", async () => {
  const f = fixture()
  const response = await handleInventoryCompleteRead(request(), f.client)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  const json = await response.json()
  assert.equal(isCompleteInventorySnapshot(json.snapshot), false)
  assert.deepEqual(json.evidence, { inventoryRevision: 7, items: 1031, placements: 1031, collections: 1, binders: 1, slots: 1031,
    storage: [{ collectionId: collection, collectionVersion: 3, layoutRevision: 4, slotCount: 1031 }] })
  await withFetch(async set => {
    set(async (input, init) => {
      assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error")
      return handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test"), init), f.client)
    })
    const result = await fetchCurrentInventorySnapshot(() => scope)
    assert.equal(result.status, "complete")
    if (result.status !== "complete") return
    assert.ok(isCompleteInventorySnapshot(result.snapshot))
    assert.equal(result.snapshot.items.length, 1031)
    assert.equal(result.snapshot.binders[0].slots.length, 1031)
  })
})

test("handler auth resolves owner/partner/unlinked actors, never caller identity", async () => {
  const f = fixture(0), partner = "33333333-3333-4333-8333-333333333333"
  f.oauth()
  assert.equal((await handleInventoryCompleteRead(request(), f.client)).status, 401)
  const linked = fixture(0)
  linked.setActor(partner)
  linked.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
  const response = await handleInventoryCompleteRead(request(), linked.client)
  assert.deepEqual((await response.json()).scope, { ...scope, actorUserId: partner })
  linked.tables.partnerships = []
  const unlinked = await handleInventoryCompleteRead(request(), linked.client)
  assert.equal(unlinked.status, 200)
  assert.equal((await unlinked.json()).snapshot.ownerUserId, partner)
  assert.equal((await handleInventoryCompleteRead(request(`requestId=a&sessionId=b&ownerUserId=${owner}`), linked.client)).status, 400)
  for (const query of ["requestId=a", "requestId=a&requestId=b&sessionId=c", "requestId=a&sessionId=b&actorUserId=forged"]) {
    assert.equal((await handleInventoryCompleteRead(request(query), linked.client)).status, 400)
  }
})

test("interrupted pages, uninitialized/legacy states, auth-session change and denied reads never publish a complete HTTP result", async () => {
  for (const mode of ["page", "uninitialized", "legacy", "session", "permission"]) {
    const f = fixture(mode === "page" ? 1031 : 0)
    if (mode === "page") f.intercept((table, url) => table === "inventory_items" && url.searchParams.has("id") ? Response.json([]) : undefined)
    if (mode === "uninitialized") f.tables.inventory_owner_state = []
    if (mode === "legacy") f.tables.storage_collection_state[0].authority = "legacy"
    if (mode === "permission") f.deny()
    if (mode === "session") f.intercept(table => {
      if (table === "inventory_items") f.client.auth.getClaims = async () => ({ data: { claims: { sub: owner, role: "authenticated", session_id: "synthetic-new-auth-session" } }, error: null }) as never
    })
    const response = await handleInventoryCompleteRead(request(), f.client)
    assert.ok(response.status >= 400, mode)
    assert.equal("snapshot" in await response.json(), false)
  }
})

test("malformed payload/count/version/owner/session/nonce and cacheable responses fail closed", async () => {
  const base = await (await handleInventoryCompleteRead(request(), fixture(2).client)).json()
  const mutations = [
    (b: typeof base) => { b.version = 3 },
    (b: typeof base) => { b.snapshot.items.pop() },
    (b: typeof base) => { b.evidence.items++ },
    (b: typeof base) => { b.evidence.inventoryRevision++ },
    (b: typeof base) => { b.evidence.storage[0].slotCount++ },
    (b: typeof base) => { b.evidence.storage[0].collectionVersion++ },
    (b: typeof base) => { b.evidence.storage[0].layoutRevision++ },
    (b: typeof base) => { b.snapshot.ownerUserId = "wrong" },
    (b: typeof base) => { b.scope.actorUserId = "wrong" },
    (b: typeof base) => { b.scope.ownerUserId = "wrong" },
    (b: typeof base) => { b.scope.authSessionId = "wrong" },
    (b: typeof base) => { b.scope.sessionId = "wrong" },
    (b: typeof base) => { b.requestId = "replayed" },
    (b: typeof base) => { b.snapshot.items[0].version = -1 },
    (b: typeof base) => { b.evidence.untrusted = true },
  ]
  await withFetch(async set => {
    for (const mutate of mutations) {
      set(async input => {
        const body = structuredClone(base)
        body.requestId = new URL(String(input), "https://synthetic.test").searchParams.get("requestId")
        mutate(body)
        return Response.json(body, { headers: { "Cache-Control": "private, no-store" } })
      })
      assert.equal((await fetchCurrentInventorySnapshot(() => scope)).status, "unavailable")
    }
    set(async input => {
      const body = structuredClone(base)
      body.requestId = new URL(String(input), "https://synthetic.test").searchParams.get("requestId")
      return Response.json(body)
    })
    assert.equal((await fetchCurrentInventorySnapshot(() => scope)).status, "unavailable")
  })
})

test("account/owner/lifecycle swap while HTTP or JSON is pending rejects even same-owner relink", async () => {
  await withFetch(async set => {
    for (const field of ["actorUserId", "ownerUserId", "authSessionId", "sessionId"] as const) {
      let live: InventoryReadScope | null = { ...scope }
      let release!: () => void
      const wait = new Promise<void>(resolve => { release = resolve })
      set(async input => {
        const response = await handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test")), fixture(0).client)
        await wait
        return response
      })
      const pending = fetchCurrentInventorySnapshot(() => live)
      live = { ...scope, [field]: "changed" }; release()
      assert.equal((await pending).status, "conflict")
    }
  })
})

test("nonce replay and cached replies cannot be reconstructed as a newly requested read", async () => {
  await withFetch(async set => {
    let cached: Response | undefined
    set(async input => {
      cached ??= await handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test")), fixture(0).client)
      return cached.clone()
    })
    const first = await fetchCurrentInventorySnapshot(() => scope)
    assert.equal(first.status, "complete")
    const fence = captureCompleteInventoryReadFence()
    if (first.status === "complete") assert.equal(isCompleteInventoryReadAfter(first.snapshot, fence), false)
    assert.equal((await fetchCurrentInventorySnapshot(() => scope)).status, "unavailable")
  })
})

test("JSON arriving after a command reply retains the BEFORE-fetch read-start fence", async () => {
  await withFetch(async set => {
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    set(async input => {
      const response = await handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test")), fixture(0).client)
      await wait
      return response
    })
    const pending = fetchCurrentInventorySnapshot(() => scope)
    const afterCommand = captureCompleteInventoryReadFence()
    release()
    const earlier = await pending
    assert.equal(earlier.status, "complete")
    if (earlier.status === "complete") assert.equal(isCompleteInventoryReadAfter(earlier.snapshot, afterCommand), false)
    const fresh = await fetchCurrentInventorySnapshot(() => scope)
    assert.equal(fresh.status, "complete")
    if (fresh.status === "complete") assert.ok(isCompleteInventoryReadAfter(fresh.snapshot, afterCommand))
  })
})

test("session teardown during JSON decoding never brands the pending response", async () => {
  await withFetch(async set => {
    let live: InventoryReadScope | null = scope
    let decoding!: () => void, release!: () => void
    const began = new Promise<void>(resolve => { decoding = resolve })
    const pendingJson = new Promise<void>(resolve => { release = resolve })
    set(async input => {
      const response = await handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test")), fixture(0).client)
      const decode = response.json.bind(response)
      response.json = async () => { decoding(); await pendingJson; return decode() }
      return response
    })
    const pending = fetchCurrentInventorySnapshot(() => live)
    await began
    live = null; release()
    assert.equal((await pending).status, "conflict")
  })
})


test("browser preserves honest conflict/legacy/uninitialized/staging errors and sanitizes unknown details", async () => {
  await withFetch(async set => {
    for (const [status, code] of [[409, "inventory_read_conflict"], [503, "legacy_inventory_incomplete"], [503, "inventory_not_initialized"], [401, "inventory_sign_in_required"], [403, "inventory_read_forbidden"], [503, "inventory_operations_staged"]] as const) {
      set(async () => Response.json({ error: code }, { status }))
      assert.deepEqual(await fetchCurrentInventorySnapshot(() => scope), { status: status === 409 ? "conflict" : "unavailable", code })
    }
    set(async () => Response.json({ error: "synthetic private database detail" }, { status: 503 }))
    assert.deepEqual(await fetchCurrentInventorySnapshot(() => scope), { status: "unavailable", code: "inventory_read_unavailable" })
  })
})

test("missing authenticated session identity rejects before any owner data read", async () => {
  const f = fixture(0)
  f.client.auth.getClaims = async () => ({ data: { claims: { sub: owner, role: "authenticated" } }, error: null }) as never
  assert.equal((await handleInventoryCompleteRead(request(), f.client)).status, 401)
  assert.equal(f.requests.length, 0)
})

test("private JSON retains recorded canonical metadata including 083 location and immutable source", async () => {
  const f = fixture(2)
  const grade = { provider: { kind: "custom", name: "Synthetic grading" }, grade: "recorded", scale: null, designation: null,
    subgrades: [], certificate: "synthetic-private-certificate", holder: "synthetic holder", label: { variant: null, assetIds: ["synthetic-private-asset"] } }
  f.tables.inventory_items[1].grading = grade
  f.tables.inventory_items[1].acquired_at = "2026-01-01T00:00:00Z"
  f.tables.inventory_items[1].legacy_source = "synthetic-source-not-selected"
  f.tables.storage_collection_state[0].kind = "custom"
  f.tables.storage_collection_state[0].default_presentation = "list"
  f.tables.storage_collection_state[0].location = "synthetic private shelf"
  await withFetch(async set => {
    set(async input => handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test")), f.client))
    const result = await fetchCurrentInventorySnapshot(() => scope)
    assert.equal(result.status, "complete")
    if (result.status !== "complete") return
    assert.deepEqual(result.snapshot.items[1].grading, grade)
    assert.equal(result.snapshot.items[1].acquiredAt, "2026-01-01T00:00:00Z")
    assert.equal(result.snapshot.collections[0].location, "synthetic private shelf")
    assert.equal(result.snapshot.items[1].legacySource, "synthetic-source-not-selected")
  })
})

test("numeric catalog species evidence survives JSON, old absence stays unknown and malformed IDs reject", async () => {
  await withFetch(async set => {
    for (const ids of [[143], [143, 143], [], undefined, [0], [-1], ["143"], [1.5]]) {
      set(async input => {
        const response = await handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test")), fixture(1).client)
        const body = await response.json()
        body.navigation.catalog = [{ card: { id: "synthetic-card", localId: "1", name: "Synthetic card", set: { id: "synthetic", name: "Synthetic" } }, speciesNames: [], ...(ids === undefined ? {} : { pokemonIds: ids }) }]
        return Response.json(body, { headers: { "Cache-Control": "private, no-store" } })
      })
      const result = await fetchCurrentInventorySnapshot(() => scope)
      if (ids && (ids.some(id => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) || new Set<string | number>(ids).size !== ids.length)) assert.equal(result.status, "unavailable")
      else {
        assert.equal(result.status, "complete")
        if (result.status === "complete") assert.deepEqual(result.navigation.catalog[0].pokemonIds, ids === undefined ? undefined : [...new Set<string | number>(ids)])
      }
    }
  })
})

test("private read carries before/after verified membership for portable wanted roles", async () => {
  const partner = "33333333-3333-4333-8333-333333333333"
  const f = fixture(0)
  f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
  let body = await (await handleInventoryCompleteRead(request(), f.client)).json()
  assert.equal(body.partnerUserId, partner)
  f.setActor(partner)
  body = await (await handleInventoryCompleteRead(request(), f.client)).json()
  assert.equal(body.partnerUserId, partner)
  assert.equal(body.scope.ownerUserId, owner)
  await withFetch(async set => {
    set(async (input, init) => {
      const good = await (await handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test"), init), f.client)).json()
      return Response.json({ ...good, partnerUserId: null }, { headers: { "Cache-Control": "private, no-store" } })
    })
    assert.equal((await fetchCurrentInventorySnapshot(() => ({ ...scope, actorUserId: partner }))).status, "unavailable")
  })
})

test('same private complete read carries a unique known default, unknown metadata stays unknown and foreign defaults fail closed', async () => {
  const f = fixture(0)
  f.tables.binders[0].is_default = true
  const response = await handleInventoryCompleteRead(request(), f.client)
  assert.equal((await response.json()).defaultCollectionId, collection)
  delete f.tables.binders[0].is_default
  assert.equal('defaultCollectionId' in await (await handleInventoryCompleteRead(request(), f.client)).json(), false)
  await withFetch(async set => {
    for (const defaultId of [collection, 'synthetic-foreign', null]) {
      set(async (input, init) => {
        const response = await handleInventoryCompleteRead(new Request(new URL(String(input), 'https://synthetic.test'), init), f.client)
        return Response.json({ ...await response.json(), defaultCollectionId: defaultId }, { headers: { 'Cache-Control': 'private, no-store' } })
      })
      const result = await fetchCurrentInventorySnapshot(() => scope)
      assert.equal(result.status, defaultId === collection ? 'complete' : 'unavailable')
      if (result.status === 'complete') assert.equal(result.defaultCollectionId, collection)
    }
  })
})


function untouchedOwner() {
  const f = fixture(0)
  f.tables.inventory_owner_state = []
  f.tables.binders = []
  f.tables.storage_collection_state = []
  return f
}

test("untouched authenticated owner reconstructs genuine complete revision zero without any GET writes", async () => {
  const f = untouchedOwner(), before = structuredClone(f.tables)
  const response = await handleInventoryCompleteRead(request(), f.client)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.snapshot, { ownerUserId: owner, inventoryRevision: 0, items: [], placements: [], collections: [], binders: [] })
  assert.deepEqual(body.evidence, { inventoryRevision: 0, items: 0, placements: 0, collections: 0, binders: 0, slots: 0, storage: [] })
  await withFetch(async set => {
    set(async (input, init) => handleInventoryCompleteRead(new Request(new URL(String(input), "https://synthetic.test"), init), f.client))
    const result = await fetchCurrentInventorySnapshot(() => scope)
    assert.equal(result.status, "complete")
    if (result.status === "complete") assert.ok(isCompleteInventorySnapshot(result.snapshot))
  })
  assert.deepEqual(f.tables, before)
  assert.ok(f.requests.every(r => r.method === "GET" || r.method === "HEAD" || r.table === "billing_partner_allowed" || r.table === "inventory_grid_read_v1"))
  const legacy = f.requests.filter(r => r.table === "pokemon_collection")
  assert.ok(legacy.length >= 2)
  assert.ok(legacy.every(r => r.method === "HEAD" && r.url.searchParams.get("user_id") === `eq.${owner}`))
})

for (const table of ["binders", "pokemon_collection", "storage_collection_state", "inventory_items", "binder_slots", "inventory_placements", "binder_legacy_rows"]) {
  test(`absent root with existing legacy/nonempty/orphan ${table} refuses complete empty`, async () => {
    const f = untouchedOwner()
    f.tables[table] = [{ [table === "pokemon_collection" ? "user_id" : "owner_user_id"]: owner, id: "synthetic-residue" }]
    const response = await handleInventoryCompleteRead(request(), f.client)
    assert.equal(response.status, 503)
    assert.equal("snapshot" in await response.json(), false)
  })
  for (const mode of ["denied", "missing", "count", "network"])
    test(`empty-owner proof refuses ${mode} query on ${table}`, async () => {
      const f = untouchedOwner()
      f.intercept(name => {
        if (name !== table) return
        if (mode === "network") throw new Error("synthetic-network-failure")
        if (mode === "count") return new Response(null, { status: 200 })
        return Response.json({ code: mode === "denied" ? "42501" : "42P01" }, { status: mode === "denied" ? 403 : 404 })
      })
      if (mode === "network") {
        const { readOwnerInventoryState } = await import("../lib/server/inventory-read")
        await assert.rejects(readOwnerInventoryState(f.client, { timeoutMs: 25 }), { code: "inventory_read_deadline" })
        return
      }
      const response = await handleInventoryCompleteRead(request(), f.client)
      assert.equal(response.status, 503)
      assert.equal("snapshot" in await response.json(), false)
    })
}

test("empty-owner scope/auth/billing failures never reconstruct a complete read", async () => {
  for (const mode of ["claims", "session", "billing", "membership", "scope"]) {
    const f = untouchedOwner()
    if (mode === "claims") f.oauth()
    if (mode === "session") f.client.auth.getUser = async () => ({ data: { user: null }, error: new Error("synthetic revoked") }) as never
    if (mode === "billing") f.deny()
    f.intercept(table => {
      if (mode === "membership" && table === "partnerships") return Response.json({ code: "42501" }, { status: 403 })
      if (mode === "scope" && table === "pokemon_collection") f.setActor(collection)
    })
    const response = await handleInventoryCompleteRead(request(), f.client)
    assert.ok(response.status >= 400, mode)
    assert.equal("snapshot" in await response.json(), false)
  }
})

test("concurrent first creation including a revision-zero root conflicts before complete branding", async () => {
  for (const revision of [0, 1]) {
    const f = untouchedOwner()
    let checks = 0
    f.intercept(table => {
      if (table !== "inventory_owner_state" || ++checks !== 4) return
      f.tables.inventory_owner_state = [{ owner_user_id: owner, inventory_revision: revision }]
      f.tables.binders = [{ id: collection, owner_user_id: owner, name: "Synthetic first", binder_rows: null, binder_cols: null, updated_at: null }]
      f.tables.storage_collection_state = [{ collection_id: collection, owner_user_id: owner, kind: "binder", default_presentation: "binder", version: 0, layout_revision: 0, authority: "slots", preset_manifest: null, location: null }]
    })
    const { readOwnerInventoryState } = await import("../lib/server/inventory-read")
    await assert.rejects(readOwnerInventoryState(f.client, { attempts: 1 }), { code: "inventory_read_conflict" })
    const fresh = await readOwnerInventoryState(f.client)
    assert.equal(fresh.snapshot.collections[0].id, collection)
    assert.equal(fresh.snapshot.inventoryRevision, revision)
  }
})

test("late legacy residue before the final absent-root fence conflicts rather than publishing empty", async () => {
  const f = untouchedOwner()
  let legacyChecks = 0
  f.intercept(table => {
    if (table === "pokemon_collection" && ++legacyChecks > 1) f.tables.pokemon_collection = [{ user_id: owner, pokemon_id: 25 }]
  })
  const response = await handleInventoryCompleteRead(request(), f.client)
  assert.equal(response.status, 503)
  assert.equal("snapshot" in await response.json(), false)
})

test("ending a browser lifetime aborts its pending HTTP read without granting complete evidence", async () => {
  await withFetch(async set => {
    const controller = new AbortController()
    let aborted = false
    set(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      assert.ok(init?.signal)
      init.signal.addEventListener("abort", () => { aborted = true; reject(init.signal!.reason) }, { once: true })
    }))
    const pending = fetchCurrentInventorySnapshot(() => scope, false, controller.signal)
    controller.abort()
    const result = await pending
    assert.equal(aborted, true)
    assert.notEqual(result.status, "complete")
  })
})
