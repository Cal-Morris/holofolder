import assert from 'node:assert/strict'
import { DEVELOPER_OPERATIONS, type DeveloperOperation } from '../lib/developer-api/operations'
import type { BackupArrangementCommand } from '../lib/domain/backup-import-command'
import type { InventoryCommandRequest } from '../lib/domain/inventory-commands'
import type { SlotCommandRequest } from '../lib/domain/slot-commands'
import type { CollectionCreationCommand } from '../lib/domain/storage-creation'

/** Denial inputs only. No current storage, private planning evidence or reviewed recovery plan. */
export function stagedSmokeInputs(collectionId: string, runId: string): Record<string, Record<string, unknown>> {
 const collections = [{ collectionId, version: 0, layoutRevision: 0 }]
 const inventory = { operationId: 'synthetic-denial-inventory-' + runId, inventoryRevision: 0, collections,
  commands: [{ kind: 'insertAssign', collectionId, slotId: 'synthetic-denial-insert-slot', before: null, target: null, selection: null }],
 } satisfies InventoryCommandRequest
 const slots = { operationId: 'synthetic-denial-slots-' + runId, inventoryRevision: 0, collectionId, collectionVersion: 0, layoutRevision: 0,
  commands: [{ kind: 'create', ids: ['synthetic-denial-slot'], beforeSlotId: null }],
 } satisfies SlotCommandRequest
 const creation = { version: 1, operationId: 'synthetic-denial-create-' + runId, inventoryRevision: 0, collectionId,
  name: 'Synthetic denial fixture', kind: 'binder', defaultPresentation: 'binder', location: null, grid: null,
  manifest: { source: { id: 'synthetic-denial', version: '1' }, name: 'Synthetic denial targets', entries: [] }, slotIds: [],
 } satisfies CollectionCreationCommand
 const arrangement = { version: 1, operationId: 'synthetic-denial-import-' + runId, inventoryRevision: 0, destinationCollectionId: collectionId,
  collections, emptyDestinationSlots: [], manifest: null, copies: [],
  slots: [{ id: 'synthetic-denial-import-slot', target: null, status: null, wantedCards: [], inventoryItemId: null, presetOrigin: null }],
 } satisfies BackupArrangementCommand
 // Deliberate schema sentinels, never derived from an audit event or accepted as executable plans.
 const preview = { eventId: '9223372036854775807', restoreUnassignedItemIds: [] }
 const apply = { operationId: 'synthetic-denial-recovery-' + runId, planToken: '0'.repeat(64), confirmed: true }
 const replacement = { ...preview, planVersion: 2, replacementDefaultCollectionId: collectionId, inventoryRevision: 0, collections }
 return {
  import_storage_arrangement: arrangement, execute_slot_commands: slots, execute_inventory_commands: inventory, create_storage_collection: creation,
  preview_storage_recovery: preview, apply_storage_recovery: { ...preview, ...apply, planVersion: 1 },
  preview_storage_recovery_v2: replacement, apply_storage_recovery_v2: { ...replacement, ...apply },
  list_inventory_items: {}, get_inventory_item: { id: 'synthetic-denial-item' }, list_storage_collections: {},
  list_storage_slots: { collectionId }, get_storage_slot: { collectionId, id: 'synthetic-denial-slot' },
  list_storage_presets: {}, preview_storage_preset: { presetId: 'blank', version: '1' },
 }
}

/** Fail before creating accounts if a registry/schema change leaves the denial suite stale. */
export function validateStagedSmokeInputs(inputs: Record<string, Record<string, unknown>>, operations: readonly DeveloperOperation[] = DEVELOPER_OPERATIONS) {
 const staged = operations.filter(op => op.admission === 'staged')
 assert.deepEqual(Object.keys(inputs).sort(), staged.map(op => op.name).sort(), 'Staged smoke fixtures must exactly cover the current registry')
 for (const op of staged) op.schema.parse(inputs[op.name])
 return staged
}
