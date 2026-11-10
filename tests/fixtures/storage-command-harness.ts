import { parseRawRestoreCommand } from '@/lib/domain/raw-restore'
import { backupContentKey } from '@/lib/binder-backup-v2'
import { blankPreset } from '@/lib/binder-creation-draft'
import { projectCollectionCreation, parseCollectionCreation } from "@/lib/domain/storage-creation"
import { createClient } from "@supabase/supabase-js"
import { fixture } from "./inventory-read-server"
import { readOwnerInventorySnapshot } from "@/lib/server/inventory-read"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"
import { parseStorageRequest } from "@/lib/server/operations/storage-contract"
import { browserHostCatalog } from "@/lib/collection/browser-host-catalog"
import { readInventoryCatalog } from "@/lib/server/inventory-read-catalog"
import { emptyGradingRecord } from "@/lib/grading/draft"
import { seedSlotRemoval, seedSlotRemovalBound } from "./slot-removal-host"
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

  if (id.startsWith("native-consumer-")) {
    // Synthetic exact non-Pokémon printing, duplicate wants and separate owned copies.
    state.tables.tcg_sets = [{ id: "synthetic-native", name_en: "Synthetic native set" }]
    state.tables.tcg_cards = [{ id: "synthetic-native-trainer", set_id: "synthetic-native", local_id: "7",
      name_en: "Synthetic Native Trainer", name_json: { en: "Synthetic Native Trainer" }, external_ids_json: {} }]
    state.tables.tcg_card_dex_ids = []
    const want = { card_id: "synthetic-native-trainer", card_name: "Synthetic Native Trainer", card_language: "en", card_finish: "normal", added_at: "2026-01-01", wanted_by: [owner] }
    state.tables.binder_slots[0].wanted_cards = [want, { ...want }]
    state.tables.binder_slots[1].wanted_cards = [{ ...want }]
    state.tables.inventory_items = [0, 1].map(n => ({ id: `synthetic-native-copy-${n}`, owner_user_id: owner,
      identity: { kind: "card", cardId: "synthetic-native-trainer", language: "en", finish: "normal" }, grading: null,
      acquired_at: null, version: 0, legacy_source: null }))
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
    if (id.startsWith("raw-occupied-grade-")) {
      const graded = state.tables.inventory_items.find(i => i.id === "synthetic-raw-copy-2")!
      graded.grading = { ...emptyGradingRecord(), certificate: "SYNTHETIC-PRIVATE-CERT", label: { variant: "SYNTHETIC-LABEL", assetIds: ["synthetic-private-asset"] } }
      state.tables.inventory_placements.push({ inventory_item_id: graded.id, owner_user_id: owner,
        collection_id: other, slot_id: "synthetic-other-slot", version: 4 })
      state.tables.binder_slots.find(s => s.id === "synthetic-other-slot")!.status = "collected"
    }
  }
  if (id.startsWith("raw-bulk-")) {
    // Synthetic pagination fixture, distinct physical IDs with identical printing metadata.
    for (let n = 0; n < 43; n++) state.tables.inventory_items.push({ ...structuredClone(state.tables.inventory_items[1]), id: `synthetic-bulk-${String(n).padStart(2, "0")}` })
  }
  if (id.startsWith("delete-")) {
    seedSlotRemoval(state.tables, owner)
    state.tables.binders[0].is_default = !id.startsWith("delete-secondary-")
    const remaining = "33333333-3333-4333-8333-333333333333"
    state.tables.binders.push({ ...state.tables.binders[0], id: remaining, name: "Synthetic retained collection", is_default: id.startsWith("delete-secondary-") })
    state.tables.storage_collection_state.push({ ...state.tables.storage_collection_state[0], collection_id: remaining, preset_manifest: null })
    if (id.startsWith("delete-dex-") || id.startsWith("delete-max-")) {
      const size = id.startsWith("delete-dex-") ? 1025 : 4096
      state.tables.binder_slots = Array.from({ length: size }, (_, n) => ({ ...state.tables.binder_slots[0], id: `synthetic-slot-${n}`, position: n,
        target: { kind: "pokemon", pokemonId: n % 1025 + 1 }, preset_origin: null, status: n < 4 ? "collected" : null }))
      state.tables.binders[0].binder_rows = 8; state.tables.binders[0].binder_cols = 8
    }
    if (id.startsWith("delete-unknown-default-")) delete state.tables.binders[0].is_default
    if (id.startsWith("delete-legacy-")) state.tables.storage_collection_state[1].authority = "legacy"
  }
  if (id.startsWith("remove-")) seedSlotRemoval(state.tables, owner)
  if (id.startsWith("remove-bound-")) seedSlotRemovalBound(state.tables, owner)
  if (id.startsWith('restore-')) {
    state.tables.storage_collection_state[0].preset_manifest = blankPreset()
    for (let n = 0; n < 2; n++) {
      state.tables.inventory_items.push({ id: `synthetic-restore-copy-${n}`, owner_user_id: owner,
        identity: { kind: 'pokemon', pokemonId: 25 }, grading: null, acquired_at: null, version: 1, legacy_source: null })
      state.tables.inventory_placements.push({ inventory_item_id: `synthetic-restore-copy-${n}`, owner_user_id: owner,
        collection_id: collection, slot_id: `synthetic-slot-${n}`, version: 1 })
      state.tables.binder_slots[n].status = 'collected'
    }
  }
  if (id.startsWith('restore-dex-')) {
    const source = { id: 'synthetic-national-dex', version: '1' }
    const entries = Array.from({ length: 1025 }, (_, n) => ({ id: `pokemon-${n+1}`, target: { kind: 'pokemon', pokemonId: n+1 } }))
    state.tables.storage_collection_state[0].preset_manifest = { source, name: 'Synthetic National Dex', entries }
    state.tables.binder_slots = entries.map((entry, n) => ({ id: `synthetic-slot-${n}`, owner_user_id: owner, collection_id: collection,
      position: n, target: n < 2 ? null : entry.target, status: n < 2 ? 'collected' : null, wanted_cards: [],
      preset_origin: n === 1024 ? null : { source, entryId: entry.id }, version: 0 }))
  }

  let removedRaw: { item: Record<string, unknown>; placement?: Record<string, unknown> } | null = null

  let creationRejected = false

  const ledger = new Map<string, { body: string; audit: string; result: unknown }>()
  state.intercept((table) => table === 'get_billing_access' ? Response.json({ enforced: false, perpetual: true, saved_card_count: 0 }) : undefined)
  const originalRpc = state.client.rpc.bind(state.client)
  // Synthetic HTTP response, real Supabase RPC builder and trusted audit context.
  const rpcClient = createClient("https://synthetic.supabase.test", "synthetic-service", { auth: { persistSession: false }, global: { fetch: async (_input, init) => {
    const input = JSON.parse(String(init?.body)), audit = readAuditHeader() ?? ""
    const context = JSON.parse(audit || "null")
    if (!context || context.actor.userId !== actor || context.source !== "app" || input.owner_id !== owner) return Response.json({ code: "42501" }, { status: 403 })
    try {
      const request = parseStorageRequest(input.operation, input.request)
      const key = String(request.operationId), body = JSON.stringify(input)
      if (input.operation === 'backup.restore.raw') {
        const planning = parseRawRestoreCommand(request).planning, membership = state.tables.partnerships[0]
        const partner = membership ? (membership.user1_id === owner ? membership.user2_id : membership.user1_id) : null
        if (planning.partnerUserId !== partner || planning.partnershipId !== (membership?.id ?? null)) return Response.json({ code: '42501' }, { status: 403 })
      }
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
        const result = { ...(input.operation === 'backup.restore.raw' && 'version' in request && request.version === 2 ? { version: 2 } : {}), outcome: "rejected", operationId: key, code: input.operation === "slots" ? "slot_revision_conflict" : "inventory_revision_conflict", inventoryRevision: snapshot.inventoryRevision }
        ledger.set(key, { body, audit, result })
        return Response.json(result)
      }
      if (input.operation === 'backup.restore.raw') {
        const command = parseRawRestoreCommand(request)
        const current = snapshot.collections.find(c => c.id === command.collection.collectionId)!, binder = snapshot.binders.find(b => b.collectionId === current.id)!
        const stored = state.tables.binders.find(c => c.id === current.id)!
        const reject = (code: string) => {
          const result = { ...(command.version === 2 ? { version: 2 } : {}), outcome: 'rejected', operationId: key, code, inventoryRevision: snapshot.inventoryRevision }
          ledger.set(key, { body, audit, result }); return Response.json(result)
        }
        if (command.inventoryRevision !== snapshot.inventoryRevision) return reject('inventory_revision_conflict')
        if (command.collection.version !== current.version || command.collection.layoutRevision !== binder.layoutRevision
          || command.configuration.name !== current.name || command.configuration.rows !== stored.binder_rows || command.configuration.cols !== stored.binder_cols) return reject('raw_restore_collection_conflict')
        if (id.startsWith('restore-rejection-')) return reject('raw_restore_content_conflict')
        for (const pair of command.slots) {
          const slot = binder.slots.find(s => s.id === pair.before.id), item = snapshot.items.find(i => i.id === slot?.inventoryItemId)
          const placement = snapshot.placements.find(p => p.inventoryItemId === slot?.inventoryItemId)
          if (!slot || backupContentKey(pair.before) !== backupContentKey({ id: slot.id, version: slot.version, inventoryItemId: slot.inventoryItemId,
            itemVersion: item?.version ?? null, placementVersion: placement?.version ?? null })) return reject('raw_restore_content_conflict')
        }
        // Synthetic transaction projection. 094 SQL atomicity remains the parent's separate proof.
        state.tables.inventory_placements = state.tables.inventory_placements.filter(p => !command.items.some(i => i.itemId === p.inventory_item_id))
        for (const pair of command.slots) {
          const row = state.tables.binder_slots.find(s => s.id === pair.before.id)!
          Object.assign(row, { target: pair.after.target, status: pair.after.status, wanted_cards: pair.after.wantedCards, version: Number(row.version) + 1 })
          if (pair.after.inventoryItemId) state.tables.inventory_placements.push({ inventory_item_id: pair.after.inventoryItemId,
            owner_user_id: owner, collection_id: current.id, slot_id: pair.after.id,
            version: (command.items.find(i => i.itemId === pair.after.inventoryItemId)?.placement?.slot.placementVersion ?? 0) + 1 })
        }
        state.tables.inventory_owner_state[0].inventory_revision = snapshot.inventoryRevision + 1
        state.tables.storage_collection_state.find(c => c.collection_id === current.id)!.version = current.version + 1
        const result = { ...(command.version === 2 ? { version: 2 } : {}), changed: true, inventoryRevision: snapshot.inventoryRevision + 1, collectionId: current.id,
          collectionVersion: current.version + 1, layoutRevision: binder.layoutRevision, slotIds: command.slots.map(s => s.after.id), releasedItemIds: command.releaseItemIds }
        ledger.set(key, { body, audit, result }); return Response.json(result)
      }
      if (input.operation === "collection.create" && id.startsWith("creation-rejection-") && !creationRejected) {
        creationRejected = true
        // Synthetic concurrent edit, retained in the same lifetime ledger before a later fresh read.
        state.tables.inventory_owner_state[0].inventory_revision = snapshot.inventoryRevision + 1
        state.tables.binders[0].name = "Synthetic later edit"
        const result = { outcome: "rejected", operationId: key, code: "inventory_revision_conflict", inventoryRevision: snapshot.inventoryRevision + 1 }
        // A later legitimate edit makes the ledger proof historical, never a planning base.
        state.tables.inventory_owner_state[0].inventory_revision = snapshot.inventoryRevision + 2
        ledger.set(key, { body, audit, result })
        return Response.json(result)
      }
      if (input.operation === "collection.create") {
        // Synthetic executor only, SQL correctness belongs to 083/093 proofs.
        const command = parseCollectionCreation(request), binder = projectCollectionCreation(command, owner)
        const first = state.tables.binders[0]
        state.tables.binders.push({ ...first, id: command.collectionId, name: command.name, is_default: false, position: state.tables.binders.length,
          binder_rows: command.grid?.rows ?? 2, binder_cols: command.grid?.cols ?? 2 })
        state.tables.storage_collection_state.push({ ...state.tables.storage_collection_state[0], collection_id: command.collectionId,
          version: 0, layout_revision: 0, preset_manifest: command.manifest, kind: command.kind,
          default_presentation: command.defaultPresentation, location: command.location })
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
      // Synthetic cascade/default projection only; authoritative SQL has separate retained proof.
      if (input.operation === "inventory") {
        const deletion = (request as import("@/lib/domain/inventory-commands").InventoryCommandRequest).commands.find(c => c.kind === "deleteCollection")
        if (deletion?.kind === "deleteCollection") {
          const current = state.tables.binders.find(b => b.id === deletion.collectionId)!
          if (current.is_default && !deletion.replacementDefaultCollectionId || !current.is_default && deletion.replacementDefaultCollectionId) return Response.json({ code: "22023" }, { status: 400 })
          state.tables.binders = state.tables.binders.filter(b => b.id !== deletion.collectionId)
          state.tables.storage_collection_state = state.tables.storage_collection_state.filter(b => b.collection_id !== deletion.collectionId)
          if (deletion.replacementDefaultCollectionId) state.tables.binders.find(b => b.id === deletion.replacementDefaultCollectionId)!.is_default = true
        }
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
