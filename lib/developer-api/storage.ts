import { setChecklistScopeSchema } from '@/lib/developer-api/set-checklist';
import { parseRawRestoreCommand, RAW_RESTORE_V2_LIMITS, RAW_RESTORE_REJECTION_CODES } from '@/lib/domain/raw-restore';
import { CREATION_REJECTION_CODES, IMPORT_REJECTION_CODES } from '@/lib/collection/creation-import-rejection';
import { RECOVERY_REJECTION_CODES } from '@/lib/collection/recovery-rejection';
import { STORAGE_REJECTION_CODES } from '@/lib/collection/storage-command-rejection';
import { parseBackupArrangementCommand, BACKUP_IMPORT_LIMITS } from '@/lib/domain/backup-import-command';
import { z } from 'zod';
import { CARD_LANGUAGES, CARD_FINISHES } from '@/lib/domain/cards';
import { parseSlotCommand, SLOT_LIMITS } from '@/lib/domain/slot-commands';
import { parseInventoryCommand, INVENTORY_COLLECTION_DELETE_LIMITS } from '@/lib/domain/inventory-commands';
import { parseCollectionCreation, COLLECTION_CREATION_LIMITS } from '@/lib/domain/storage-creation';
import type { DeveloperOperation } from './operations';

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v.trim() === v);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const operationId = id.min(8).max(100);
const collectionId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const identity = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pokemon'), pokemonId: revision.min(1) }),
  z.strictObject({
    kind: z.literal('card'),
    cardId: id,
    language: z.enum(CARD_LANGUAGES).optional(),
    finish: z.enum(CARD_FINISHES).optional(),
  }),
]);
const text = z
  .string()
  .min(1)
  .max(500)
  .refine((v) => !!v.trim());
const grading = z
  .strictObject({
    provider: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('known'), id: z.enum(['psa', 'ace', 'cgc', 'beckett']) }),
      z.strictObject({ kind: z.literal('custom'), name: text }),
    ]),
    grade: text.nullable(),
    scale: text.nullable(),
    designation: text.nullable(),
    subgrades: z.array(z.strictObject({ name: text, grade: text })).max(20),
    certificate: text.nullable(),
    holder: text.nullable(),
    label: z.strictObject({ variant: text.nullable(), assetIds: z.array(id).max(20) }),
  })
  .nullable();
const want = z.strictObject({
  card_id: id,
  card_name: z.string().min(1),
  added_at: z.string(),
  card_language: z.enum(CARD_LANGUAGES).optional(),
  card_finish: z.enum(CARD_FINISHES).optional(),
  card_image: z.string().optional(),
  card_set: z.string().optional(),
  rarity: z.string().optional(),
  local_id: z.string().optional(),
  illustrator: z.string().optional(),
  set_total: revision.min(1).optional(),
  wanted_by: z.array(z.uuid()).max(2).optional(),
});
const slot = z.strictObject({
  id,
  version: revision,
  inventoryItemId: id.nullable(),
  itemVersion: revision.nullable(),
  placementVersion: revision.nullable(),
});
const slotRef = z.strictObject({ collectionId, slot });
const item = z.strictObject({ itemId: id, itemVersion: revision, placement: slotRef.nullable() });
const publicWant = want.omit({ wanted_by: true, card_image: true });
const selectedWant = z
  .union([
    z.strictObject({ index: revision.max(99), expected: want }),
    z.strictObject({ index: revision.max(99), expectedPublic: publicWant }),
  ])
  .nullable();
