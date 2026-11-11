import { rawRestoreV2GraphBytes } from '@/lib/raw-restore-envelope'
import { backupContentKey, freezeBackupPlan, hydrateBackupSnapshot, parseBinderBackupV2 } from '@/lib/binder-backup-v2'
import { isCompleteInventorySnapshot, type CompleteInventorySnapshot } from '@/lib/collection/slot-snapshot'
import type { InventoryLayoutEvidence } from '@/lib/domain/inventory-browse'
import { RawRestoreEnvelopeError, RAW_RESTORE_V2_LIMITS, parseRawRestoreCommand, type RawRestorePlanningScope, type RawRestoreCommand } from '@/lib/domain/raw-restore'

export const rawRestoreSavedEntries = (slots: readonly { status: string | null; wantedCards: readonly unknown[] }[]) =>
  slots.reduce((n, s) => n + Math.max(s.wantedCards.length, s.status === 'wishlisted' ? 1 : 0) + (s.status === 'considering' ? 1 : 0), 0)

/** Trusted current planning evidence comes from the authenticated private complete-read adapter.
 * This does not attest the file's historical origin. Explicit current collection/slot selections
 * authorize desired content; matching file IDs, certificates or owner fields never establish provenance.
 */
export function planRawContentRestore(input: {
  text: string
  current: CompleteInventorySnapshot
  evidence: RawRestorePlanningScope
  currentScope: RawRestorePlanningScope
  layouts: readonly InventoryLayoutEvidence[]
  operationId: string
  savedEntryRemaining: number
  choices: { collectionId: string; slotIds: string[]; releaseItemIds: string[]; restoreContent: true }
}) {
  const fail = (): never => { throw new Error('Review one complete unchanged-configuration raw collection with explicit current-scope restore choices') }
  if (!isCompleteInventorySnapshot(input.current) || backupContentKey(input.evidence) !== backupContentKey(input.currentScope)
    || input.evidence.ownerUserId !== input.current.ownerUserId || input.evidence.partnerUserId === undefined
    || !Number.isSafeInteger(input.savedEntryRemaining) || input.savedEntryRemaining < 0 || input.choices.restoreContent !== true) return fail()
  const backup = parseBinderBackupV2(input.text)
  if (backup.scope !== 'collection' || backup.collections.length !== 1 || backup.appearance.length || backup.binders.length !== 1) return fail()
  const current = input.current, collectionId = input.choices.collectionId
  const collection = current.collections.find(c => c.id === collectionId), binder = current.binders.find(b => b.collectionId === collectionId)
  const source = backup.collections[0], sourceBinder = backup.binders[0]
  const { version: _sourceVersion, ...sourceConfig } = source
  const { version: _currentVersion, ownerUserId: _owner, ...currentConfig } = collection ?? { version: 0, ownerUserId: '' }
  if (!collection || !binder || source.id !== collectionId || sourceBinder.collectionId !== collectionId
    || backupContentKey(sourceConfig) !== backupContentKey(currentConfig)
    || backupContentKey(sourceBinder.presetManifest) !== backupContentKey(binder.presetManifest)
    || !backup.layouts || backupContentKey(backup.layouts.map(({ layoutRevision: _revision, ...l }) => l)) !== backupContentKey(input.layouts.filter(l => l.collectionId === collectionId).map(({ layoutRevision: _revision, ...l }) => l))
    || backupContentKey(input.choices.slotIds) !== backupContentKey(binder.slots.map(s => s.id))
    || backupContentKey(sourceBinder.slots.map(s => s.id).sort()) !== backupContentKey([...input.choices.slotIds].sort())
    || sourceBinder.slots.some(s => backupContentKey(s.presetOrigin) !== backupContentKey(binder.slots.find(b => b.id === s.id)?.presetOrigin))) return fail()
  const desired = hydrateBackupSnapshot(backup, current.ownerUserId, input.evidence.partnerUserId ?? undefined)
  const desiredIds = new Set(desired.placements.map(p => p.inventoryItemId))
  const touched = new Set([...desiredIds, ...current.placements.filter(p => p.collectionId === collectionId).map(p => p.inventoryItemId)])
  const items: RawRestoreCommand['items'] = []
  for (const id of [...touched].sort()) {
    const item = current.items.find(i => i.id === id), original = desired.items.find(i => i.id === id)
    const placement = current.placements.find(p => p.inventoryItemId === id)
    if (!item || item.grading !== null || placement && placement.collectionId !== collectionId) return fail()
    if (original && (original.grading !== null || backupContentKey(original.identity) !== backupContentKey(item.identity)
      || original.acquiredAt !== item.acquiredAt)) return fail()
    const slot = placement ? binder.slots.find(s => s.id === placement.slotId)! : null
    items.push({ itemId: id, itemVersion: item.version, placement: placement && slot ? { collectionId, slot: {
      id: slot.id, version: slot.version, inventoryItemId: id, itemVersion: item.version, placementVersion: placement.version,
    } } : null })
  }
  const releases = items.filter(i => i.placement && !desiredIds.has(i.itemId)).map(i => i.itemId)
  if (backupContentKey([...input.choices.releaseItemIds].sort()) !== backupContentKey(releases)) return fail()
  if (rawRestoreSavedEntries(desired.binders[0].slots) - rawRestoreSavedEntries(binder.slots) > input.savedEntryRemaining) return fail()
  const slotOrder = { before: binder.slots.map(s => s.id), after: sourceBinder.slots.map(s => s.id) }
  const converted = binder.presetManifest?.source.version === 'legacy-v1'
  const reordered = backupContentKey(slotOrder.before) !== backupContentKey(slotOrder.after)
  const request = parseRawRestoreCommand({ version: converted ? 4 : reordered ? 3 : 2, ...((converted || reordered) ? { slotOrder } : {}), manifest: binder.presetManifest, operationId: input.operationId, inventoryRevision: current.inventoryRevision,
    configuration: { name: collection.name, kind: collection.kind, defaultPresentation: collection.defaultPresentation, location: collection.location ?? null,
      rows: input.layouts.find(l => l.collectionId === collectionId)!.rows, cols: input.layouts.find(l => l.collectionId === collectionId)!.cols },
    planning: input.evidence, collection: { collectionId, version: collection.version, layoutRevision: binder.layoutRevision },
    slots: binder.slots.map(s => {
      const ref = items.find(i => i.itemId === s.inventoryItemId)
      const { ownerUserId: _owner, collectionId: _collection, version: _version, ...after } = desired.binders[0].slots.find(d => d.id === s.id)!
      return { before: { id: s.id, version: s.version, inventoryItemId: s.inventoryItemId, itemVersion: ref?.itemVersion ?? null,
        placementVersion: ref?.placement?.slot.placementVersion ?? null }, after }
    }), items, releaseItemIds: releases })
  if (rawRestoreV2GraphBytes(current, desired.binders[0]) > RAW_RESTORE_V2_LIMITS.graphBytes) {
    throw new RawRestoreEnvelopeError('Restore private before/after recovery graph exceeds 2.5 MiB. Nothing has been queued.')
  }
  return freezeBackupPlan({ request, precondition: backupContentKey(current),
    placements: items.map(i => ({ itemId: i.itemId, from: i.placement?.slot.id ?? null, to: desired.placements.find(p => p.inventoryItemId === i.itemId)?.slotId ?? null })),
    scope: structuredClone(input.evidence) })
}
export type RawContentRestorePlan = ReturnType<typeof planRawContentRestore>
