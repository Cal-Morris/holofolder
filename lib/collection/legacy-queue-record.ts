import { z } from "zod"
import type { PendingCollectionOperation, PendingCollectionOperationInput } from "@/lib/collection/offline-queue"
import { parseCollectionOrigin, sameCollectionOrigin, type CollectionOrigin } from "@/lib/collection/recipient"
import { CARD_FINISHES, CARD_LANGUAGES, SLOT_STATUSES, type CollectedPokemon } from "@/lib/domain/cards"
import { collectionFingerprint, COLLECTION_FINGERPRINT_VERSION } from "@/lib/collection/sync"
import { mergeQueuedAcquisition } from "@/lib/partner-push"

export const LEGACY_QUEUE_KEY = "legacy-collection-queue:v2"
export const LEGACY_QUEUE_SOURCE_KEY = "pokemon_collection_pending_ops_v1"
export const LEGACY_LEASE_MS = 60000
const text = z.string().min(1), revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1)
const originSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("account"), actorUserId: text, ownerUserId: text, binderId: text }),
  z.strictObject({ kind: z.literal("guest"), workspaceId: text, localBinderId: text }),
])
const printing = { card_id: z.string().optional(), card_name: z.string().optional(), card_image: z.string().optional(), card_set: z.string().optional(), card_language: z.enum(CARD_LANGUAGES).optional(), card_finish: z.enum(CARD_FINISHES).optional() }
const rowSchema = z.strictObject({ ...printing, id: text, pokemon_id: z.number().int().positive(), pokemon_name: z.string(), status: z.enum(SLOT_STATUSES), collected_at: z.string(), wanted_cards: z.array(z.strictObject({ ...printing, card_id: text, card_name: z.string(), added_at: z.string(), rarity: z.string().optional(), local_id: z.string().optional(), set_total: z.number().finite().optional(), illustrator: z.string().optional(), wanted_by: z.array(z.string()).optional() })) })
const operationCommon = {
  intentProtocol: z.literal(1).optional(), id: text, pokemonId: z.number().int().positive(), queuedAt: text,
  origin: originSchema.optional(), binderId: text.nullable().optional(), base: rowSchema.nullable().optional(),
  original: z.strictObject({ raw: z.string() }).optional(), amendments: z.array(z.string()).optional(),
  recipientPause: text.optional(), billingPause: text.optional(), deliveryUnknown: z.boolean().optional(),
  recoverySource: z.strictObject({ digest: text, ordinal: revision, reviewEpoch: text.optional() }).optional(),
  compatibilityPause: z.strictObject({ code: z.literal("binder_converted_requires_slot_commands"), rawRecord: z.string() }).optional(),
}
const operationSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...operationCommon, type: z.literal("delete") }),
  z.strictObject({ ...operationCommon, type: z.literal("upsert"), item: rowSchema, importOnly: z.literal(true).optional(), acquisition: z.strictObject({ operationId: text, actorId: text, partnershipId: text, recipientId: text, printingKey: text }).optional() }),
])
const requestSchema = z.strictObject({ method: z.enum(["POST", "PATCH", "DELETE"]), url: text, body: z.string().nullable(), headers: z.record(z.string(), z.string()) })
export type FrozenLegacyRequest = z.infer<typeof requestSchema>
const sourceSchema = z.strictObject({ sourceId: text, kind: z.enum(["local-storage", "collection-mirror"]), raw: z.string().nullable(), retainedValue: z.unknown().optional(), accepted: z.array(revision) })
export type RetainedLegacySource = z.infer<typeof sourceSchema>
const deliveryOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("acknowledged"), item: rowSchema.nullable(), activityEventId: text.optional() }),
  z.strictObject({ kind: z.literal("known-rejection"), category: z.enum(["conflict", "compatibility", "recipient", "billing", "hard"]), code: text, serverItem: rowSchema.nullable().optional() }),
  z.strictObject({ kind: z.literal("unknown"), code: text }),
])
export function validateLegacyOutcome(value: unknown) {
  if (!deliveryOutcomeSchema.safeParse(value).success) failLegacy("invalid_legacy_outcome")
}
const entrySchema = z.strictObject({
  entryId: text, sequence: revision, revision, operation: operationSchema,
  source: z.strictObject({ sourceId: text, ordinal: revision }).nullable(),
  state: z.enum(["ready", "sending", "unknown", "paused", "completed"]), reason: text.nullable(), request: requestSchema.nullable(),
  rejectedRequests: z.array(z.strictObject({ request: requestSchema, code: text })),
  lease: z.strictObject({ token: text, holder: text, until: z.number().finite(), session: text }).nullable(),
  settlement: deliveryOutcomeSchema.nullable(),
  outcome: z.enum(["acknowledged", "rejected", "superseded"]).nullable(),
})
export type DurableLegacyEntry = Omit<z.infer<typeof entrySchema>, "operation"> & { operation: PendingCollectionOperation }
const envelopeSchema = z.strictObject({ version: z.literal(2), epoch: text, revision, nextSequence: revision, migrated: z.literal(true), guestWorkspaceId: text.optional(), sources: z.array(sourceSchema), entries: z.array(entrySchema) })
export type LegacyQueueEnvelope = Omit<z.infer<typeof envelopeSchema>, "entries"> & { entries: DurableLegacyEntry[] }
export type ReviewToken = { epoch: string; revision: number }
export type Claim = { epoch: string; entryId: string; entryRevision: number; token: string; session: string; request: FrozenLegacyRequest }
export type LegacyDeliveryOutcome =
  | { kind: "acknowledged"; item: CollectedPokemon | null; activityEventId?: string }
  | { kind: "known-rejection"; category: "conflict" | "compatibility" | "recipient" | "billing" | "hard"; code: string; serverItem?: CollectedPokemon | null }
  | { kind: "unknown"; code: string }

