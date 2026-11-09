import { isCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"
import type { AtomicOfflineStore } from "@/lib/offline-store/kv"
import { isContractRecord, isSlotContractId, isSlotRevision } from "@/lib/domain/binder-slots"
import { normalizeInventorySnapshot, type InventorySnapshot, type InventoryCatalogResolver } from "@/lib/domain/inventory"
import { legacySlotId } from "@/lib/legacy-binder-transition"
import { parseSlotIntent, projectSlotIntent, sameValue, type SlotOfflineIntent } from "@/lib/collection/slot-optimistic"

export interface SlotOfflineScope { deviceId: string; workspaceId: string; accountId: string | null; ownerUserId: string | null }
export interface LegacySlotArchive {
  workspaceId: string; collectionId: string; rawSnapshot: string | null; rawQueue: string | null
  mapping: { operationId: string; slotId: string }[]
}
export interface PendingSlotIntent {
  intent: SlotOfflineIntent
  base: InventorySnapshot
  status: "pending" | "sending" | "unavailable" | "conflict" | "blocked" | "billing"
  attempts: number
  nextAttemptAt: number
  /** A sending record survives crashes; its request is immutable until a known rejection. */
  lease: { id: string; until: number } | null
  conflict: { reason: string; current: InventorySnapshot | null; rejected: boolean } | null
}
export interface SlotOfflineRecord {
  version: 1
  scope: SlotOfflineScope
  snapshot: InventorySnapshot | null
  optimistic: InventorySnapshot | null
  pending: PendingSlotIntent[]
  receipts: { operationId: string; intent: SlotOfflineIntent; outcome: "acknowledged" | "superseded" | "cancelled" }[]
  legacy: LegacySlotArchive[]
}
export type SlotReplayResult = { status: number; code?: string; operationId?: string; snapshot?: unknown }
function fail(reason: string): never { throw new Error(reason) }
function validateScope(scope: SlotOfflineScope) {
  if (!isContractRecord(scope, ["deviceId", "workspaceId", "accountId", "ownerUserId"]) || !isSlotContractId(scope.deviceId) || !isSlotContractId(scope.workspaceId)
    || !((scope.accountId === null && scope.ownerUserId === null) || (isSlotContractId(scope.accountId) && isSlotContractId(scope.ownerUserId)))) fail("invalid-scope")
}
export function offlineScopeKey(scope: SlotOfflineScope) {
  validateScope(scope)
  return `slot-intent:v1:${JSON.stringify([scope.deviceId, scope.workspaceId, scope.accountId, scope.ownerUserId])}`
}
function scopedSnapshot(value: unknown, scope: SlotOfflineScope): InventorySnapshot {
  const snapshot = normalizeInventorySnapshot(value)
  if (!snapshot || snapshot.ownerUserId !== (scope.ownerUserId ?? scope.workspaceId)) return fail("invalid-scoped-snapshot")
  return snapshot
}
function archive(input: Omit<LegacySlotArchive, "mapping">): LegacySlotArchive {
  if (!isContractRecord(input, ["workspaceId", "collectionId", "rawSnapshot", "rawQueue"]) || !isSlotContractId(input.workspaceId) || !isSlotContractId(input.collectionId)
    || ![input.rawSnapshot, input.rawQueue].every(v => v === null || typeof v === "string")) return fail("invalid-legacy-archive")
  const mapping: LegacySlotArchive["mapping"] = []
  // Raw bytes are retained even when a legacy payload is malformed/unknown. Never filter the source queue.
  try {
    const ops: unknown = JSON.parse(input.rawQueue ?? "null")
    if (Array.isArray(ops)) for (const op of ops) {
      if (op && typeof op === "object" && "id" in op && "pokemonId" in op && typeof op.id === "string" && typeof op.pokemonId === "number") {
        const binderId = "binderId" in op && typeof op.binderId === "string" ? op.binderId : input.collectionId
        mapping.push({ operationId: op.id, slotId: legacySlotId(binderId, op.pokemonId) })
      }
    }
  } catch { /* Preserve unknown legacy bytes for explicit recovery, without inferring ownership. */ }
  return { ...input, mapping }
}
function parseRecord(raw: unknown, scope: SlotOfflineScope): SlotOfflineRecord {
  if (raw === undefined) return { version: 1, scope: structuredClone(scope), snapshot: null, optimistic: null, pending: [], receipts: [], legacy: [] }
  if (!isContractRecord(raw, ["version", "scope", "snapshot", "optimistic", "pending", "receipts", "legacy"]) || raw.version !== 1 || !sameValue(raw.scope, scope)
    || !Array.isArray(raw.pending) || !Array.isArray(raw.receipts) || !Array.isArray(raw.legacy)) return fail("unsupported-or-malformed-offline-record")
  const snapshot = raw.snapshot === null ? null : scopedSnapshot(raw.snapshot, scope)
  const optimistic = raw.optimistic === null ? null : scopedSnapshot(raw.optimistic, scope)
  const pending = raw.pending.map(p => {
    if (!isContractRecord(p, ["intent", "base", "status", "attempts", "nextAttemptAt", "lease", "conflict"])
      || !["pending", "sending", "unavailable", "conflict", "blocked", "billing"].includes(p.status as string)
      || !isSlotRevision(p.attempts) || p.attempts > 5 || !isSlotRevision(p.nextAttemptAt)
      || !(p.lease === null || (isContractRecord(p.lease, ["id", "until"]) && isSlotContractId(p.lease.id) && isSlotRevision(p.lease.until)))
      || !(p.conflict === null || (isContractRecord(p.conflict, ["reason", "current", "rejected"]) && typeof p.conflict.reason === "string" && typeof p.conflict.rejected === "boolean"))) return fail("malformed-pending-intent")
    return { ...structuredClone(p), intent: parseSlotIntent(p.intent), base: scopedSnapshot(p.base, scope),
      conflict: p.conflict === null ? null : { ...p.conflict, current: p.conflict.current === null ? null : scopedSnapshot(p.conflict.current, scope) } } as PendingSlotIntent
  })
  const receipts = raw.receipts.map(r => {
    if (!isContractRecord(r, ["operationId", "intent", "outcome"]) || !["acknowledged", "superseded", "cancelled"].includes(r.outcome as string)) return fail("malformed-receipt")
    const intent = parseSlotIntent(r.intent)
    if (r.operationId !== intent.request.operationId) return fail("malformed-receipt")
    return { operationId: r.operationId, intent, outcome: r.outcome } as SlotOfflineRecord["receipts"][number]
  })
  const ids = [...pending.map(p => p.intent.request.operationId), ...receipts.map(r => r.operationId)]
  if (new Set(ids).size !== ids.length || (pending.length && (!snapshot || !optimistic))) return fail("malformed-operation-ledger")
  const legacy = raw.legacy.map(a => {
    if (!isContractRecord(a, ["workspaceId", "collectionId", "rawSnapshot", "rawQueue", "mapping"])) return fail("malformed-legacy-archive")
    const { mapping, ...source } = a
    const normalized = archive(source as unknown as Omit<LegacySlotArchive, "mapping">)
    if (!sameValue(mapping, normalized.mapping) || normalized.workspaceId !== scope.workspaceId) return fail("malformed-legacy-mapping")
    return normalized
  })
  return { version: 1, scope: structuredClone(scope), snapshot, optimistic, pending, receipts, legacy }
}
function reproject(record: SlotOfflineRecord, catalog: InventoryCatalogResolver) {
  let current = record.snapshot!
  for (const pending of record.pending) {
    // Never make a fresh remote snapshot authoritative over an unresolved local edit.
    if (pending.status === "conflict" || pending.status === "blocked") break
    try { current = projectSlotIntent(current, pending.intent, catalog) }
    catch (error) {
      pending.status = "conflict"
      pending.conflict = { reason: error instanceof Error ? error.message : "projection-conflict", current: structuredClone(current), rejected: false }
      break
    }
  }
  record.optimistic = current
}

/** One authoritative staged queue/snapshot record in binderdex-offline, no localStorage shadow queue.
 * Deliberately unused by the legacy application until conversion/rollout gates pass. */
export function createSlotOfflineQueue(store: AtomicOfflineStore, inputScope: SlotOfflineScope) {
  const scope = structuredClone(inputScope), key = offlineScopeKey(scope)
  const update = (change: (record: SlotOfflineRecord) => void) => store.update(key, raw => {
    const record = parseRecord(raw, scope)
    change(record)
    return parseRecord(record, scope)
  })
  const read = async () => parseRecord(await store.get(key), scope)
  return {
    read,
    async saveSnapshot(raw: unknown, catalog: InventoryCatalogResolver = () => undefined) {
      if (!isCompleteInventorySnapshot(raw)) fail("partial-or-unverified-snapshot")
      const snapshot = scopedSnapshot(raw, scope)
      await update(record => {
        if (record.snapshot && snapshot.inventoryRevision < record.snapshot.inventoryRevision) fail("stale-snapshot")
        record.snapshot = snapshot
        reproject(record, catalog)
      })
    },
    async enqueue(raw: SlotOfflineIntent, catalog: InventoryCatalogResolver) {
      const intent = parseSlotIntent(raw)
      await update(record => {
        const existing = record.pending.find(p => p.intent.request.operationId === intent.request.operationId)?.intent
          ?? record.receipts.find(r => r.operationId === intent.request.operationId)?.intent
        if (existing) { if (!sameValue(existing, intent)) fail("idempotency-conflict"); return }
        if (!record.optimistic || record.pending.some(p => ["conflict", "blocked", "billing"].includes(p.status))) fail("queue-reconciliation-required")
        const next = projectSlotIntent(record.optimistic, intent, catalog)
        record.pending.push({ intent, base: record.optimistic, status: "pending", attempts: 0, nextAttemptAt: 0, lease: null, conflict: null })
        record.optimistic = next
      })
    },
    async preserveLegacy(input: Omit<LegacySlotArchive, "mapping">) {
      const saved = archive(input)
      if (saved.workspaceId !== scope.workspaceId) fail("workspace-mismatch")
      await update(record => { if (!record.legacy.some(a => sameValue(a, saved))) record.legacy.push(saved) })
    },
    /** Explicit retry keeps the original operation ID even after an unknown outcome. */
    async resume(operationId: string) {
      await update(record => {
        const p = record.pending.find(p => p.intent.request.operationId === operationId)
        if (!p || p.lease || p.status === "conflict") fail("reconciliation-required")
        p.status = "pending"; p.attempts = 0; p.nextAttemptAt = 0
      })
    },
    async replay(send: (intent: SlotOfflineIntent) => Promise<SlotReplayResult>, activeScope: () => SlotOfflineScope | null, now = Date.now(), catalog: InventoryCatalogResolver = () => undefined) {
      const active = () => sameValue(activeScope(), scope)
      if (!scope.accountId || !scope.ownerUserId || !active()) return
      const leaseId = crypto.randomUUID()
      let claimed: SlotOfflineIntent | null = null
      await update(record => {
        const p = record.pending[0]
        if (!p || !active() || ["conflict", "blocked", "billing"].includes(p.status) || p.attempts >= 5 || p.nextAttemptAt > now || (p.lease && p.lease.until > now)) return
        p.status = "sending"; p.attempts++; p.lease = { id: leaseId, until: now + 60000 }; claimed = structuredClone(p.intent)
      })
      if (!claimed || !active()) return
      let result: SlotReplayResult
      try { result = await send(claimed) } catch { result = { status: 0 } }
      if (!active()) return // Leave original lease/intent durable; a later session can replay the same ID.
      await update(record => {
        const p = record.pending[0]
        if (!active() || !p || p.lease?.id !== leaseId) return
        p.lease = null
        let current: InventorySnapshot | null = null
        try { if (isCompleteInventorySnapshot(result.snapshot)) { current = scopedSnapshot(result.snapshot, scope); if (current.inventoryRevision < record.snapshot!.inventoryRevision) current = null } } catch { /* Invalid/partial response is never an acknowledgment. */ }
        if (result.status === 200 && result.operationId === p.intent.request.operationId && current && current.inventoryRevision >= record.snapshot!.inventoryRevision) {
          record.receipts.push({ operationId: p.intent.request.operationId, intent: p.intent, outcome: "acknowledged" })
          record.pending.shift(); record.snapshot = current; reproject(record, catalog)
        } else if (result.status === 409) {
          const rejected = ["slot_revision_conflict", "inventory_revision_conflict", "inventory_collection_conflict", "slot_conflict", "item_conflict", "placement_conflict", "inventory_want_conflict", "inventory_copy_choice_required", "inventory_destination_empty", "inventory_destination_occupied"].includes(result.code ?? "")
          p.status = "conflict"; p.conflict = { reason: result.code ?? "unclassified-conflict", current, rejected }
        } else if (result.status === 402) {
          p.status = "billing"; p.conflict = { reason: "billing-paused", current: null, rejected: true }
        } else if ([400, 401, 403, 404].includes(result.status)) {
          p.status = "blocked"; p.conflict = { reason: `http-${result.status}`, current: null, rejected: true }
        } else {
          p.status = "unavailable"
          p.nextAttemptAt = now + Math.min(300000, 1000 * 2 ** (p.attempts - 1))
          p.conflict = { reason: result.status === 503 ? "staged-or-unavailable" : "unknown-outcome", current: null, rejected: false }
        }
      })
    },
    /** A human decision can retain remote state or supply a newly reviewed full intent.
     * Unknown outcomes cannot be cancelled or rewritten until their original ID is resolved. */
    async reconcile(operationId: string, decision: { kind: "keep-remote" } | { kind: "replace"; intent: SlotOfflineIntent }, catalog: InventoryCatalogResolver) {
      await update(record => {
        const p = record.pending[0], current = p?.conflict?.current
        if (!p || p.intent.request.operationId !== operationId || p.lease || !p.conflict?.rejected || !current || record.pending.length !== 1) fail("reconciliation-required")
        if (decision.kind === "keep-remote") {
          record.receipts.push({ operationId, intent: p.intent, outcome: "cancelled" })
          record.pending = []; record.snapshot = current; record.optimistic = current
        } else {
          const next = parseSlotIntent(decision.intent)
          if (next.request.operationId === operationId || record.receipts.some(r => r.operationId === next.request.operationId)) fail("new-operation-id-required")
          const optimistic = projectSlotIntent(current, next, catalog)
          record.receipts.push({ operationId, intent: p.intent, outcome: "superseded" })
          record.snapshot = current; record.optimistic = optimistic
          record.pending = [{ intent: next, base: current, status: "pending", attempts: 0, lease: null, nextAttemptAt: 0, conflict: null }]
        }
      })
    },
    /** Only known-rejected, non-overlapping content/metadata edits can be explicitly rebased.
     * Structural/move/selection changes require a new reviewed intent, never automatic copy cloning. */
    async rebase(operationId: string, newOperationId: string, catalog: InventoryCatalogResolver) {
      await update(record => {
        const p = record.pending[0], remote = p?.conflict?.current
        if (!p || p.intent.request.operationId !== operationId || !p.conflict?.rejected || !remote || record.pending.length !== 1) fail("reconciliation-required")
        const next = structuredClone(p.intent)
        if (next.kind === "slots") {
          if (next.request.commands.some(c => c.kind !== "update")) fail("structural-conflict-requires-explicit-intent")
          const before = p.base.binders.find(b => b.collectionId === next.request.collectionId)!, after = remote.binders.find(b => b.collectionId === next.request.collectionId)
          if (!after || before.layoutRevision !== after.layoutRevision) fail("structural-conflict-requires-explicit-intent")
          for (const command of next.request.commands) {
            if (command.kind !== "update") fail("structural-conflict")
            const a = before.slots.find(s => s.id === command.slot.id), b = after.slots.find(s => s.id === command.slot.id)
            if (!sameValue(a, b)) fail("overlapping-slot-conflict")
            const itemId = a?.inventoryItemId
            if (!sameValue(p.base.items.find(i => i.id === itemId), remote.items.find(i => i.id === itemId))
              || !sameValue(p.base.placements.find(i => i.inventoryItemId === itemId), remote.placements.find(i => i.inventoryItemId === itemId))) fail("placement-conflict")
          }
          next.request.collectionVersion = remote.collections.find(c => c.id === next.request.collectionId)!.version
        } else {
          if (next.request.commands.some(c => c.kind !== "edit")) fail("structural-or-selection-conflict-requires-explicit-intent")
          for (const c of next.request.commands) {
            if (c.kind !== "edit") fail("structural-conflict")
            if (!sameValue(p.base.items.find(i => i.id === c.item.itemId), remote.items.find(i => i.id === c.item.itemId))
              || !sameValue(p.base.placements.find(i => i.inventoryItemId === c.item.itemId), remote.placements.find(i => i.inventoryItemId === c.item.itemId))) fail("item-or-placement-conflict")
          }
          for (const ref of next.request.collections) {
            const collection = remote.collections.find(c => c.id === ref.collectionId), binder = remote.binders.find(b => b.collectionId === ref.collectionId)
            if (!collection || !binder) fail("collection-conflict")
            ref.version = collection.version; ref.layoutRevision = binder.layoutRevision
          }
        }
        if (newOperationId === operationId || record.receipts.some(r => r.operationId === newOperationId)) fail("new-operation-id-required")
        next.request.inventoryRevision = remote.inventoryRevision; next.request.operationId = newOperationId; next.context.operationId = newOperationId
        const optimistic = projectSlotIntent(remote, next, catalog)
        record.receipts.push({ operationId, intent: p.intent, outcome: "superseded" })
        record.snapshot = remote; record.optimistic = optimistic
        record.pending = [{ ...p, intent: next, base: remote, status: "pending", attempts: 0, lease: null, nextAttemptAt: 0, conflict: null }]
      })
    },
  }
}
