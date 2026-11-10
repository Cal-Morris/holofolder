import { STORAGE_REJECTION_CODES } from '@/lib/collection/storage-command-rejection'
import { parseBackupArrangementCommand, BACKUP_IMPORT_LIMITS } from '@/lib/domain/backup-import-command'
import { z } from 'zod'
import { CARD_LANGUAGES, CARD_FINISHES } from '@/lib/domain/cards'
import { parseSlotCommand, SLOT_LIMITS } from '@/lib/domain/slot-commands'
import { parseInventoryCommand, INVENTORY_COLLECTION_DELETE_LIMITS } from '@/lib/domain/inventory-commands'
import { parseCollectionCreation, COLLECTION_CREATION_LIMITS } from '@/lib/domain/storage-creation'
import type { DeveloperOperation } from './operations'

const id = z.string().min(1).max(200).refine(v => v.trim() === v)
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const operationId = id.min(8).max(100)
const collectionId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const identity = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pokemon'), pokemonId: revision.min(1) }).strict(),
  z.object({ kind: z.literal('card'), cardId: id, language: z.enum(CARD_LANGUAGES).optional(), finish: z.enum(CARD_FINISHES).optional() }).strict(),
])
const text = z.string().min(1).max(500).refine(v => !!v.trim())
const grading = z.object({
  provider: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('known'), id: z.enum(['psa', 'ace', 'cgc', 'beckett']) }).strict(),
    z.object({ kind: z.literal('custom'), name: text }).strict(),
  ]), grade: text.nullable(), scale: text.nullable(), designation: text.nullable(),
  subgrades: z.array(z.object({ name: text, grade: text }).strict()).max(20),
  certificate: text.nullable(), holder: text.nullable(),
  label: z.object({ variant: text.nullable(), assetIds: z.array(id).max(20) }).strict(),
}).strict().nullable()
const want = z.object({ card_id: id, card_name: z.string().min(1), added_at: z.string(),
  card_language: z.enum(CARD_LANGUAGES).optional(), card_finish: z.enum(CARD_FINISHES).optional(),
  card_image: z.string().optional(), card_set: z.string().optional(), rarity: z.string().optional(),
  local_id: z.string().optional(), illustrator: z.string().optional(), set_total: revision.min(1).optional(),
  wanted_by: z.array(z.uuid()).max(2).optional(),
}).strict()
const slot = z.object({ id, version: revision, inventoryItemId: id.nullable(), itemVersion: revision.nullable(), placementVersion: revision.nullable() }).strict()
const slotRef = z.object({ collectionId, slot }).strict()
const item = z.object({ itemId: id, itemVersion: revision, placement: slotRef.nullable() }).strict()
const publicWant = want.omit({ wanted_by: true, card_image: true })
const selectedWant = z.union([z.object({ index: revision.max(99), expected: want }).strict(),
  z.object({ index: revision.max(99), expectedPublic: publicWant }).strict()]).nullable()