const gradingPatch = z
  .strictObject({
    provider: grading.unwrap().shape.provider.optional(),
    grade: text.nullable().optional(),
    scale: text.nullable().optional(),
    designation: text.nullable().optional(),
    subgrades: grading.unwrap().shape.subgrades.optional(),
    holder: text.nullable().optional(),
    labelVariant: text.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
const collection = z.strictObject({ collectionId, version: revision, layoutRevision: revision });
const slotCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), ids: z.array(id).min(1).max(256), beforeSlotId: id.nullable() }),
  z.strictObject({ kind: z.literal('move'), slots: z.array(slot).min(1).max(256), beforeSlotId: id.nullable() }),
  z.strictObject({ kind: z.enum(['clear', 'remove']), slots: z.array(slot).min(1).max(256) }),
  z.strictObject({
    kind: z.literal('update'),
    slot,
    target: identity.nullable().optional(),
    wantedCards: z.array(want).max(100).optional(),
  }),
  z.strictObject({
    kind: z.literal('layout'),
    rows: z.number().int().min(1).max(8),
    cols: z.number().int().min(1).max(8),
  }),
]);
const inventoryCommand = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('insertAssign'),
    collectionId,
    slotId: id,
    before: slot.nullable(),
    target: identity.nullable(),
    selection: z
      .discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('existing'), inventoryItemId: id, itemVersion: revision }),
        z.strictObject({ kind: z.literal('new'), itemId: id, identity, grading, acquiredAt: z.string().nullable() }),
      ])
      .nullable(),
  }),
  z.strictObject({ kind: z.literal('add'), itemId: id, identity, grading, acquiredAt: z.string().nullable() }),
  z.strictObject({ kind: z.literal('edit'), item, grading }),
  z.strictObject({ kind: z.literal('setFinish'), item, finish: z.enum(CARD_FINISHES) }),
  z.strictObject({ kind: z.literal('patchGrading'), item, patch: gradingPatch }),
  z.strictObject({ kind: z.enum(['removeOwned', 'unassign']), item }),
  z.strictObject({
    kind: z.literal('assign'),
    selection: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('existing'), inventoryItemId: id, itemVersion: revision }),
      z.strictObject({ kind: z.literal('catalog'), identity, newItemId: id }),
    ]),
    destination: slotRef,
    occupied: z.enum(['cancel', 'unassign']),
    fulfillWant: selectedWant,
  }),
  z.strictObject({
    kind: z.literal('move'),
    item,
    destination: slotRef,
    occupied: z.enum(['cancel', 'unassign', 'swap']),
    fulfillWant: selectedWant,
  }),
  z.strictObject({ kind: z.literal('removeSlots'), slots: z.array(slotRef).min(1).max(256) }),
  z.strictObject({
    kind: z.literal('deleteCollection'),
    collectionId,
    slots: z.array(slot).max(4096),
    replacementDefaultCollectionId: collectionId.nullable(),
    removeOwned: z.literal(true).optional(),
  }),
]);
// Structural schemas feed discovery; canonical parsers enforce cross-field, identity and byte budgets.
function canonical(parse: (input: unknown) => unknown) {
  return (input: unknown) => {
    try {
      parse(input);
      return true;
    } catch {
      return false;
    }
  };
}
/** Assertion only: never reconstruct a ledger request from a redacted read or current server state. */
export function nativeCommandIntent(input: Record<string, unknown>) {
  const { privateFields: _privateFields, expectedOwnerUserId: _expectedOwnerUserId, ...intent } = input;
  return intent;
}
const privateFields = z
  .enum(['preserve', 'replace'])
  .optional()
  .describe(
    'preserve allows public patchGrading and exact selected-want expectedPublic; rejects full grading/wants replacement and slot/collection removal. replace (also the legacy default when omitted) retains full-replacement semantics; never rebuild replacements from redacted reads.',
  );
const expectedOwnerUserId = collectionId
  .optional()
  .describe(
    'Recipient precondition, required with privateFields=preserve. Must match the current authenticated owner scope; never selects or grants authority. Retain across retries.',
  );
export const nativeSlotSchema = z
  .strictObject({
    collectionId,
    operationId,
    inventoryRevision: revision,
    collectionVersion: revision,
    privateFields,
    expectedOwnerUserId,
    layoutRevision: revision,
    commands: z.array(slotCommand).min(1).max(100),
  })
  .refine((input) => canonical(parseSlotCommand)(nativeCommandIntent(input)), 'Invalid or oversized slot command.')
  .refine(
    (input) =>
      input.privateFields !== 'preserve' ||
      input.commands.every(
        (command) =>
          command.kind === 'create' ||
          command.kind === 'move' ||
          command.kind === 'layout' ||
          (command.kind === 'update' && !('wantedCards' in command)),
      ),
    'Private-preserving mode supports slot creation, reorder, layout and target-only updates. Wants patches require transactional executor support.',
  )
  .refine(
    (input) => input.privateFields !== 'preserve' || input.expectedOwnerUserId !== undefined,
    'Private-preserving mode requires the original expectedOwnerUserId.',
  );
