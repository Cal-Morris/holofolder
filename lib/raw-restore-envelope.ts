import { rawRestoreV2JsonbBytes } from '@/lib/domain/raw-restore'
import type { InventorySnapshot } from '@/lib/domain/inventory'
import type { BinderSnapshot } from '@/lib/domain/binder-slots'

/** Conservative 095 private graph estimate. Complete reads expose order, not persisted positions;
 * reserve the largest valid position for both slot states. SQL checks the exact locked graph.
 */
export function rawRestoreV2GraphBytes(current: InventorySnapshot, desired: BinderSnapshot) {
  const collectionId = desired.collectionId, owner = current.ownerUserId
  const before = current.binders.find(b => b.collectionId === collectionId)!
  const collection = current.collections.find(c => c.id === collectionId)!
  const graph: { table: string; id: string; before: unknown; after: unknown }[] = []
  for (const [n, slot] of before.slots.entries()) {
    const persisted = { id: slot.id, owner_user_id: owner, collection_id: collectionId, position: Number.MAX_SAFE_INTEGER,
      target: slot.target, status: slot.status, wanted_cards: slot.wantedCards, preset_origin: slot.presetOrigin, version: slot.version }
    const after = desired.slots[n]
    graph.push({ table: 'binder_slots', id: slot.id, before: persisted, after: { ...persisted,
      target: after.target, status: after.status, wanted_cards: after.wantedCards, version: slot.version + 1 } })
  }
  const old = current.placements.filter(p => p.collectionId === collectionId)
  const ids = new Set([...old.map(p => p.inventoryItemId), ...desired.slots.flatMap(s => s.inventoryItemId === null ? [] : [s.inventoryItemId])])
  for (const id of ids) {
    const placed = old.find(p => p.inventoryItemId === id), slot = desired.slots.find(s => s.inventoryItemId === id)
    const state = (slotId: string, version: number) => ({ inventory_item_id: id, owner_user_id: owner, collection_id: collectionId, slot_id: slotId, version })
    graph.push({ table: 'inventory_placements', id, before: placed ? state(placed.slotId, placed.version) : null,
      after: slot ? state(slot.id, placed ? placed.version + 1 : 0) : null })
  }
  const root = { collection_id: collectionId, owner_user_id: owner, kind: collection.kind, default_presentation: collection.defaultPresentation,
    version: collection.version, layout_revision: before.layoutRevision, preset_manifest: before.presetManifest, authority: 'slots',
    conversion_version: null, converted_at: null, conversion_receipt: null, location: collection.location ?? null }
  graph.push({ table: 'storage_collection_state', id: collectionId, before: root, after: { ...root, version: root.version + 1 } },
    { table: 'inventory_owner_state', id: owner, before: { owner_user_id: owner, inventory_revision: current.inventoryRevision },
      after: { owner_user_id: owner, inventory_revision: current.inventoryRevision + 1 } })
  return rawRestoreV2JsonbBytes(graph)
}
