import { createClient } from "@supabase/supabase-js"
import { fixture } from "./inventory-read-server"
import { readOwnerInventorySnapshot } from "@/lib/server/inventory-read"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"
import { parseStorageRequest } from "@/lib/server/operations/storage-contract"
import { browserHostCatalog } from "@/lib/collection/browser-host-catalog"
import { readInventoryCatalog } from "@/lib/server/inventory-read-catalog"
import { readAuditHeader } from "@/lib/supabase/audit-header"

// Synthetic PostgREST/ledger only. Handler, trusted bridge, all-stream read and browser IDB are real.
// This module cannot access configured Supabase: fixture() has its own in-memory HTTP transport.
const owner = "00000000-0000-4000-8000-0000000000e2"
const collection = "22222222-2222-4222-8222-222222222222"
const fixtures = new Map<string, ReturnType<typeof fixture>>()
export function storageCommandHarness(id: string) {
  let f = fixtures.get(id)
  if (f) return f
  f = fixture(0, owner, "synthetic-e2e-auth-session")
  const state = f
  state.tables.binders[0].binder_rows = 2; state.tables.binders[0].binder_cols = 2
  for (let i = 0; i < 4; i++) state.tables.binder_slots.push({ id: `synthetic-slot-${i}`, owner_user_id: owner, collection_id: collection,
    position: i, target: null, status: null, wanted_cards: [], preset_origin: null, version: 0 })
  if (id.startsWith("scan-") || id.startsWith("fill-")) {
    // Synthetic scanner data, unrelated to any real card, owner or catalog provider.
    const cards = ["energy", "trainer", "snorlax"]
    state.tables.tcg_sets = [{ id: "synthetic", name_en: "Synthetic scanner set" }]
    state.tables.tcg_cards = cards.map(kind => ({ id: `synthetic-${kind}`, set_id: "synthetic", local_id: "1",
      name_en: `Synthetic ${kind}`, name_json: { en: `Synthetic ${kind}` }, external_ids_json: {} }))
    state.tables.tcg_card_dex_ids = [{ card_id: "synthetic-snorlax", dex_id: 143 }]
    state.tables.inventory_items = cards.map(kind => ({ id: `synthetic-copy-${kind}`, owner_user_id: owner,
      identity: { kind: "card", cardId: `synthetic-${kind}`, language: "en" }, grading: null, acquired_at: null, version: 0, legacy_source: null }))
    for (const slot of state.tables.binder_slots.slice(0, 2)) slot.target = { kind: "pokemon", pokemonId: 143 }
  }
  if (id.startsWith("fill-")) {
    // Synthetic mixed bulk-fill page with separate copies of a repeated printing.
    state.tables.inventory_items.push({ ...state.tables.inventory_items[2], id: "synthetic-copy-snorlax-2" })
    state.tables.binder_slots.push({ ...state.tables.binder_slots[3], id: "synthetic-slot-4", position: 4 })
    state.tables.inventory_placements.push({ inventory_item_id: "synthetic-copy-trainer", owner_user_id: owner,
      collection_id: collection, slot_id: "synthetic-slot-3", version: 0 })
    state.tables.binder_slots[3].status = "collected"
  }
  const ledger = new Map<string, { body: string; audit: string; result: unknown }>()
  const originalRpc = state.client.rpc.bind(state.client)
  // Synthetic HTTP response, real Supabase RPC builder and trusted audit context.
  const rpcClient = createClient("https://synthetic.supabase.test", "synthetic-service", { auth: { persistSession: false }, global: { fetch: async (_input, init) => {
    const input = JSON.parse(String(init?.body)), audit = readAuditHeader() ?? ""
    const context = JSON.parse(audit || "null")
    if (!context || context.actor.userId !== owner || context.source !== "app" || input.owner_id !== owner) return Response.json({ code: "42501" }, { status: 403 })
    try {
      const request = parseStorageRequest(input.operation, input.request)
      const key = String(request.operationId), body = JSON.stringify(input)
      const previous = ledger.get(key)
      if (previous) return previous.body === body && previous.audit === audit ? Response.json(previous.result) : Response.json({ code: "23505" }, { status: 409 })
      const snapshot = await readOwnerInventorySnapshot(state.client)
      if (request.inventoryRevision !== snapshot.inventoryRevision) {
        const result = { outcome: "rejected", operationId: key, code: input.operation === "slots" ? "slot_revision_conflict" : "inventory_revision_conflict", inventoryRevision: snapshot.inventoryRevision }
        ledger.set(key, { body, audit, result })
        return Response.json(result)
      }
      const catalog = browserHostCatalog(await readInventoryCatalog(state.client, snapshot, new AbortController().signal, () => {}))
      const next = projectSlotIntent(snapshot, { kind: input.operation, request,
        context: { source: "app", clientId: null, operationId: key, batchId: key, clientOccurredAt: null } } as Parameters<typeof projectSlotIntent>[1], catalog)
      state.tables.inventory_owner_state[0].inventory_revision = next.inventoryRevision
      state.tables.storage_collection_state[0].version = next.collections[0].version
      state.tables.storage_collection_state[0].layout_revision = next.binders[0].layoutRevision
      state.tables.binder_slots = next.binders[0].slots.map((s, position) => ({ id: s.id, owner_user_id: owner, collection_id: collection,
        position, target: s.target, status: s.status, wanted_cards: s.wantedCards, preset_origin: s.presetOrigin, version: s.version }))
      state.tables.inventory_items = next.items.map(i => ({ id: i.id, owner_user_id: owner, identity: i.identity,
        grading: i.grading, acquired_at: i.acquiredAt, version: i.version, legacy_source: null }))
      state.tables.inventory_placements = next.placements.map(p => ({ inventory_item_id: p.inventoryItemId, owner_user_id: owner,
        collection_id: p.collectionId, slot_id: p.slotId, version: p.version }))
      const result = input.operation === "inventory" ? { inventoryRevision: next.inventoryRevision, changed: next.inventoryRevision !== snapshot.inventoryRevision,
        selectedItemIds: next.placements.filter(p => !snapshot.placements.some(old => old.inventoryItemId === p.inventoryItemId)).map(p => p.inventoryItemId),
        acquiredItemIds: next.items.filter(i => !snapshot.items.some(old => old.id === i.id)).map(i => i.id) } : { inventoryRevision: next.inventoryRevision, changed: next.inventoryRevision !== snapshot.inventoryRevision,
        collectionVersion: next.collections[0].version, layoutRevision: next.binders[0].layoutRevision, removedSlotIds: [] }
      ledger.set(key, { body, audit, result })
      return Response.json(result)
    } catch { return Response.json({ code: "40001" }, { status: 409 }) }
  } } })
  state.client.rpc = ((...args: Parameters<typeof originalRpc>) => args[0] === "storage_execute_v1" ? rpcClient.rpc(...args) : originalRpc(...args)) as typeof state.client.rpc
  fixtures.set(id, state)
  return state
}