export const nativeInventorySchema = z
  .strictObject({
    operationId,
    inventoryRevision: revision,
    privateFields,
    expectedOwnerUserId,
    collections: z.array(collection).max(32),
    commands: z.array(inventoryCommand).min(1).max(100),
  })
  .refine(
    (input) => canonical(parseInventoryCommand)(nativeCommandIntent(input)),
    'Invalid or oversized inventory command.',
  )
  .refine(
    (input) =>
      input.privateFields !== 'preserve' ||
      input.commands.every(
        (command) =>
          command.kind === 'insertAssign' ||
          command.kind === 'add' ||
          command.kind === 'patchGrading' ||
          command.kind === 'setFinish' ||
          command.kind === 'unassign' ||
          command.kind === 'removeOwned' ||
          ((command.kind === 'assign' || command.kind === 'move') &&
            (command.fulfillWant === null || 'expectedPublic' in command.fulfillWant)),
      ),
    'Private-preserving mode supports insertAssign, add, explicit removeOwned, unassign, patchGrading, setFinish and placement with null or expectedPublic fulfillment. Full grading/wants replacements remain excluded.',
  )
  .refine(
    (input) => input.privateFields !== 'preserve' || input.expectedOwnerUserId !== undefined,
    'Private-preserving mode requires the original expectedOwnerUserId.',
  );
const initialManifestSchema = z.strictObject({
  source: z.strictObject({ id, version: id }),
  name: z.string().min(1).max(200),
  entries: z.array(z.strictObject({ id, target: identity.nullable() })).max(4096),
});
export const nativeCreationSchema = z
  .strictObject({
    version: z.literal(1),
    operationId,
    inventoryRevision: revision,
    collectionId,
    name: z.string().min(1).max(40),
    kind: z.enum(['binder', 'slab', 'custom']),
    defaultPresentation: z.enum(['binder', 'slabs', 'list']),
    location: z.string().min(1).max(200).nullable(),
    grid: z.strictObject({ rows: z.number().int().min(1).max(8), cols: z.number().int().min(1).max(8) }).nullable(),
    manifest: initialManifestSchema.extend({ setScope: setChecklistScopeSchema.optional() }).strict(),
    slotIds: z.array(id).max(4096),
  })
  .refine(canonical(parseCollectionCreation), 'Invalid or oversized copied collection creation.');
export const nativeArrangementSchema = z
  .strictObject({
    version: z.literal(1),
    operationId,
    inventoryRevision: revision,
    destinationCollectionId: collectionId,
    collections: z.array(collection).min(1).max(32),
    emptyDestinationSlots: z.array(slot).max(4096),
    manifest: initialManifestSchema.nullable(),
    slots: z
      .array(
        z.strictObject({
          id,
          target: identity.nullable(),
          status: z.enum(['collected', 'finalized', 'considering', 'wishlisted']).nullable(),
          wantedCards: z.array(want).max(100),
          inventoryItemId: id.nullable(),
          presetOrigin: z.strictObject({ source: z.strictObject({ id, version: id }), entryId: id }).nullable(),
        }),
      )
      .min(1)
      .max(4096),
    copies: z
      .array(
        z.strictObject({
          kind: z.enum(['add', 'existing']),
          item: z.strictObject({ id, identity, grading, acquiredAt: z.string().nullable(), version: revision }),
          ref: item.nullable(),
        }),
      )
      .max(5000),
  })
  .refine(canonical(parseBackupArrangementCommand), 'Invalid or unsupported atomic arrangement import.');
