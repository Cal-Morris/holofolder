import type { OperationIntentContext } from '@/lib/domain/audit-context'
import type { CollectionNavigationRead } from '@/lib/collection-navigation'
import { INVENTORY_COLLECTION_DELETE_LIMITS } from '@/lib/domain/inventory-commands'
import { isCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot'
import { parseSlotIntent, projectSlotIntent } from '@/lib/collection/slot-optimistic'

/** Includes the private default and membership facts, never inferred from picker order or cached state. */
export function collectionDeletionEvidence(read: CollectionNavigationRead) {
  if (read.evidence.kind !== 'complete' || !isCompleteInventorySnapshot(read.evidence.snapshot)
    || read.scope.ownerUserId !== read.evidence.snapshot.ownerUserId || !read.scope.sessionId
    || read.partnerUserId === undefined || !read.defaultCollectionId
    || !read.evidence.snapshot.collections.some(c => c.id === read.defaultCollectionId)) throw new Error('Complete current native storage, membership and default evidence are required. Mixed legacy storage is unsupported.')
  return JSON.stringify([read.scope, read.partnerUserId, read.defaultCollectionId, read.evidence.snapshot])
}

/** The existing exclusive deleteCollection family owns the full bounded atomic intent. */
export function prepareCollectionDeletion(read: CollectionNavigationRead, collectionId: string, replacementId: string | null, context: OperationIntentContext) {
  const evidence = collectionDeletionEvidence(read)
  if (read.evidence.kind !== 'complete') throw new Error('fresh-scoped-read-required')
  const snapshot = read.evidence.snapshot
  const collection = snapshot.collections.find(c => c.id === collectionId), binder = snapshot.binders.find(b => b.collectionId === collectionId)
  if (!collection || !binder || snapshot.collections.length < 2) throw new Error('Keep at least one collection. This collection cannot be deleted.')
  if (binder.slots.length > INVENTORY_COLLECTION_DELETE_LIMITS.slots) throw new Error('This collection exceeds the supported 4096-slot atomic deletion bound. Nothing was handed off; partial deletion is unsupported.')
  if (collectionId === read.defaultCollectionId ? !replacementId || replacementId === collectionId
    || !snapshot.collections.some(c => c.id === replacementId) || !snapshot.binders.some(b => b.collectionId === replacementId) : replacementId !== null) throw new Error('Choose an explicit current native replacement for the default collection.')
  const items = new Map(snapshot.items.map(i => [i.id, i])), placements = new Map(snapshot.placements.map(p => [p.slotId, p]))
  const rows = binder.slots.map((slot, n) => ({ slot: structuredClone(slot), item: structuredClone(items.get(slot.inventoryItemId ?? '') ?? null), position: n + 1 }))
  const refs = [collectionId, ...(replacementId ? [replacementId] : [])].map(id => ({ collectionId: id,
    version: snapshot.collections.find(c => c.id === id)!.version, layoutRevision: snapshot.binders.find(b => b.collectionId === id)!.layoutRevision }))
  const intent = parseSlotIntent({ kind: 'inventory', context, request: { operationId: context.operationId,
    inventoryRevision: snapshot.inventoryRevision, collections: refs, commands: [{ kind: 'deleteCollection', collectionId,
      replacementDefaultCollectionId: replacementId, slots: rows.map(({ slot, item }) => ({ id: slot.id, version: slot.version,
        inventoryItemId: slot.inventoryItemId, itemVersion: item?.version ?? null, placementVersion: placements.get(slot.id)?.version ?? null })) }] } })
  // Validates every exact slot/item/placement precondition, without catalog guesses or ownership removal.
  projectSlotIntent(snapshot, intent, () => undefined)
  return { scope: { ownerUserId: snapshot.ownerUserId, collectionId, slotId: null }, intent, evidence,
    collection: structuredClone(collection), replacement: structuredClone(snapshot.collections.find(c => c.id === replacementId) ?? null), rows,
    counts: { slots: rows.length, targets: rows.filter(r => r.slot.target).length,
      wants: rows.reduce((n, r) => n + r.slot.wantedCards.length, 0), unassigned: rows.filter(r => r.item).length } }
}
export type CollectionDeletionDraft = ReturnType<typeof prepareCollectionDeletion>
