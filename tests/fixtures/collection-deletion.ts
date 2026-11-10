import type { InventorySnapshot } from '@/lib/domain/inventory'
import type { CollectionNavigationRead } from '@/lib/collection-navigation'
import { readCompleteInventorySnapshot, type SnapshotPage } from '@/lib/collection/slot-snapshot'

export const deletionCollection = '22222222-2222-4222-8222-222222222222'
export const deletionRemaining = '33333333-3333-4333-8333-333333333333'
export const deletionOwner = '11111111-1111-4111-8111-111111111111'
/** Synthetic physical copies and goals only. */
export async function deletionRead(count = 5): Promise<CollectionNavigationRead> {
  const slots = Array.from({ length: count }, (_, n) => ({ id: `synthetic-delete-slot-${n}`, ownerUserId: deletionOwner,
    collectionId: deletionCollection, target: { kind: 'pokemon' as const, pokemonId: n % 1025 + 1 }, inventoryItemId: `synthetic-delete-copy-${n}`,
    wantedCards: [{ card_id: 'synthetic-want', card_name: 'Synthetic want', added_at: '2026-01-01' }], status: 'collected' as const, version: 2, presetOrigin: null }))
  const source: InventorySnapshot = { ownerUserId: deletionOwner, inventoryRevision: 7,
    collections: [deletionCollection, deletionRemaining].map(id => ({ id, ownerUserId: deletionOwner, name: `Synthetic ${id}`, kind: 'binder', defaultPresentation: 'binder', version: 3 })),
    binders: [{ collectionId: deletionCollection, ownerUserId: deletionOwner, layoutRevision: 4, slots, presetManifest: null },
      { collectionId: deletionRemaining, ownerUserId: deletionOwner, layoutRevision: 0, slots: [], presetManifest: null }],
    items: slots.map(s => ({ id: s.inventoryItemId, ownerUserId: deletionOwner, identity: { kind: 'pokemon', pokemonId: 25 }, grading: null, acquiredAt: null, version: 2 })),
    placements: slots.map(s => ({ inventoryItemId: s.inventoryItemId, slotId: s.id, collectionId: deletionCollection, version: 3 })) }
  const stream = <T>(rows: T[]) => async (): Promise<SnapshotPage<T>> => ({ inventoryRevision: 7, total: rows.length, rows, next: null })
  const snapshot = await readCompleteInventorySnapshot(deletionOwner, 7, { items: stream(source.items), placements: stream(source.placements), collections: stream(source.collections), binders: stream(source.binders) })
  return { scope: { accountUserId: deletionOwner, ownerUserId: deletionOwner, sessionId: 'synthetic-delete-session' }, partnerUserId: null,
    defaultCollectionId: deletionCollection, evidence: { kind: 'complete', snapshot }, catalog: [], layouts: [] }
}