const gradingPatch = z.object({ provider: grading.unwrap().shape.provider.optional(), grade: text.nullable().optional(),
  scale: text.nullable().optional(), designation: text.nullable().optional(), subgrades: grading.unwrap().shape.subgrades.optional(),
  holder: text.nullable().optional(), labelVariant: text.nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0)
const collection = z.object({ collectionId, version: revision, layoutRevision: revision }).strict()
const slotCommand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), ids: z.array(id).min(1).max(256), beforeSlotId: id.nullable() }).strict(),
  z.object({ kind: z.literal('move'), slots: z.array(slot).min(1).max(256), beforeSlotId: id.nullable() }).strict(),
  z.object({ kind: z.enum(['clear', 'remove']), slots: z.array(slot).min(1).max(256) }).strict(),
  z.object({ kind: z.literal('update'), slot, target: identity.nullable().optional(), wantedCards: z.array(want).max(100).optional() }).strict(),
])
const inventoryCommand = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insertAssign'), collectionId, slotId: id, before: slot.nullable(), target: identity.nullable(),
    selection: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('existing'), inventoryItemId: id, itemVersion: revision }).strict(),
      z.object({ kind: z.literal('new'), itemId: id, identity, grading, acquiredAt: z.string().nullable() }).strict(),
    ]).nullable(),
  }).strict(),
  z.object({ kind: z.literal('add'), itemId: id, identity, grading, acquiredAt: z.string().nullable() }).strict(),
  z.object({ kind: z.literal('edit'), item, grading }).strict(),
  z.object({ kind: z.literal('patchGrading'), item, patch: gradingPatch }).strict(),
  z.object({ kind: z.enum(['removeOwned', 'unassign']), item }).strict(),
  z.object({ kind: z.literal('assign'), selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), inventoryItemId: id, itemVersion: revision }).strict(),
    z.object({ kind: z.literal('catalog'), identity, newItemId: id }).strict(),
  ]), destination: slotRef, occupied: z.enum(['cancel', 'unassign']), fulfillWant: selectedWant }).strict(),
  z.object({ kind: z.literal('move'), item, destination: slotRef, occupied: z.enum(['cancel', 'unassign', 'swap']), fulfillWant: selectedWant }).strict(),
  z.object({ kind: z.literal('removeSlots'), slots: z.array(slotRef).min(1).max(256) }).strict(),
  z.object({ kind: z.literal('deleteCollection'), collectionId, slots: z.array(slot).max(4096), replacementDefaultCollectionId: collectionId.nullable() }).strict(),
])
// Structural schemas feed discovery; canonical parsers enforce cross-field, identity and byte budgets.
function canonical(parse: (input: unknown) => unknown) {
  return (input: unknown) => { try { parse(input); return true } catch { return false } }
}
/** Assertion only: never reconstruct a ledger request from a redacted read or current server state. */
export function nativeCommandIntent(input: Record<string, unknown>) {
  const { privateFields: _privateFields, expectedOwnerUserId: _expectedOwnerUserId, ...intent } = input
  return intent
}
const privateFields = z.enum(['preserve', 'replace']).optional().describe('preserve allows public patchGrading and exact selected-want expectedPublic; rejects full grading/wants replacement and slot/collection removal. replace (also the legacy default when omitted) retains full-replacement semantics; never rebuild replacements from redacted reads.')
const expectedOwnerUserId = collectionId.optional().describe('Recipient precondition, required with privateFields=preserve. Must match the current authenticated owner scope; never selects or grants authority. Retain across retries.')
export const nativeSlotSchema = z.object({ collectionId, operationId, inventoryRevision: revision, collectionVersion: revision, privateFields, expectedOwnerUserId,
  layoutRevision: revision, commands: z.array(slotCommand).min(1).max(100),
}).strict().refine(input => canonical(parseSlotCommand)(nativeCommandIntent(input)), 'Invalid or oversized slot command.')
  .refine(input => input.privateFields !== 'preserve' || input.commands.every(command =>
    command.kind === 'create' || command.kind === 'move' || (command.kind === 'update' && !('wantedCards' in command))),
  'Private-preserving mode supports slot creation, reorder and target-only updates. Wants patches require transactional executor support.')
  .refine(input => input.privateFields !== 'preserve' || input.expectedOwnerUserId !== undefined, 'Private-preserving mode requires the original expectedOwnerUserId.')
export const nativeInventorySchema = z.object({ operationId, inventoryRevision: revision, privateFields, expectedOwnerUserId,
  collections: z.array(collection).max(32), commands: z.array(inventoryCommand).min(1).max(100),
}).strict().refine(input => canonical(parseInventoryCommand)(nativeCommandIntent(input)), 'Invalid or oversized inventory command.')
  .refine(input => input.privateFields !== 'preserve' || input.commands.every(command =>
    command.kind === 'insertAssign' || command.kind === 'add' || command.kind === 'patchGrading' || command.kind === 'unassign' || command.kind === 'removeOwned'
    || ((command.kind === 'assign' || command.kind === 'move') && (command.fulfillWant === null || 'expectedPublic' in command.fulfillWant))),
  'Private-preserving mode supports insertAssign, add, explicit removeOwned, unassign, patchGrading and placement with null or expectedPublic fulfillment. Full grading/wants replacements remain excluded.')
  .refine(input => input.privateFields !== 'preserve' || input.expectedOwnerUserId !== undefined, 'Private-preserving mode requires the original expectedOwnerUserId.')
