import { snapshot } from './binder-backup-v2'
import { createBinderBackupV2 } from '@/lib/binder-backup-v2'

export function arrangementFixture() {
  const current = snapshot(), source = structuredClone(current)
  // Export collection scope includes assigned copies only. Separate identical printings stay separate IDs.
  const backup = createBinderBackupV2({ snapshot: source, completeness: 'complete-owner', scope: 'collection', collectionId: source.collections[0].id })
  const destination = '00880000-0000-4000-8000-000000000011'
  current.collections.push({ ...current.collections[0], id: destination })
  current.binders.push({ ...structuredClone(current.binders[0]), collectionId: destination, slots: [] })
  let n = 0
  return { text: JSON.stringify(backup), current, completeness: 'complete-owner' as const, mode: 'arrangement' as const,
    operationId: 'synthetic-import-arrangement', newId: () => `synthetic/import-${n++}`, resolveCatalog: (id: string) => ({ kind: 'card' as const, id, pokemonIds: [1, 2] }),
    savedEntryRemaining: 5000, destinationCollectionId: destination, decisions: backup.items.map(i => ({ sourceItemId: i.id, kind: 'add-copy' as const })) }
}