export function failLegacy(code: string): never { throw new Error(code) }
/** Full equality, never digest-only. Unsupported structured mirror types are retained separately. */
export function sameLegacyValue(a: unknown, b: unknown): boolean {
  const seen = new Map<object, object>(), reverse = new Map<object, object>()
  const equal = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false
    if (seen.has(left)) return seen.get(left) === right
    if (reverse.has(right)) return reverse.get(right) === left
    if (Array.isArray(left) !== Array.isArray(right) || (Array.isArray(left) && left.length !== (right as unknown[]).length)) return false
    if (!Array.isArray(left) && (Object.getPrototypeOf(left) !== Object.prototype || Object.getPrototypeOf(right) !== Object.prototype)) return false
    seen.set(left, right); reverse.set(right, left)
    const keys = Object.keys(left), other = Object.keys(right)
    return keys.length === other.length && keys.every(key => Object.hasOwn(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
  }
  return equal(a, b)
}
export function isRetainedOperation(value: unknown): value is PendingCollectionOperation {
  return operationSchema.safeParse(value).success
}
export function parseLegacyEnvelope(value: unknown): LegacyQueueEnvelope {
  if (!envelopeSchema.safeParse(value).success) failLegacy("unsupported_legacy_queue")
  const envelope = value as LegacyQueueEnvelope
  const ids = new Set<string>(), sequences = new Set<number>(), sources = new Set<string>()
  for (const source of envelope.sources) {
    if (sources.has(source.sourceId) || new Set(source.accepted).size !== source.accepted.length
      || (source.kind === "local-storage" ? Object.hasOwn(source, "retainedValue") : source.raw !== null || !Object.hasOwn(source, "retainedValue"))) failLegacy("unsupported_legacy_queue")
    sources.add(source.sourceId)
  }
  for (const entry of envelope.entries) {
    if (ids.has(entry.entryId) || sequences.has(entry.sequence) || entry.sequence >= envelope.nextSequence
      || (entry.source && !sources.has(entry.source.sourceId))
      || ((entry.state === "sending") !== !!entry.lease) || (["sending", "unknown"].includes(entry.state) && !entry.request)
      || ((entry.state === "completed") !== !!entry.outcome)
      || (entry.outcome === "acknowledged" && entry.settlement?.kind !== "acknowledged")) failLegacy("unsupported_legacy_queue")
    ids.add(entry.entryId); sequences.add(entry.sequence)
    if (entry.state === "ready") validateNewOperation(entry.operation)
    if (entry.request && !sameLegacyValue(entry.request, freezeLegacyRequest(entry.operation))
      && !sameLegacyValue(entry.request, freezeLegacyRequest(entry.operation, 2))) failLegacy("unsupported_legacy_queue")
  }
  return structuredClone(envelope)
}
export function validateNewOperation(operation: PendingCollectionOperation) {
  if (!isRetainedOperation(operation) || !parseCollectionOrigin(operation.origin) || operation.intentProtocol !== 1
    || (operation.origin?.kind === "account" && operation.binderId !== operation.origin.binderId)
    || (operation.type === "upsert" && operation.item.pokemon_id !== operation.pokemonId)
    || operation.deliveryUnknown || operation.recipientPause || operation.compatibilityPause || operation.billingPause) failLegacy("invalid_legacy_intent")
}
export function sameLegacySlot(a: PendingCollectionOperation, b: Pick<PendingCollectionOperation, "origin" | "pokemonId">) {
  return a.pokemonId === b.pokemonId && sameCollectionOrigin(a.origin, b.origin)
}
export function makeLegacyOperation(input: PendingCollectionOperationInput, id: string, queuedAt: string, previous?: PendingCollectionOperation): PendingCollectionOperation {
  const next = { ...input, intentProtocol: 1, id, queuedAt } as PendingCollectionOperation
  if (previous) {
    if (Object.hasOwn(previous, "base")) next.base = previous.base
    else delete next.base
    next.id = previous.id; next.queuedAt = previous.queuedAt; next.recoverySource = previous.recoverySource
  }
  if (next.type === "upsert") next.acquisition = mergeQueuedAcquisition(next.base, next.item, next.acquisition, previous?.type === "upsert" ? previous.acquisition : undefined)
  const raw = JSON.stringify(next)
  if (previous) { next.original = previous.original; next.amendments = [...(previous.amendments ?? []), raw] }
  else next.original = { raw }
  if (next.origin) validateNewOperation(next)
  else if (!isRetainedOperation(next)) failLegacy("invalid_legacy_intent")
  return next
}
/** Pure request serialization; this module never fetches or adds the future cutover header. */
export function freezeLegacyRequest(operation: PendingCollectionOperation, generation?: 2): FrozenLegacyRequest {
  const headers: Record<string, string> = generation === 2 ? { "X-Holo-Legacy-Queue": "2" } : {}
  const origin = operation.origin
  if (origin?.kind !== "account" || operation.binderId !== origin.binderId) failLegacy("account_origin_required")
  const base: Record<string, string> = Object.hasOwn(operation, "base") ? { baseFingerprint: collectionFingerprint(operation.base) } : {}
  if (operation.type === "delete") {
    const params = new URLSearchParams({ pokemonId: String(operation.pokemonId), fingerprintVersion: String(COLLECTION_FINGERPRINT_VERSION), actorUserId: origin.actorUserId, ownerUserId: origin.ownerUserId, binderId: origin.binderId, operationId: operation.id, ...base })
    return { method: "DELETE", url: `/app/api/collection?${params}`, body: null, headers }
  }
  const item = operation.item
  return { method: "POST", url: "/app/api/collection", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({
    binderId: origin.binderId, pokemonId: operation.pokemonId, pokemonName: item.pokemon_name,
    cardId: item.card_id, cardName: item.card_name, cardImage: item.card_image, cardSet: item.card_set,
    cardLanguage: item.card_language ?? "en", cardFinish: item.card_finish ?? "normal", wantedCards: item.wanted_cards, status: item.status,
    recipient: origin, operationId: operation.id, ...(operation.importOnly ? { origin: "import" } : {}), fingerprintVersion: COLLECTION_FINGERPRINT_VERSION,
    ...(operation.acquisition ? { acquisition: operation.acquisition } : {}), ...base,
  }) }
}
export function legacyToken(envelope: LegacyQueueEnvelope): ReviewToken { return { epoch: envelope.epoch, revision: envelope.revision } }
export function newLegacyEntry(envelope: LegacyQueueEnvelope, operation: PendingCollectionOperation, entryId: string, source: DurableLegacyEntry["source"] = null, reason: string | null = null): DurableLegacyEntry {
  return { entryId, sequence: envelope.nextSequence++, revision: 0, operation, source, state: reason ? "paused" : "ready", reason, request: null, rejectedRequests: [], lease: null, settlement: null, outcome: null }
}
export function visibleLegacyOrigin(origin: CollectionOrigin | undefined, scope: CollectionOrigin | null) {
  return !!origin && !!scope && sameCollectionOrigin(origin, scope)
}