export const rawRestoreSchema = z
  .strictObject({
    version: z.literal(4),
    operationId,
    inventoryRevision: revision,
    slotOrder: z.strictObject({
      before: z.array(id).min(1).max(RAW_RESTORE_V2_LIMITS.slots),
      after: z.array(id).min(1).max(RAW_RESTORE_V2_LIMITS.slots),
    }),
    manifest: nativeCreationSchema.shape.manifest.nullable(),
    planning: z.strictObject({
      actorUserId: collectionId,
      ownerUserId: collectionId,
      source: z.enum(['app', 'rest', 'mcp']),
      credentialId: id.nullable(),
      authSessionId: id.nullable(),
      partnershipId: collectionId.nullable(),
      partnerUserId: collectionId.nullable(),
    }),
    collection,
    configuration: z.strictObject({
      name: z.string().min(1).max(40),
      kind: z.enum(['binder', 'slab', 'custom']),
      defaultPresentation: z.enum(['binder', 'slabs', 'list']),
      location: z.string().max(200).nullable(),
      rows: revision.min(1).max(8),
      cols: revision.min(1).max(8),
    }),
    slots: z
      .array(
        z.strictObject({
          before: slot,
          after: z.strictObject({
            id,
            target: identity.nullable(),
            status: z.enum(['collected', 'finalized', 'considering', 'wishlisted']).nullable(),
            wantedCards: z.array(want).max(100),
            inventoryItemId: id.nullable(),
            presetOrigin: nativeArrangementSchema.shape.slots.element.shape.presetOrigin,
          }),
        }),
      )
      .min(1)
      .max(RAW_RESTORE_V2_LIMITS.slots),
    items: z.array(item).max(RAW_RESTORE_V2_LIMITS.items),
    releaseItemIds: z.array(id).max(RAW_RESTORE_V2_LIMITS.items),
  })
  .refine(canonical(parseRawRestoreCommand), 'Invalid or unsupported raw content restore.');
const eventId = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => v.length < 19 || v <= '9223372036854775807');
const recovery = {
  eventId,
  restoreUnassignedItemIds: z
    .array(id)
    .max(16384)
    .refine((v) => new Set(v).size === v.length),
};
const apply = { operationId, planToken: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) };
const replacement = {
  planVersion: z.literal(2),
  replacementDefaultCollectionId: collectionId,
  inventoryRevision: revision,
  collections: z.array(collection).length(1),
};
const validReplacement = (v: {
  replacementDefaultCollectionId: string;
  collections: { collectionId: string }[];
  restoreUnassignedItemIds: string[];
}) =>
  v.restoreUnassignedItemIds.length === 0 &&
  v.collections.length === 1 &&
  v.collections[0].collectionId === v.replacementDefaultCollectionId;
