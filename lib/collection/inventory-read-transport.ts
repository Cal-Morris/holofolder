import { isContractRecord, isSlotContractId, isSlotRevision } from "@/lib/domain/binder-slots"
import { normalizeInventorySnapshot, type InventorySnapshot } from "@/lib/domain/inventory"

/** Private first-party wire contract. Counts are independent server HEAD/count fences. */
export interface InventoryReadEvidence {
  inventoryRevision: number
  items: number
  placements: number
  collections: number
  binders: number
  slots: number
  storage: { collectionId: string; collectionVersion: number; layoutRevision: number; slotCount: number }[]
}
export interface InventoryReadScope {
  actorUserId: string
  ownerUserId: string
  /** Verified JWT session_id, separate from the device lifecycle epoch. */
  authSessionId: string
  /** Rotate on signout, account/owner/membership change and unlink/relink. Never persist. */
  sessionId: string
}
export interface InventoryReadEnvelope {
  version: 1
  requestId: string
  scope: InventoryReadScope
  evidence: InventoryReadEvidence
  snapshot: InventorySnapshot
}
export function isInventoryReadScope(value: unknown): value is InventoryReadScope {
  return isContractRecord(value, ["actorUserId", "ownerUserId", "authSessionId", "sessionId"])
    && [value.actorUserId, value.ownerUserId, value.authSessionId, value.sessionId].every(isSlotContractId)
}
export function sameInventoryReadScope(a: InventoryReadScope | null, b: InventoryReadScope) {
  return !!a && a.actorUserId === b.actorUserId && a.ownerUserId === b.ownerUserId
    && a.authSessionId === b.authSessionId && a.sessionId === b.sessionId
}

/** Only call on this invocation's authenticated same-origin no-store HTTP response.
 * Shape validation alone does not authenticate arbitrary JSON or localStorage. */
export function parseInventoryReadEnvelope(value: unknown, requestId: string, scope: InventoryReadScope): InventoryReadEnvelope | undefined {
  if (!isContractRecord(value, ["version", "requestId", "scope", "evidence", "snapshot"])
    || value.version !== 1 || value.requestId !== requestId || !isInventoryReadScope(value.scope)
    || !sameInventoryReadScope(value.scope, scope)) return undefined
  const snapshot = normalizeInventorySnapshot(value.snapshot), e = value.evidence
  if (!snapshot || snapshot.ownerUserId !== scope.ownerUserId
    || !isContractRecord(e, ["inventoryRevision", "items", "placements", "collections", "binders", "slots", "storage"])
    || ![e.inventoryRevision, e.items, e.placements, e.collections, e.binders, e.slots].every(isSlotRevision)
    || e.inventoryRevision !== snapshot.inventoryRevision
    || e.items !== snapshot.items.length || e.placements !== snapshot.placements.length
    || e.collections !== snapshot.collections.length || e.binders !== snapshot.binders.length
    || !Array.isArray(e.storage) || e.storage.length !== snapshot.binders.length) return undefined
  const storage: InventoryReadEvidence["storage"] = []
  for (const raw of e.storage) {
    if (!isContractRecord(raw, ["collectionId", "collectionVersion", "layoutRevision", "slotCount"])
      || !isSlotContractId(raw.collectionId) || !isSlotRevision(raw.collectionVersion)
      || !isSlotRevision(raw.layoutRevision) || !isSlotRevision(raw.slotCount)
      || storage.some(s => s.collectionId === raw.collectionId)) return undefined
    const collection = snapshot.collections.find(c => c.id === raw.collectionId)
    const binder = snapshot.binders.find(b => b.collectionId === raw.collectionId)
    if (!collection || !binder || collection.version !== raw.collectionVersion
      || binder.layoutRevision !== raw.layoutRevision || binder.slots.length !== raw.slotCount) return undefined
    storage.push({ collectionId: raw.collectionId, collectionVersion: raw.collectionVersion, layoutRevision: raw.layoutRevision, slotCount: raw.slotCount })
  }
  if (storage.reduce((sum, s) => sum + s.slotCount, 0) !== e.slots) return undefined
  return { version: 1, requestId, scope: { ...scope }, snapshot,
    evidence: { inventoryRevision: e.inventoryRevision as number, items: e.items as number, placements: e.placements as number,
      collections: e.collections as number, binders: e.binders as number, slots: e.slots as number, storage } }
}
