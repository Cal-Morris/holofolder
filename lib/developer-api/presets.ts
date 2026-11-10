import { z } from "zod"
import type { DeveloperOperation } from "./operations"
import { CARD_LANGUAGES, CARD_FINISHES } from "@/lib/domain/cards"
import { GENERATIONS } from "@/lib/pokemon-generations"

export const PRESET_PREVIEW_LIMITS = { species: 1025, printings: 100, uniquePrintings: 25, responseBytes: 1048576,
  catalogBytes: 2097152, catalogRequests: 192, timeoutMs: 5000, pageSize: 10 } as const
export const PRESET_PERMISSIONS = ["catalog:read", "binders:read"] as const
const id = z.string().min(1).max(200).refine(value => value.trim() === value)
const source = z.object({ id, version: id }).strict()
const printing = z.object({ cardId: id, language: z.enum(CARD_LANGUAGES), finish: z.enum(CARD_FINISHES).optional() }).strict()
const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pokemon"), pokemonId: z.number().int().min(1).max(1025) }).strict(),
  printing.extend({ kind: z.literal("card") }).strict(),
])
const preset = z.object({ id, version: z.literal("1"), name: id, supported: z.boolean(), scope: z.string(), limitation: z.string().nullable() }).strict()
const envelope = { projection: z.literal("copied-preset-preview-v1"), completeSnapshot: z.literal(false) }
export const presetPreviewInput = z.object({ presetId: id, version: z.literal("1"),
  speciesIds: z.array(z.number().int().min(1).max(1025)).max(PRESET_PREVIEW_LIMITS.species).optional(),
  printings: z.array(printing).max(PRESET_PREVIEW_LIMITS.printings).optional(),
}).strict()
export const presetPreviewResponse = z.object({ ...envelope, preset: source,
  manifest: z.object({ source, name: id, entries: z.array(z.object({ id, target: target.nullable() }).strict()).max(1025) }).strict(),
  scope: z.object({ kind: id, speciesIds: z.array(z.number().int()).optional(), printings: z.array(printing).optional() }).strict(),
  targetCount: z.number().int().nonnegative(), freeSlotCount: z.literal(0), ownershipCreated: z.literal(false),
  exclusions: z.array(z.string()), unknowns: z.array(z.string()),
}).strict()

export const COPIED_PRESETS: z.infer<typeof preset>[] = [
  { id: "blank", version: "1", name: "Blank", supported: true, scope: "zero stored slots", limitation: null },
  { id: "national-dex", version: "1", name: "National Dex", supported: true, scope: "bundled species, Dex order", limitation: "Species only, no form targets or printings." },
  ...GENERATIONS.filter(g => g.id > 0).map(g => ({ id: `generation-${g.id}`, version: "1" as const, name: g.region,
    supported: true, scope: "bundled generation species, Dex order", limitation: "Species only, no form targets or printings." })),
  { id: "selected-species", version: "1", name: "Selected species", supported: true, scope: "unique species in caller order", limitation: "No separate form identities; duplicate species rejected." },
  { id: "selected-printings", version: "1", name: "Selected printings", supported: true, scope: "explicit mirrored row IDs in caller order, repeats allowed",
    limitation: "At most 100 targets and 25 unique printings. Exact language required. Only verified normal, holo, reverse_holo or jumbo finish flags; omitted finish is unconstrained. No alias resolution or exhaustive search." },
  ...["set", "master-set"].map(id => ({ id, version: "1" as const, name: id === "set" ? "Set" : "Master set", supported: false,
    scope: "unsupported", limitation: "Durable set/checklist coverage scope is not persisted by creation. No complete set or variant-family claim." })),
]
const staged = "Staged, always returns 503 native_operations_staged until #379. After admission: "
export const PRESET_OPERATIONS: readonly DeveloperOperation[] = [
  { name: "list_storage_presets", method: "GET", path: "/storage/presets", permissions: PRESET_PERMISSIONS, write: false,
    admission: "staged", idempotent: true, description: staged + "Discover versioned copied target presets and explicit unsupported scopes. Metadata only, no owner planning snapshot or creation intent. Existing Premium/lifetime key or OAuth authority is required.",
    schema: z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(1024).optional() }).strict(),
    responseSchema: z.object({ ...envelope, data: z.array(preset), nextCursor: z.string().nullable(), limits: z.object(Object.fromEntries(Object.entries(PRESET_PREVIEW_LIMITS).map(([k, v]) => [k, z.literal(v)]))).strict() }).strict() },
  { name: "preview_storage_preset", method: "POST", path: "/storage/presets/preview", permissions: PRESET_PERMISSIONS, write: false,
    admission: "staged", idempotent: true, maxBytes: 65536, schema: presetPreviewInput, responseSchema: presetPreviewResponse,
    description: staged + "Preview a detached ordered copied manifest without saving, assigning ownership, creating wants or allocating operation/collection/slot IDs. Use version 1, with speciesIds only for selected-species or printings only for selected-printings. Exact catalog language and requested finish evidence must be available; incomplete/ambiguous evidence fails the whole preview. Set/master-set scopes are unsupported. Manifest entries are preset entry IDs, not slot IDs. Not complete planner or queue ACK evidence; no autosync." },
]