const previewSchema = z.strictObject(recovery);
const applySchema = z.strictObject({ ...recovery, ...apply, planVersion: z.literal(1) });
const previewV2Schema = z.strictObject({ ...recovery, ...replacement }).refine(validReplacement);
const applyV2Schema = z.strictObject({ ...recovery, ...replacement, ...apply }).refine(validReplacement);
export const developerErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string(), requestId: z.string() }),
});
export const storageRejectionSchema = z.strictObject({
  outcome: z.literal('rejected'),
  operationId,
  code: z.enum(STORAGE_REJECTION_CODES),
  inventoryRevision: revision,
});
export const storageCommandErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal('storage_command_rejected'),
    message: z.literal(
      'The original storage command was rejected. Refresh current storage before explicit reconciliation.',
    ),
    requestId: z.string(),
    rejection: storageRejectionSchema,
  }),
});
export const recoveryRejectionSchema = z.strictObject({
  outcome: z.literal('rejected'),
  operationId,
  code: z.enum(RECOVERY_REJECTION_CODES),
  inventoryRevision: revision,
});
export const recoveryErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal('storage_recovery_rejected'),
    message: z.literal(
      'The original recovery did not commit. Read current storage before explicitly discarding or reviewing a new recovery.',
    ),
    requestId: z.string(),
    rejection: recoveryRejectionSchema,
  }),
});
export const creationRejectionSchema = z.strictObject({
  outcome: z.literal('rejected'),
  operationId,
  code: z.enum(CREATION_REJECTION_CODES),
  inventoryRevision: revision,
});
export const importRejectionSchema = z.strictObject({
  outcome: z.literal('rejected'),
  operationId,
  code: z.enum(IMPORT_REJECTION_CODES),
  inventoryRevision: revision,
});
export const creationErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal('storage_creation_rejected'),
    message: z.literal('The original creation did not commit. Read current storage before explicit reconciliation.'),
    requestId: z.string(),
    rejection: creationRejectionSchema,
  }),
});
export const importErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal('storage_import_rejected'),
    message: z.literal('The original import did not commit. Read current storage before explicit reconciliation.'),
    requestId: z.string(),
    rejection: importRejectionSchema,
  }),
});
export const rawRestoreErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal('storage_restore_rejected'),
    message: z.literal('The original restore did not commit. Read current storage before explicit reconciliation.'),
    requestId: z.string(),
    rejection: z.strictObject({
      version: z.literal(4),
      outcome: z.literal('rejected'),
      operationId,
      code: z.enum(RAW_RESTORE_REJECTION_CODES),
      inventoryRevision: revision,
    }),
  }),
});
const creationImportTerminalDescription =
  'A committed rejection returns REST 409 storage_creation_rejected or storage_import_rejected (MCP: isError) with error.rejection {outcome, operationId, code, inventoryRevision}; retrying the same request replays the stored outcome. Other errors (conflicts, billing, cancellation, network) leave the outcome unknown: keep the original request and do a fresh full read before reconciling. outputSchema covers accepted receipts; errors are in _meta holofolder.com/errorSchemas. ';
const recoveryErrors = { 409: z.union([developerErrorSchema, recoveryErrorSchema]) };
const recoveryTerminalDescription =
  'Only recovery_plan_conflict and recovery_dependency_conflict are terminal: REST 409 storage_recovery_rejected (MCP: isError) with error.rejection {outcome, operationId, code, inventoryRevision}. Retrying the same request replays the stored outcome. Status, billing errors and cancellation prove nothing; after a rejection, re-read and preview again with a new operationId. outputSchema covers accepted receipts; errors are in _meta holofolder.com/errorSchemas. ';
const commandErrors = { 409: z.union([developerErrorSchema, storageCommandErrorSchema]) };
const terminalDescription =
  'A committed rejection returns REST 409 storage_command_rejected (MCP: isError) with error.rejection {outcome, operationId, code, inventoryRevision}; other conflicts and timeouts leave the outcome unknown, so do a fresh full read before reconciling. outputSchema covers accepted receipts; errors are in _meta holofolder.com/errorSchemas.';
