import { createClient } from "@supabase/supabase-js"
import { fixture } from "./inventory-read-server"
import { readOwnerInventorySnapshot } from "@/lib/server/inventory-read"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"
import { parseStorageRequest } from "@/lib/server/operations/storage-contract"
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
      if (input.operation.startsWith("recovery.")) {
        const recovery = request as Record<string, unknown>
        // Synthetic event engine, NOT SQL correctness proof. Real parser/bridge/auth/read/IDB.
        const version = input.operation.endsWith(".v2") ? 2 : 1
        if (input.operation.startsWith("recovery.preview")) {
          const unsupported = recovery.eventId === "102" ? ["private_assets_unverifiable"] : []
          const conflicts = recovery.eventId === "103" ? [{ reason: "slot_version_changed", entity: "synthetic-slot-0" }] : []
          return Response.json({ planVersion: version, eventId: recovery.eventId, supported: !unsupported.length, unsupported, conflicts,
            planToken: unsupported.length || conflicts.length ? null : "a".repeat(64), restoreUnassignedItemIds: recovery.restoreUnassignedItemIds,
            changes: version === 2 ? [{ table: "binders", id: "synthetic-original-default", before: { name: "Synthetic original default", is_default: true }, after: null },
              { table: "binders", id: collection, before: { name: "Synthetic storage", is_default: false }, after: { name: "Synthetic storage", is_default: true } }]
              : [{ table: "binder_slots", id: "synthetic-slot-0", before: { status: "collected" }, after: { status: "wishlisted" } }], rootRevisionsAdvance: true })
        }
        if (recovery.planToken !== "a".repeat(64)) return Response.json({ code: "40001" }, { status: 409 })
        const revision = Number(state.tables.inventory_owner_state[0].inventory_revision) + 1
        state.tables.inventory_owner_state[0].inventory_revision = revision
        state.tables.binder_slots[0].status = "wishlisted"
        const result = { inventoryRevision: revision, eventId: "201", recoveredEventId: recovery.eventId,
          collections: [{ collectionId: collection, version: state.tables.storage_collection_state[0].version, layoutRevision: state.tables.storage_collection_state[0].layout_revision }] }
        ledger.set(key, { body, audit, result })
        return Response.json(result)
      }
      const snapshot = await readOwnerInventorySnapshot(state.client)
      if (request.inventoryRevision !== snapshot.inventoryRevision) {
        const result = { outcome: "rejected", operationId: key, code: input.operation === "slots" ? "slot_revision_conflict" : "inventory_revision_conflict", inventoryRevision: snapshot.inventoryRevision }
        ledger.set(key, { body, audit, result })
        return Response.json(result)
      }
      const next = projectSlotIntent(snapshot, { kind: input.operation, request,
        context: { source: "app", clientId: null, operationId: key, batchId: key, clientOccurredAt: null } } as Parameters<typeof projectSlotIntent>[1], () => undefined)
      state.tables.inventory_owner_state[0].inventory_revision = next.inventoryRevision
      state.tables.storage_collection_state[0].version = next.collections[0].version
      state.tables.storage_collection_state[0].layout_revision = next.binders[0].layoutRevision
      state.tables.binder_slots = next.binders[0].slots.map((s, position) => ({ id: s.id, owner_user_id: owner, collection_id: collection,
        position, target: s.target, status: s.status, wanted_cards: s.wantedCards, preset_origin: s.presetOrigin, version: s.version }))
      const result = { inventoryRevision: next.inventoryRevision, changed: next.inventoryRevision !== snapshot.inventoryRevision,
        collectionVersion: next.collections[0].version, layoutRevision: next.binders[0].layoutRevision, removedSlotIds: [] }
      ledger.set(key, { body, audit, result })
      return Response.json(result)
    } catch { return Response.json({ code: "40001" }, { status: 409 }) }
  } } })
  state.client.rpc = ((...args: Parameters<typeof originalRpc>) => args[0] === "storage_execute_v1" ? rpcClient.rpc(...args) : originalRpc(...args)) as typeof state.client.rpc
  fixtures.set(id, state)
  return state
}