export const nativeCreationSchema = z.object({ version: z.literal(1), operationId, inventoryRevision: revision, collectionId,
  name: z.string().min(1).max(40), kind: z.enum(['binder', 'slab', 'custom']), defaultPresentation: z.enum(['binder', 'slabs', 'list']),
  location: z.string().min(1).max(200).nullable(), grid: z.object({ rows: z.number().int().min(1).max(8), cols: z.number().int().min(1).max(8) }).strict().nullable(),
  manifest: z.object({ source: z.object({ id, version: id }).strict(), name: z.string().min(1).max(200),
    entries: z.array(z.object({ id, target: identity.nullable() }).strict()).max(4096),
  }).strict(), slotIds: z.array(id).max(4096),
}).strict().refine(canonical(parseCollectionCreation), 'Invalid or oversized copied collection creation.')
export const nativeArrangementSchema = z.object({ version: z.literal(1), operationId, inventoryRevision: revision, destinationCollectionId: collectionId,
  collections: z.array(collection).min(1).max(32), emptyDestinationSlots: z.array(slot).max(4096), manifest: nativeCreationSchema.shape.manifest.nullable(),
  slots: z.array(z.object({ id, target: identity.nullable(), status: z.enum(['collected', 'finalized', 'considering', 'wishlisted']).nullable(),
    wantedCards: z.array(want).max(100), inventoryItemId: id.nullable(), presetOrigin: z.object({ source: z.object({ id, version: id }).strict(), entryId: id }).strict().nullable(),
  }).strict()).min(1).max(4096),
  copies: z.array(z.object({ kind: z.enum(['add', 'existing']), item: z.object({ id, identity, grading, acquiredAt: z.string().nullable(), version: revision }).strict(), ref: item.nullable() }).strict()).max(5000),
}).strict().refine(canonical(parseBackupArrangementCommand), 'Invalid or unsupported atomic arrangement import.')
const eventId = z.string().regex(/^[1-9]\d{0,18}$/).refine(v => v.length < 19 || v <= '9223372036854775807')
const recovery = { eventId, restoreUnassignedItemIds: z.array(id).max(16384).refine(v => new Set(v).size === v.length) }
const apply = { operationId, planToken: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }
const replacement = { planVersion: z.literal(2), replacementDefaultCollectionId: collectionId, inventoryRevision: revision, collections: z.array(collection).length(1) }
const validReplacement = (v: { replacementDefaultCollectionId: string; collections: { collectionId: string }[]; restoreUnassignedItemIds: string[] }) =>
  v.restoreUnassignedItemIds.length === 0 && v.collections.length === 1 && v.collections[0].collectionId === v.replacementDefaultCollectionId
const previewSchema = z.object(recovery).strict()
const applySchema = z.object({ ...recovery, ...apply, planVersion: z.literal(1) }).strict()
const previewV2Schema = z.object({ ...recovery, ...replacement }).strict().refine(validReplacement)
const applyV2Schema = z.object({ ...recovery, ...replacement, ...apply }).strict().refine(validReplacement)
export const developerErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }).strict() }).strict()
export const storageRejectionSchema = z.object({ outcome: z.literal('rejected'), operationId, code: z.enum(STORAGE_REJECTION_CODES), inventoryRevision: revision }).strict()
export const storageCommandErrorSchema = z.object({ error: z.object({ code: z.literal('storage_command_rejected'),
  message: z.literal('The original storage command was rejected. Refresh current storage before explicit reconciliation.'),
  requestId: z.string(), rejection: storageRejectionSchema }).strict() }).strict()
