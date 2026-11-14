import { z } from 'zod';
import type { DeveloperOperation } from './operations';
import { CARD_LANGUAGES, CARD_FINISHES } from '@/lib/domain/cards';
import { GENERATIONS } from '@/lib/pokemon-generations';

export const PRESET_PREVIEW_LIMITS = {
  species: 1025,
  printings: 100,
  uniquePrintings: 25,
  responseBytes: 1048576,
  catalogBytes: 2097152,
  catalogRequests: 192,
  timeoutMs: 5000,
  pageSize: 10,
} as const;
export const PRESET_PERMISSIONS = ['catalog:read', 'binders:read'] as const;
const id = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value);
const source = z.strictObject({ id, version: id });
const printing = z.strictObject({
  cardId: id,
  language: z.enum(CARD_LANGUAGES),
  finish: z.enum(CARD_FINISHES).optional(),
});
const target = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pokemon'), pokemonId: z.number().int().min(1).max(1025) }),
  printing.extend({ kind: z.literal('card') }).strict(),
]);
const preset = z.strictObject({
  id,
  version: z.literal('1'),
  name: id,
  supported: z.boolean(),
  scope: z.string(),
  limitation: z.string().nullable(),
});
const envelope = { projection: z.literal('copied-preset-preview-v1'), completeSnapshot: z.literal(false) };
export const presetPreviewInput = z.strictObject({
  presetId: id,
  version: z.literal('1'),
  speciesIds: z.array(z.number().int().min(1).max(1025)).max(PRESET_PREVIEW_LIMITS.species).optional(),
  printings: z.array(printing).max(PRESET_PREVIEW_LIMITS.printings).optional(),
});
export const presetPreviewResponse = z.strictObject({
  ...envelope,
  preset: source,
  manifest: z.strictObject({
    source,
    name: id,
    entries: z.array(z.strictObject({ id, target: target.nullable() })).max(1025),
  }),
  scope: z.strictObject({
    kind: id,
    speciesIds: z.array(z.number().int()).optional(),
    printings: z.array(printing).optional(),
  }),
  targetCount: z.number().int().nonnegative(),
  freeSlotCount: z.literal(0),
  ownershipCreated: z.literal(false),
  exclusions: z.array(z.string()),
  unknowns: z.array(z.string()),
});

export const COPIED_PRESETS: z.infer<typeof preset>[] = [
  { id: 'blank', version: '1', name: 'Blank', supported: true, scope: 'zero stored slots', limitation: null },
  {
    id: 'national-dex',
    version: '1',
    name: 'National Dex',
    supported: true,
    scope: 'bundled species, Dex order',
    limitation: 'Species only, no form targets or printings.',
  },
  ...GENERATIONS.flatMap((g) =>
    g.id > 0
      ? [
          {
            id: `generation-${g.id}`,
            version: '1' as const,
            name: g.region,
            supported: true,
            scope: 'bundled generation species, Dex order',
            limitation: 'Species only, no form targets or printings.',
          },
        ]
      : [],
  ),
  {
    id: 'selected-species',
    version: '1',
    name: 'Selected species',
    supported: true,
    scope: 'unique species in caller order',
    limitation: 'No separate form identities; duplicate species rejected.',
  },
  {
    id: 'selected-printings',
    version: '1',
    name: 'Selected printings',
    supported: true,
    scope: 'explicit mirrored row IDs in caller order, repeats allowed',
    limitation:
      'At most 100 targets and 25 unique printings. Exact language required. Only verified normal, holo, reverse_holo or jumbo finish flags; omitted finish is unconstrained. No alias resolution or exhaustive search.',
  },
  ...['set', 'master-set'].map((id) => ({
    id,
    version: '1' as const,
    name: id === 'set' ? 'Set' : 'Master set',
    supported: false,
    scope: 'unsupported',
    limitation:
      'Server-side set preview generation is unsupported here. Creation accepts a reviewed manifest.setScope with migration 101; no complete set or variant-family claim.',
  })),
];
export const PRESET_OPERATIONS: readonly DeveloperOperation[] = [
  {
    name: 'list_storage_presets',
    method: 'GET',
    path: '/storage/presets',
    permissions: PRESET_PERMISSIONS,
    write: false,
    idempotent: true,
    description:
      'List the versioned presets a collection can be created from, and the scopes that are not supported. Metadata only. Needs Premium or lifetime API access.',
    schema: z.strictObject({
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).max(1024).optional(),
    }),
    responseSchema: z.strictObject({
      ...envelope,
      data: z.array(preset),
      nextCursor: z.string().nullable(),
      limits: z.strictObject(
        Object.fromEntries(Object.entries(PRESET_PREVIEW_LIMITS).map(([k, v]) => [k, z.literal(v)])),
      ),
    }),
  },
  {
    name: 'preview_storage_preset',
    method: 'POST',
    path: '/storage/presets/preview',
    permissions: PRESET_PERMISSIONS,
    write: false,
    idempotent: true,
    maxBytes: 65536,
    schema: presetPreviewInput,
    responseSchema: presetPreviewResponse,
    description:
      'Preview the ordered manifest a preset would create, without saving anything. Use version 1, with speciesIds only for selected-species or printings only for selected-printings. Missing or ambiguous catalog language or finish evidence fails the whole preview. Set and master-set scopes are unsupported. Manifest entries are preset entry IDs, not slot IDs.',
  },
];