const receipt = { inventoryRevision: revision };
const changed = { ...receipt, changed: z.boolean() };
const recoveryReceipt = z.strictObject({
  ...receipt,
  eventId,
  recoveredEventId: eventId,
  collections: z.array(collection).max(4096),
});
const recoveryPreview = z.strictObject({
  planVersion: z.union([z.literal(1), z.literal(2)]),
  eventId,
  supported: z.boolean(),
  unsupported: z.array(z.string()).max(16384),
  conflicts: z.array(z.unknown()).max(16384),
  changes: z.array(z.unknown()).max(16384),
  planToken: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  restoreUnassignedItemIds: z.array(id),
  rootRevisionsAdvance: z.literal(true),
});
const permissions = ['collection:write', 'binders:write'] as const;
const recoveryPermissions = ['collection:read', ...permissions] as const;
const operations: readonly DeveloperOperation[] = [
  {
    name: 'restore_raw_collection_content',
    method: 'POST',
    path: '/storage/restores/raw-content',
    description:
      'Reconcile the raw (ungraded) contents of one existing collection in place: same slot IDs, no manifest, settings or grid change. Send version 4 with the exact current copied manifest, per-slot origins and slotOrder.before/after (identical, or a permutation that also advances the layout revision), plus the exact item, slot, placement, content and layout versions you reviewed. Released copies go to Unassigned; copies placed in other collections cannot move. Does not acquire copies, replace metadata, touch graded copies or restore settings, assets or CSV. Limits: 1025 slots, 2050 raw copies, 100 wants per slot, 1.75 MiB command; oversized requests return invalid_input. A committed rejection returns REST 409 storage_restore_rejected (MCP: isError) with error.rejection; retrying the same request replays the stored outcome. Other conflicts, cancellation and failed commits leave the outcome unknown: keep the original request and do a fresh full read before reconciling. outputSchema covers accepted receipts; errors are in _meta holofolder.com/errorSchemas.',
    permissions,
    write: true,
    schema: rawRestoreSchema,
    maxBytes: RAW_RESTORE_V2_LIMITS.bytes,
    errorSchemas: { 409: z.union([developerErrorSchema, rawRestoreErrorSchema]) },
    responseSchema: z.strictObject({
      version: z.literal(4),
      ...receipt,
      changed: z.literal(true),
      collectionId,
      collectionVersion: revision,
      layoutRevision: revision,
      slotOrder: z.strictObject({
        before: z.array(id).max(RAW_RESTORE_V2_LIMITS.slots),
        after: z.array(id).max(RAW_RESTORE_V2_LIMITS.slots),
      }),
      slotIds: z.array(id).max(RAW_RESTORE_V2_LIMITS.slots),
      releasedItemIds: z.array(id).max(RAW_RESTORE_V2_LIMITS.items),
    }),
  },
  {
    name: 'import_storage_arrangement',
    method: 'POST',
    path: '/storage/imports/arrangement',
    description:
      creationImportTerminalDescription +
      'Arrange copies into an empty or target-only native collection whose copied manifest already matches (JSON v2). Every copy needs an explicit add or a versioned move of an existing copy. Does not replace collections or configuration, import assets, restore changed snapshots or reuse backup IDs.',
    permissions,
    write: true,
    schema: nativeArrangementSchema,
    maxBytes: BACKUP_IMPORT_LIMITS.bytes,
    errorSchemas: { 409: z.union([developerErrorSchema, importErrorSchema]) },
    responseSchema: z.strictObject({
      ...receipt,
      changed: z.literal(true),
      collectionId,
      collectionVersion: revision,
      layoutRevision: revision,
      slotIds: z.array(id).max(4096),
      addedItemIds: z.array(id).max(5000),
      removedEmptySlotIds: z.array(id).max(4096),
    }),
  },
  {
    name: 'execute_slot_commands',
    method: 'POST',
    path: '/storage/slots/commands',
    description:
      terminalDescription +
      ' Atomic slot commands by stable ID: create, move, clear, remove, update (target and wants) and layout (the rows × columns grid; prefer set_binder_layout, which previews it). Needs exact inventory, collection, layout and slot/item/placement revisions plus a retry-stable operationId. Clear and remove release copies to Unassigned and never delete ownership. Use privateFields=preserve for create, reorder and target-only updates to keep hidden wants; omitted or replace keeps full-replacement semantics.',
    permissions,
    write: true,
    schema: nativeSlotSchema,
    maxBytes: SLOT_LIMITS.bytes,
    errorSchemas: commandErrors,
    responseSchema: z.strictObject({
      ...changed,
      collectionVersion: revision,
      layoutRevision: revision,
      removedSlotIds: z.array(id),
    }),
  },
  {
    name: 'execute_inventory_commands',
    method: 'POST',
    path: '/storage/inventory/commands',
    description:
      terminalDescription +
      " Atomic batch of owned-copy commands: insertAssign, add, edit, setFinish, patchGrading, removeOwned, unassign, assign, move, removeSlots and deleteCollection, each with exact revision preconditions for the copies and destinations it touches, plus a retry-stable operationId. insertAssign creates one slot before an existing slot (before:null appends); selection:null creates no ownership, existing takes an exact Unassigned item version and new creates the item. Nothing auto-selects a grade or moves an assigned copy. Only removeOwned (the command, or removeOwned:true on deleteCollection, which deletes raw copies there and leaves graded ones Unassigned) deletes ownership. setFinish must still match its pocket's target; patchGrading changes only the fields it names. Use privateFields=preserve for add, removeOwned, unassign and placements with fulfillWant:null to keep hidden certificates, assets and unrelated wants; omitted or replace keeps full-replacement semantics. Limits: 100 commands, 256 selected entities, 4096 slots, 256 KiB request, 10 s.",
    permissions,
    write: true,
    schema: nativeInventorySchema,
    maxBytes: INVENTORY_COLLECTION_DELETE_LIMITS.bytes,
    errorSchemas: commandErrors,
    responseSchema: z.strictObject({ ...changed, selectedItemIds: z.array(id), acquiredItemIds: z.array(id) }),
  },
  {
    name: 'create_storage_collection',
    method: 'POST',
    path: '/storage/collections',
    description:
      creationImportTerminalDescription +
      'Atomically create a native collection from an ordered copied manifest (see preview_storage_preset), optionally with manifest.setScope: the reviewed language, verified finishes, promos, exclusions, coverage warnings and capture time. Catalog eligibility is checked only at creation; goals stay editable and free slots can be appended later. Keep the collection, slot and operation IDs across retries. Empty goals and spacers create no ownership or wants.',
    permissions,
    write: true,
    schema: nativeCreationSchema,
    maxBytes: COLLECTION_CREATION_LIMITS.bytes,
    errorSchemas: { 409: z.union([developerErrorSchema, creationErrorSchema]) },
    responseSchema: z.strictObject({
      ...receipt,
      changed: z.literal(true),
      collectionId,
      collectionVersion: revision,
      layoutRevision: revision,
      slotIds: z.array(id).max(4096),
      recoverySupported: z.literal(false),
    }),
  },
  {
    name: 'preview_storage_recovery',
    method: 'POST',
    path: '/storage/recovery/preview',
    description:
      'Preview undoing an Activity event. Unsupported events return conflicts or unsupported with no usable plan. Undoing a default collection’s creation needs preview_storage_recovery_v2 with a replacement.',
    permissions: recoveryPermissions,
    write: false,
    schema: previewSchema,
    responseSchema: recoveryPreview,
    maxBytes: 1048576,
  },
  {
    name: 'apply_storage_recovery',
    method: 'POST',
    path: '/storage/recovery/apply',
    description:
      recoveryTerminalDescription +
      'Apply a reviewed version-1 recovery from preview_storage_recovery with confirmation, its planToken and a retry-stable operationId. Changes since the preview are rejected.',
    permissions: recoveryPermissions,
    write: true,
    schema: applySchema,
    errorSchemas: recoveryErrors,
    responseSchema: recoveryReceipt,
    maxBytes: 1048576,
  },
  {
    name: 'preview_storage_recovery_v2',
    method: 'POST',
    path: '/storage/recovery/v2/preview',
    description:
      'Preview default-creation recovery with one explicit same-owner replacement and its current inventory/content/layout revisions. Does not select a replacement or restore authority implicitly.',
    permissions: recoveryPermissions,
    write: false,
    schema: previewV2Schema,
    responseSchema: recoveryPreview,
    maxBytes: 1048576,
  },
  {
    name: 'apply_storage_recovery_v2',
    method: 'POST',
    path: '/storage/recovery/v2/apply',
    description:
      recoveryTerminalDescription +
      'Apply a confirmed version-2 default-collection recovery from preview_storage_recovery_v2 with its explicit replacement and a retry-stable operationId. Unsupported dependencies and conflicts reject the whole request.',
    permissions: recoveryPermissions,
    write: true,
    schema: applyV2Schema,
    errorSchemas: recoveryErrors,
    responseSchema: recoveryReceipt,
    maxBytes: 1048576,
  },
];
export const NATIVE_DEVELOPER_OPERATIONS: readonly DeveloperOperation[] = operations.map((operation) => ({
  ...operation,
  idempotent: true,
  destructive: operation.write && operation.name !== 'create_storage_collection',
}));
