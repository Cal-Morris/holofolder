import { projectCollectionCreation, parseCollectionCreation } from "@/lib/domain/storage-creation"
import { createClient } from "@supabase/supabase-js"
import { fixture } from "./inventory-read-server"
import { readOwnerInventorySnapshot } from "@/lib/server/inventory-read"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"
import { parseStorageRequest } from "@/lib/server/operations/storage-contract"
import { browserHostCatalog } from "@/lib/collection/browser-host-catalog"
import { readInventoryCatalog } from "@/lib/server/inventory-read-catalog"
import { emptyGradingRecord } from "@/lib/grading/draft"
import { readAuditHeader } from "@/lib/supabase/audit-header"

// Synthetic PostgREST/ledger only. Handler, trusted bridge, all-stream read and browser IDB are real.
// This module cannot access configured Supabase: fixture() has its own in-memory HTTP transport.
const actor = "00000000-0000-4000-8000-0000000000e2"
const collection = "22222222-2222-4222-8222-222222222222"
const fixtures = new Map<string, ReturnType<typeof fixture>>()
export function storageCommandHarness(id: string) {
  let f = fixtures.get(id)
  if (f) return f
  const owner = (id.startsWith("grading-partner-") || id.startsWith("backup-partner-") || id.startsWith("raw-partner-")) ? "11111111-1111-4111-8111-111111111111" : actor
  f = fixture(0, owner, "synthetic-e2e-auth-session")
  const state = f
  if (owner !== actor) {
    state.setActor(actor)
    state.tables.partnerships.push({ id: "synthetic-grading-partnership", owner_user_id: owner, user1_id: owner, user2_id: actor })
  }
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
  if (id.startsWith("scan-destination-collision-")) {
    state.tables.binder_slots[2].id = "append-free"
    state.tables.binder_slots[3].id = "append-card"
  }
  if (id.startsWith("scan-copy-collision-")) {
    state.tables.inventory_items[0].id = "raw"
    state.tables.inventory_items[0].grading = { ...emptyGradingRecord(), provider: { kind: "known", id: "psa" }, grade: "9", certificate: "000-synthetic" }
  }
  // Synthetic scanner boundary sizes, shared by actual HTTP reads and command projection.
  if (id.startsWith("scan-empty-")) state.tables.binder_slots = []
  if (id.startsWith("scan-partial-")) state.tables.binder_slots = state.tables.binder_slots.slice(0, 3)
  if (id.startsWith("scan-cap-")) state.tables.binder_slots = Array.from({ length: 4096 }, (_, i) => ({
    ...state.tables.binder_slots[3], id: `synthetic-slot-${i}`, position: i,
  }))

  if (id.startsWith("grading-")) {
    state.tables.binder_slots[0].status = "collected"
    // Synthetic independent copies of the same unknown printing; private evidence must round-trip.
    for (const [n, provider] of ["psa", "ace", null].entries()) {
      const itemId = `synthetic-grading-${n}`
      state.tables.inventory_items.push({ id: itemId, owner_user_id: owner, identity: { kind: "card", cardId: "synthetic-unknown-printing", language: "en", finish: "holo" },
        grading: provider ? { ...emptyGradingRecord(), provider: { kind: "known", id: provider }, grade: n ? "Legacy / unknown" : "9", certificate: n ? "000-ACE.12" : "00001234",
          label: { variant: "Synthetic legacy label", assetIds: [`synthetic-private-label-${n}`] } } : null,
        acquired_at: "2026-01-02T00:00:00Z", version: 2,
        legacy_source: { unknown: { untouched: [null, "00007", { legacy: true }] } }, untouched_column: "synthetic-private-db-metadata" })
      if (n === 0) state.tables.inventory_placements.push({ inventory_item_id: itemId, owner_user_id: owner, collection_id: collection, slot_id: "synthetic-slot-0", version: 5 })
    }
  }

  if (id.startsWith("fill-")) {
    // Synthetic mixed bulk-fill page with separate copies of a repeated printing.
    state.tables.inventory_items.push({ ...state.tables.inventory_items[2], id: "synthetic-copy-snorlax-2" })
    state.tables.binder_slots.push({ ...state.tables.binder_slots[3], id: "synthetic-slot-4", position: 4 })
    state.tables.inventory_placements.push({ inventory_item_id: "synthetic-copy-trainer", owner_user_id: owner,
      collection_id: collection, slot_id: "synthetic-slot-3", version: 0 })
    state.tables.binder_slots[3].status = "collected"

  }
  if (id.startsWith("backup-")) {
    // Synthetic private collection-data fixture. Real first-party read/IDB/serializer, no hosted data.
    const other = "33333333-3333-4333-8333-333333333333"
    state.tables.binders.push({ ...state.tables.binders[0], id: other, name: "Synthetic other storage", binder_rows: 1, binder_cols: 4 })
    state.tables.storage_collection_state.push({ ...state.tables.storage_collection_state[0], collection_id: other, preset_manifest: null })
    state.tables.binder_slots.push({ ...state.tables.binder_slots[3], id: "synthetic-other-slot", collection_id: other, position: 0 })
    const source = { id: "synthetic-original-preset", version: "original-v1" }
    const manifest = { source, name: "Synthetic original manifest", entries: [{ id: "synthetic-entry", target: { kind: "card", cardId: "synthetic-unknown-printing" } }] }
    state.tables.storage_collection_state[0].preset_manifest = manifest
    state.tables.binder_slots[0].preset_origin = { source, entryId: "synthetic-entry" }
    state.tables.binder_slots[0].target = manifest.entries[0].target
    state.tables.binder_slots[0].status = "collected"
    state.tables.binder_slots[1].target = { kind: "card", cardId: "synthetic-trainer" }
    state.tables.binder_slots[1].status = "wishlisted"
    state.tables.binder_slots[1].wanted_cards = [{ card_id: "synthetic-trainer", card_name: "Synthetic trainer", added_at: "2026-01-01T00:00:00Z", wanted_by: [owner, ...(owner !== actor ? [actor] : [])] }]
    for (let n = 0; n < 3; n++) state.tables.inventory_items.push({ id: `synthetic-backup-copy-${n}`, owner_user_id: owner,
      identity: { kind: "card", cardId: "synthetic-unknown-printing", language: "en", finish: "holo" },
      grading: n === 2 ? null : { ...emptyGradingRecord(), provider: { kind: "known", id: "psa" }, grade: "9", certificate: "00001234",
        label: { variant: "Synthetic private label", assetIds: id.startsWith("backup-assets-") ? ["synthetic-private-label"] : [] } },
      acquired_at: "2026-01-02T00:00:00Z", version: 2, legacy_source: { original: ["00007", null, { unknown: true }] } })
    state.tables.inventory_placements.push({ inventory_item_id: "synthetic-backup-copy-0", owner_user_id: owner, collection_id: collection, slot_id: "synthetic-slot-0", version: 3 })
    state.tables.inventory_placements.push({ inventory_item_id: "synthetic-backup-copy-1", owner_user_id: owner, collection_id: other, slot_id: "synthetic-other-slot", version: 4 })
    state.tables.binder_slots[4].status = "collected"
  }

  if (id.startsWith("raw-")) {
    // Synthetic raw ownership loop. No hosted catalog, accounts, SQL or audit engine.
    const other = "33333333-3333-4333-8333-333333333333"
    state.tables.binders.push({ ...state.tables.binders[0], id: other, name: "Synthetic second storage" })
    state.tables.storage_collection_state.push({ ...state.tables.storage_collection_state[0], collection_id: other })
    state.tables.binder_slots.push({ ...state.tables.binder_slots[0], id: "synthetic-other-slot", collection_id: other, position: 0 })
    state.tables.tcg_sets = [{ id: "synthetic", name_en: "Synthetic raw set" }]
    state.tables.tcg_cards = [{ id: "synthetic-raw", set_id: "synthetic", local_id: "1", name_en: "Synthetic raw card", name_json: { en: "Synthetic raw card" }, external_ids_json: {} }]
    state.tables.tcg_card_dex_ids = [{ card_id: "synthetic-raw", dex_id: 143 }]
    for (let n = 0; n < 3; n++) state.tables.inventory_items.push({ id: `synthetic-raw-copy-${n}`, owner_user_id: owner,
      identity: { kind: "card", cardId: "synthetic-raw" }, grading: n === 2 ? emptyGradingRecord() : null,
      acquired_at: "2026-01-02T00:00:00Z", version: 2, legacy_source: { original: ["00007", null] } })
    state.tables.inventory_items.push({ id: "synthetic-raw-unknown", owner_user_id: owner,
      identity: { kind: "card", cardId: "synthetic-unknown" }, grading: null, acquired_at: null, version: 0, legacy_source: null })
    state.tables.inventory_placements.push({ inventory_item_id: "synthetic-raw-copy-0", owner_user_id: owner,
      collection_id: collection, slot_id: "synthetic-slot-0", version: 3 })
    state.tables.binder_slots[0].target = { kind: "pokemon", pokemonId: 143 }
    state.tables.binder_slots[0].status = "collected"
    state.tables.binder_slots[2].target = { kind: "pokemon", pokemonId: 25 }
  }
  let removedRaw: { item: Record<string, unknown>; placement?: Record<string, unknown> } | null = null
  const ledger = new Map<string, { body: string; audit: string; result: unknown }>()
  const originalRpc = state.client.rpc.bind(state.client)
  // Synthetic HTTP response, real Supabase RPC builder and trusted audit context.
  const rpcClient = createClient("https://synthetic.supabase.test", "synthetic-service", { auth: { persistSession: false }, global: { fetch: async (_input, init) => {
    const input = JSON.parse(String(init?.body)), audit = readAuditHeader() ?? ""
    const context = JSON.parse(audit || "null")
    if (!context || context.actor.userId !== actor || context.source !== "app" || input.owner_id !== owner) return Response.json({ code: "42501" }, { status: 403 })
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
          const rawPlacement = recovery.eventId === "104" && removedRaw?.placement
          const rawOccupied = rawPlacement && state.tables.inventory_placements.some(p => p.slot_id === rawPlacement.slot_id)
          const restoreUnassigned = Array.isArray(recovery.restoreUnassignedItemIds) && recovery.restoreUnassignedItemIds.includes(String(removedRaw?.item.id))
          const conflicts = rawOccupied && !restoreUnassigned ? [{ reason: "slot_version_changed", entity: String(rawPlacement.slot_id) }] : recovery.eventId === "103" ? [{ reason: "slot_version_changed", entity: "synthetic-slot-0" }] : []
          return Response.json({ planVersion: version, eventId: recovery.eventId, supported: !unsupported.length, unsupported, conflicts,
            planToken: unsupported.length || conflicts.length ? null : "a".repeat(64), restoreUnassignedItemIds: recovery.restoreUnassignedItemIds,
            changes: recovery.eventId === "104" && removedRaw ? [{ table: "inventory_items", id: removedRaw.item.id, before: null, after: { identity: removedRaw.item.identity, version: removedRaw.item.version } }] : version === 2 ? [{ table: "binders", id: "synthetic-original-default", before: { name: "Synthetic original default", is_default: true }, after: null },
              { table: "binders", id: collection, before: { name: "Synthetic storage", is_default: false }, after: { name: "Synthetic storage", is_default: true } }]
              : [{ table: "binder_slots", id: "synthetic-slot-0", before: { status: "collected" }, after: { status: "wishlisted" } }], rootRevisionsAdvance: true })
        }
        if (key === 'synthetic-proven-stale') {
          const result={outcome:'rejected',operationId:key,code:'recovery_plan_conflict',inventoryRevision:Number(state.tables.inventory_owner_state[0].inventory_revision)}
          ledger.set(key,{body,audit,result});return Response.json(result)
        }
        if (recovery.planToken !== "a".repeat(64)) return Response.json({ code: "40001" }, { status: 409 })
        const revision = Number(state.tables.inventory_owner_state[0].inventory_revision) + 1
        state.tables.inventory_owner_state[0].inventory_revision = revision
        if (recovery.eventId === "104" && removedRaw) {
          // Fixture recovery only. Production version/token safety is proved by the existing SQL tests.
          state.tables.inventory_items.push({ ...removedRaw.item })
          const unassigned = Array.isArray(recovery.restoreUnassignedItemIds) && recovery.restoreUnassignedItemIds.includes(String(removedRaw.item.id))
          if (removedRaw.placement && !unassigned) {
            if (state.tables.inventory_placements.some(p => p.slot_id === removedRaw!.placement!.slot_id)) return Response.json({ code: "40001" }, { status: 409 })
            state.tables.inventory_placements.push({ ...removedRaw.placement })
            state.tables.binder_slots.find(s => s.id === removedRaw!.placement!.slot_id)!.status = "collected"
          }
        } else state.tables.binder_slots[0].status = "wishlisted"
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
      if (input.operation === "collection.create") {
        // Synthetic executor only, SQL correctness belongs to 083/093 proofs.
        const command = parseCollectionCreation(request), binder = projectCollectionCreation(command, owner)
        const first = state.tables.binders[0]
        state.tables.binders.push({ ...first, id: command.collectionId, name: command.name, is_default: false, position: state.tables.binders.length,
          binder_rows: command.grid?.rows ?? 2, binder_cols: command.grid?.cols ?? 2, storage_kind: command.kind,
          default_presentation: command.defaultPresentation, location: command.location })
        state.tables.storage_collection_state.push({ ...state.tables.storage_collection_state[0], collection_id: command.collectionId,
          version: 0, layout_revision: 0, preset_manifest: command.manifest })
        state.tables.binder_slots.push(...binder.slots.map((slot, position) => ({ id: slot.id, owner_user_id: owner, collection_id: command.collectionId,
          position, target: slot.target, status: null, wanted_cards: [], preset_origin: slot.presetOrigin, version: 0 })))
        state.tables.inventory_owner_state[0].inventory_revision = snapshot.inventoryRevision + 1
        const result = { inventoryRevision: snapshot.inventoryRevision + 1, collectionId: command.collectionId, collectionVersion: 0,
          layoutRevision: 0, changed: true, slotIds: command.slotIds, recoverySupported: false }
        ledger.set(key, { body, audit, result })
        return Response.json(result)
      }
      const catalog = browserHostCatalog(await readInventoryCatalog(state.client, snapshot, new AbortController().signal, () => {}))
      const next = projectSlotIntent(snapshot, { kind: input.operation, request,
        context: { source: "app", clientId: null, operationId: key, batchId: key, clientOccurredAt: null } } as Parameters<typeof projectSlotIntent>[1], catalog)
      if (id.startsWith("raw-")) {
        const removed = snapshot.items.find(i => !next.items.some(n => n.id === i.id))
        if (removed) removedRaw = { item: structuredClone(state.tables.inventory_items.find(i => i.id === removed.id)!),
          placement: structuredClone(state.tables.inventory_placements.find(p => p.inventory_item_id === removed.id)) }
      }
      state.tables.inventory_owner_state[0].inventory_revision = next.inventoryRevision
      for (const binder of next.binders) {
        const stored = state.tables.storage_collection_state.find(c => c.collection_id === binder.collectionId)!
        stored.version = next.collections.find(c => c.id === binder.collectionId)!.version
        stored.layout_revision = binder.layoutRevision
      }
      state.tables.binder_slots = next.binders.flatMap(b => b.slots.map((s, position) => ({ id: s.id, owner_user_id: owner, collection_id: b.collectionId,
        position, target: s.target, status: s.status, wanted_cards: s.wantedCards, preset_origin: s.presetOrigin, version: s.version })))
      state.tables.inventory_items = next.items.map(i => ({ ...state.tables.inventory_items.find(row => row.id === i.id),
        id: i.id, owner_user_id: owner, identity: i.identity, grading: i.grading, acquired_at: i.acquiredAt, version: i.version, legacy_source: i.legacySource ?? null }))
      state.tables.inventory_placements = next.placements.map(p => ({ inventory_item_id: p.inventoryItemId, owner_user_id: owner,
        collection_id: p.collectionId, slot_id: p.slotId, version: p.version }))
      const result = input.operation === "inventory" ? { inventoryRevision: next.inventoryRevision, changed: next.inventoryRevision !== snapshot.inventoryRevision,
        selectedItemIds: next.items.filter(i => i.version !== snapshot.items.find(old => old.id === i.id)?.version
          || next.placements.some(p => p.inventoryItemId === i.id && !snapshot.placements.some(old => old.inventoryItemId === i.id))).map(i => i.id),
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