const commandErrors = { 409: z.union([developerErrorSchema, storageCommandErrorSchema]) }
const terminalDescription = 'After future admission, a committed terminal ledger rejection returns REST 409 storage_command_rejected or MCP isError with the same error.rejection: outcome, original operationId, known code and inventoryRevision. Other conflicts/timeouts are not rejection proof. MCP outputSchema describes accepted receipts only; holofolder.com/errorSchemas metadata declares errors.'
const receipt = { inventoryRevision: revision }
const changed = { ...receipt, changed: z.boolean() }
const recoveryReceipt = z.object({ ...receipt, eventId, recoveredEventId: eventId, collections: z.array(collection).max(4096) }).strict()
const recoveryPreview = z.object({ planVersion: z.union([z.literal(1), z.literal(2)]), eventId, supported: z.boolean(), unsupported: z.array(z.string()).max(16384),
  conflicts: z.array(z.unknown()).max(16384), changes: z.array(z.unknown()).max(16384), planToken: z.string().regex(/^[a-f0-9]{64}$/).nullable(), restoreUnassignedItemIds: z.array(id), rootRevisionsAdvance: z.literal(true),
}).strict()
const staged = 'STAGED, not admitted: valid authorized requests return 503 native_operations_staged until #379. '
const permissions = ['collection:write', 'binders:write'] as const
const recoveryPermissions = ['collection:read', ...permissions] as const
const operations: readonly DeveloperOperation[] = [
  { name: 'import_storage_arrangement', method: 'POST', path: '/storage/imports/arrangement', description: staged + 'Atomic JSON v2 arrangement into an empty or target-only native collection with an already identical copied manifest. Every copy needs an explicit add or versioned existing-copy move. Retain the immutable request after unknown outcome. Does not replace collections/configuration, import assets, restore changed same-owner snapshots or authorize backup IDs.', permissions, write: true, schema: nativeArrangementSchema, maxBytes: BACKUP_IMPORT_LIMITS.bytes,
    responseSchema: z.object({ ...receipt, changed: z.literal(true), collectionId, collectionVersion: revision, layoutRevision: revision, slotIds: z.array(id).max(4096), addedItemIds: z.array(id).max(5000), removedEmptySlotIds: z.array(id).max(4096) }).strict() },
  { name: 'execute_slot_commands', method: 'POST', path: '/storage/slots/commands', description: staged + terminalDescription + ' Atomic stable-ID slot insert/update/clear/remove/reorder. Requires exact inventory, collection, layout, slot/item/placement revisions and retry-stable operationId. Clear/remove release copies to Unassigned; neither deletes ownership. Set privateFields=preserve for create/reorder/target-only updates without replacing hidden wants; omitted or replace retains legacy full-replacement semantics.', permissions, write: true, schema: nativeSlotSchema, maxBytes: SLOT_LIMITS.bytes, errorSchemas: commandErrors,
    responseSchema: z.object({ ...changed, collectionVersion: revision, layoutRevision: revision, removedSlotIds: z.array(id) }).strict() },
  { name: 'execute_inventory_commands', method: 'POST', path: '/storage/inventory/commands', description: staged + terminalDescription + ' Atomic insertAssign, owned-copy add/edit/remove/unassign/assign/move or collection deletion through the trusted executor. insertAssign creates one stable slot before an exact existing slot reference or appends with before:null, retaining explicit target:null/free or target intent. selection:null creates no ownership; existing requires an exact Unassigned item/version, new explicitly creates that stable item. It never auto-selects a grade or moves an assigned copy. Maximum 4096 slots and 8192 insertion work rows per request, 100 commands, 256 affected selected entities, 256 KiB ordinary request, 1 MiB ordinary receipt and unchanged 16 MiB/16384 audit bounds and 10s deadline; oversized evidence rejects atomically. Full selected-copy/destination and revision preconditions are mandatory. Only explicit removeOwned deletes ownership; idempotent receipts require a fresh complete read before reconciliation. Set privateFields=preserve for add, explicit removeOwned, unassign or placement with fulfillWant:null; patchGrading updates only declared public fields on existing grading; selected-want expectedPublic compares the exact locked slot/index public projection. Hidden certificates/assets/provenance and unrelated wants are retained by migration 090 after original-intent replay lookup. Omitted or replace retains full-replacement semantics.', permissions, write: true, schema: nativeInventorySchema, maxBytes: INVENTORY_COLLECTION_DELETE_LIMITS.bytes, errorSchemas: commandErrors,
    responseSchema: z.object({ ...changed, selectedItemIds: z.array(id), acquiredItemIds: z.array(id) }).strict() },
  { name: 'create_storage_collection', method: 'POST', path: '/storage/collections', description: staged + 'Atomically create native storage from an ordered copied manifest, never a legacy create-then-edit. Preserve collection/slot/operation IDs across retries. Empty goals and spacers create no ownership or wants; recoverySupported remains conservative false.', permissions, write: true, schema: nativeCreationSchema, maxBytes: COLLECTION_CREATION_LIMITS.bytes,
    responseSchema: z.object({ ...receipt, changed: z.literal(true), collectionId, collectionVersion: revision, layoutRevision: revision, slotIds: z.array(id).max(4096), recoverySupported: z.literal(false) }).strict() },
  { name: 'preview_storage_recovery', method: 'POST', path: '/storage/recovery/preview', description: staged + 'Preview supported native audit evidence using the private native backend, never the legacy Activity facade. Unsupported events return conflicts/unsupported with no usable plan. Default-creation recovery needs explicit v2 replacement.', permissions: recoveryPermissions, write: false, schema: previewSchema, responseSchema: recoveryPreview, maxBytes: 1048576 },
  { name: 'apply_storage_recovery', method: 'POST', path: '/storage/recovery/apply', description: staged + 'Apply exactly reviewed native version-1 recovery with confirmation, planToken and retry-stable operationId. Current authority and newer/ABA changes remain enforced. No fallback to legacy recovery.', permissions: recoveryPermissions, write: true, schema: applySchema, responseSchema: recoveryReceipt, maxBytes: 1048576 },
  { name: 'preview_storage_recovery_v2', method: 'POST', path: '/storage/recovery/v2/preview', description: staged + 'Preview default-creation recovery with one explicit same-owner replacement and its current inventory/content/layout revisions. Does not select a replacement or restore authority implicitly.', permissions: recoveryPermissions, write: false, schema: previewV2Schema, responseSchema: recoveryPreview, maxBytes: 1048576 },
  { name: 'apply_storage_recovery_v2', method: 'POST', path: '/storage/recovery/v2/apply', description: staged + 'Apply the exact confirmed version-2 default-creation plan with explicit replacement and stable operationId. Unsupported dependencies and conflicts reject atomically; no legacy fallback.', permissions: recoveryPermissions, write: true, schema: applyV2Schema, responseSchema: recoveryReceipt, maxBytes: 1048576 },
]
export const NATIVE_DEVELOPER_OPERATIONS: readonly DeveloperOperation[] = operations.map(operation => ({ ...operation, admission: 'staged' as const, idempotent: true,
  destructive: operation.write && operation.name !== 'create_storage_collection',
}))
