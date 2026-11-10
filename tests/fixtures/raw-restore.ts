import type { InventorySnapshot } from '@/lib/domain/inventory'
import { createBinderBackupV2 } from '@/lib/binder-backup-v2'
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot'

export const rawOwner = '00940000-0000-4000-8000-000000000001'
export const rawPartner = '00940000-0000-4000-8000-000000000002'
export const rawCollection = '00940000-0000-4000-8000-000000000011'
export async function rawRestoreFixture() {
  const snapshot: InventorySnapshot = { ownerUserId: rawOwner, inventoryRevision: 8,
    collections: [{ id: rawCollection, ownerUserId: rawOwner, name: 'Synthetic raw', kind: 'binder', defaultPresentation: 'binder', location: null, version: 2 }],
    binders: [{ ownerUserId: rawOwner, collectionId: rawCollection, layoutRevision: 3, presetManifest: null,
      slots: ['a', 'b'].map((k, n) => ({ id: 'slot-' + k, ownerUserId: rawOwner, collectionId: rawCollection, version: 4,
        target: null, status: 'collected', inventoryItemId: 'copy-' + (n ? 'a' : 'b'), wantedCards: [], presetOrigin: null })) }],
    items: ['a', 'b'].map(k => ({ id: 'copy-' + k, ownerUserId: rawOwner, identity: { kind: 'pokemon', pokemonId: 1 }, grading: null, legacySource: null, acquiredAt: null, version: 1 })),
    placements: ['a', 'b'].map((k, n) => ({ inventoryItemId: 'copy-' + k, collectionId: rawCollection, slotId: n ? 'slot-a' : 'slot-b', version: 2 })) }
  const brand = (s: InventorySnapshot) => {
    const page = <T>(rows: T[]) => async () => ({ rows, total: rows.length, inventoryRevision: s.inventoryRevision, next: null })
    return readCompleteInventorySnapshot(rawOwner, s.inventoryRevision, { items: page(s.items), placements: page(s.placements), collections: page(s.collections), binders: page(s.binders) })
  }
  const previous = structuredClone(snapshot)
  previous.binders[0].slots[0].inventoryItemId = 'copy-a'
  previous.binders[0].slots[1].inventoryItemId = null; previous.binders[0].slots[1].status = null
  previous.placements = [{ inventoryItemId: 'copy-a', collectionId: rawCollection, slotId: 'slot-a', version: 1 }]
  const layouts = [{ collectionId: rawCollection, layoutRevision: 3, rows: 3, cols: 3 }]
  const backup = createBinderBackupV2({ snapshot: previous, completeness: 'complete-owner', scope: 'collection', collectionId: rawCollection, layouts })
  const scope = { actorUserId: rawPartner, ownerUserId: rawOwner, source: 'app' as const, credentialId: null, authSessionId: 'synthetic-auth-session', partnershipId: '00940000-0000-4000-8000-000000000003', partnerUserId: rawPartner }
  return { snapshot, brand, input: { text: JSON.stringify(backup), current: await brand(snapshot), evidence: scope, currentScope: scope, layouts,
    operationId: 'synthetic-raw-restore', savedEntryRemaining: 10,
    choices: { collectionId: rawCollection, slotIds: ['slot-a', 'slot-b'], releaseItemIds: ['copy-b'], restoreContent: true as const } } }
}
