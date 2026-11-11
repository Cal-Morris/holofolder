import { nativeCreationSchema } from '@/lib/developer-api/storage';
import { z } from 'zod';
import { CARD_LANGUAGES, CARD_FINISHES, SLOT_STATUSES } from '@/lib/domain/cards';
import type { DeveloperOperation } from './operations';
const id = z.string().min(1).max(200);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pokemon'), pokemonId: revision.min(1) }).strict(),
  z
    .object({
      kind: z.literal('card'),
      cardId: id,
      language: z.enum(CARD_LANGUAGES).optional(),
      finish: z.enum(CARD_FINISHES).optional(),
    })
    .strict(),
]);
const grading = z
  .object({
    provider: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('known'), id: z.enum(['psa', 'ace', 'cgc', 'beckett']) }).strict(),
      z.object({ kind: z.literal('custom'), name: z.string() }).strict(),
    ]),
    grade: z.string().nullable(),
    scale: z.string().nullable(),
    designation: z.string().nullable(),
    holder: z.string().nullable(),
    subgrades: z.array(z.object({ name: z.string(), grade: z.string() }).strict()),
    labelVariant: z.string().nullable(),
  })
  .strict()
  .nullable();
const placement = z.object({ inventoryItemId: id, collectionId: id, slotId: id, version: revision }).strict();
export const developerItemSchema = z
  .object({
    id,
    version: revision,
    identity,
    grading,
    acquiredAt: z.string().nullable(),
    placement: placement.nullable(),
  })
  .strict();
export const developerCollectionSchema = z
  .object({
    presetManifest: nativeCreationSchema.shape.manifest.nullable(),
    id,
    name: z.string(),
    kind: z.enum(['binder', 'slab', 'custom']),
    defaultPresentation: z.enum(['binder', 'slabs', 'list']),
    version: revision,
    layoutRevision: revision,
    isDefault: z.boolean().nullable(),
    sortOrder: revision.nullable(),
    updatedAt: z.string().nullable(),
    location: z.string().nullable().optional(),
    slotCount: revision,
    grid: z
      .object({ rows: revision.min(1), cols: revision.min(1) })
      .strict()
      .nullable(),
  })
  .strict();
// Wants expose current intent and identity, not arbitrary image URLs or member IDs.
const want = z
  .object({
    card_id: id,
    card_name: z.string(),
    added_at: z.string(),
    card_language: z.enum(CARD_LANGUAGES).optional(),
    card_finish: z.enum(CARD_FINISHES).optional(),
    card_set: z.string().optional(),
    rarity: z.string().optional(),
    local_id: z.string().optional(),
    illustrator: z.string().optional(),
    set_total: revision.optional(),
  })
  .strict();
export const developerSlotSchema = z
  .object({
    id,
    collectionId: id,
    position: revision,
    version: revision,
    collectionVersion: revision,
    layoutRevision: revision,
    inventoryItemId: id.nullable(),
    itemVersion: revision.nullable(),
    placementVersion: revision.nullable(),
    target: identity.nullable(),
    status: z.enum(SLOT_STATUSES).nullable(),
    wantedCards: z.array(want),
  })
  .strict();
const envelope = {
  projection: z.literal('developer-native-v1'),
  completeSnapshot: z.literal(false),
  inventoryRevision: revision,
  readRevision: z.string().regex(/^[a-f0-9]{64}$/),
};
const page = (data: z.ZodType) =>
  z.object({ ...envelope, data: z.array(data), total: revision, nextCursor: z.string().nullable() }).strict();
const detail = (data: z.ZodType) => z.object({ ...envelope, data }).strict();
const paging = { limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(1024).optional() };
const filter = { collectionId: z.uuid().optional(), cardId: id.optional() };
export const NATIVE_READ_OPERATIONS: readonly DeveloperOperation[] = [
  {
    name: 'list_inventory_items',
    method: 'GET',
    path: '/inventory/items',
    description:
      'List physical copies with stable IDs, identity, recorded grade and placement. Certificates, private label assets and immutable source evidence are omitted. Pages are scope/filter/revision-bound and never complete snapshots or queue ACKs.',
    schema: z.object({ ...paging, ...filter, assignment: z.enum(['assigned', 'unassigned']).optional() }).strict(),
    responseSchema: page(developerItemSchema),
    permissions: ['collection:read', 'binders:read'],
    write: false,
    idempotent: true,
  },
  {
    name: 'get_inventory_item',
    method: 'GET',
    path: '/inventory/items/{id}',
    description:
      'Read one physical copy with its current item and placement revisions, using the same redacted private developer projection.',
    schema: z.object({ id }).strict(),
    responseSchema: detail(developerItemSchema),
    permissions: ['collection:read', 'binders:read'],
    write: false,
    idempotent: true,
  },
  {
    name: 'list_storage_collections',
    method: 'GET',
    path: '/storage/collections',
    description:
      'Page current native storage metadata, the copied initial presetManifest including optional setScope historical evidence, private location, counts and independent collection/layout revisions. Mixed legacy owners fail closed. Copied preset discovery/preview uses the separate preset operations.',
    schema: z.object(paging).strict(),
    responseSchema: page(developerCollectionSchema),
    permissions: ['collection:read', 'binders:read'],
    write: false,
    idempotent: true,
  },
  {
    name: 'list_storage_slots',
    method: 'GET',
    path: '/storage/collections/{collectionId}/slots',
    description:
      'Page ordered stable slots, current targets and wanted entries with item/placement/collection/layout preconditions. Empty targets are goals, not ownership. Cursor rejects changed revisions, scope or filters.',
    schema: z
      .object({ ...paging, collectionId: z.uuid(), cardId: id.optional(), status: z.enum(SLOT_STATUSES).optional() })
      .strict(),
    responseSchema: page(developerSlotSchema),
    permissions: ['collection:read', 'binders:read'],
    write: false,
    idempotent: true,
  },
  {
    name: 'get_storage_slot',
    method: 'GET',
    path: '/storage/collections/{collectionId}/slots/{id}',
    description:
      'Read one stable slot and all current edit preconditions. Removing a slot must retain its owned copy as Unassigned. No private planning/source/certificate/assets are returned.',
    schema: z.object({ collectionId: z.uuid(), id }).strict(),
    responseSchema: detail(developerSlotSchema),
    permissions: ['collection:read', 'binders:read'],
    write: false,
    idempotent: true,
  },
];
