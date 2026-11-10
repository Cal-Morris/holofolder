import { CARD_FINISHES, CARD_LANGUAGES, isSlotStatus, type CollectedPokemon } from "@/lib/domain/cards"
import { parseCollectionOrigin, sameCollectionOrigin } from "@/lib/collection/recipient"
import { decodeQueueArray, isLegacyQueueSource, type LegacyQueueSource } from "@/lib/collection/legacy-source"

export interface LegacyReviewEntry {
  source: LegacyQueueSource
  ordinal: number
  label: string
  operation?: { type: "upsert"; pokemonId: number; item: CollectedPokemon } | { type: "delete"; pokemonId: number }
  unresolved?: string
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k))
const rowKeys = ["id", "pokemon_id", "pokemon_name", "card_id", "card_name", "card_image", "card_set", "card_language", "card_finish", "wanted_cards", "status", "collected_at"]
const wantedKeys = ["card_id", "card_name", "card_image", "card_set", "card_language", "card_finish", "rarity", "local_id", "set_total", "illustrator", "added_at"]
function printing(v: Record<string, unknown>) {
  return (v.card_language === undefined || CARD_LANGUAGES.includes(v.card_language as typeof CARD_LANGUAGES[number]))
    && (v.card_finish === undefined || CARD_FINISHES.includes(v.card_finish as typeof CARD_FINISHES[number]))
}
/** Validate a lossless editable projection; never use the wanted normalizer as a recovery decoder. */
export function reviewableLegacyRow(v: unknown): v is CollectedPokemon {
  if (!object(v) || !only(v, rowKeys) || typeof v.id !== "string" || !Number.isInteger(v.pokemon_id)
    || typeof v.pokemon_name !== "string" || !isSlotStatus(v.status) || typeof v.collected_at !== "string" || !Array.isArray(v.wanted_cards) || !printing(v)) return false
  if (["card_id", "card_name", "card_image", "card_set"].some(k => v[k] !== undefined && typeof v[k] !== "string")) return false
  if (v.status === "wishlisted" && v.card_id !== undefined) return false
  const identities = new Set<string>()
  const localIds = new Set<string>()
  for (const card of v.wanted_cards) {
    if (!object(card) || !only(card, wantedKeys) || typeof card.card_id !== "string" || typeof card.card_name !== "string" || typeof card.added_at !== "string" || !printing(card)) return false
    if (["card_image", "card_set", "rarity", "local_id", "illustrator"].some(k => card[k] !== undefined && typeof card[k] !== "string")) return false
    if (card.set_total !== undefined && (typeof card.set_total !== "number" || !Number.isFinite(card.set_total))) return false
    if (typeof card.local_id === "string") {
      if (localIds.has(card.local_id)) return false
      localIds.add(card.local_id)
    }
    const identity = JSON.stringify([card.card_id, card.card_language ?? "en", card.card_finish ?? "normal"])
    if (identities.has(identity)) return false
    identities.add(identity)
  }
  return true
}
export function legacyReviewEntries(sources: LegacyQueueSource[], pausedBinders: (string | null)[] = [], currentActorId?: string | null): LegacyReviewEntry[] {
  return sources.flatMap(source => {
    const entries = decodeQueueArray(source.legacyQueueSource.raw)
    if (!entries) return [{ source, ordinal: -1, label: "Unreadable original data", unresolved: "This source is not a JSON array. Download the original data for manual recovery." }]
    return entries.flatMap((v, ordinal): LegacyReviewEntry[] => {
      if (source.legacyQueueSource.accepted?.includes(ordinal) || (source.legacyQueueSource.ordinals && !source.legacyQueueSource.ordinals.includes(ordinal))) return []
      if (isLegacyQueueSource(v)) return []
      const origin = object(v) ? parseCollectionOrigin(v.origin) : null
      if (origin?.kind === "account" && origin.actorUserId !== currentActorId) return []
      const result: LegacyReviewEntry = { source, ordinal, label: object(v) && typeof v.pokemonId === "number" ? `Pokémon #${v.pokemonId}` : `Original entry ${ordinal + 1}` }
      const fail = (reason: string) => [{ ...result, unresolved: reason }]
      if (origin?.kind === "account") return fail("The saved account request has an unsupported protocol or shape. Keep its original recipient and download the original data before making another edit.")
      if (!object(v)) return fail("Malformed record, kept exactly as saved.")
      if (pausedBinders.includes(typeof v.binderId === "string" ? v.binderId : null)) return fail("Converted binder pause. This review cannot clear it.")
      if (v.compatibilityPause) return fail("Converted binder pause. This review cannot clear it.")
      if (v.acquisition !== undefined) return fail("Acquisition identity or delivery outcome needs separate verification. The original request is retained.")
      if (!only(v, ["id", "type", "pokemonId", "item", "queuedAt", "base", "binderId", "origin", "original", "importOnly", "intentProtocol", "amendments"])) return fail("Unknown fields or protocol, retained without conversion.")
      if (v.intentProtocol !== undefined && v.intentProtocol !== 1) return fail("Unknown intent protocol. Original data is retained.")
      if (v.original !== undefined || v.amendments !== undefined) {
        if ((v.origin !== undefined && parseCollectionOrigin(v.origin)?.kind !== "guest") || v.intentProtocol !== 1 || !object(v.original) || !only(v.original, ["raw"]) || typeof v.original.raw !== "string") return fail("Unknown original intent metadata.")
        const rawIntents = [v.original.raw, ...(Array.isArray(v.amendments) ? v.amendments : [])]
        if (v.amendments !== undefined && !Array.isArray(v.amendments)) return fail("Unreadable amendment history.")
        for (const raw of rawIntents) {
          let original: unknown
          try { original = JSON.parse(raw) } catch { return fail("Unreadable original intent.") }
          if (!object(original) || !only(original, ["id", "type", "pokemonId", "item", "queuedAt", "base", "binderId", "origin", "importOnly", "intentProtocol"])
            || original.acquisition !== undefined || !(sameCollectionOrigin(parseCollectionOrigin(original.origin), parseCollectionOrigin(v.origin)) || (original.origin === undefined && v.origin === undefined))
            || original.pokemonId !== v.pokemonId || !("base" in original) || (original.base !== null && !reviewableLegacyRow(original.base))
            || (original.type !== "delete" && (original.type !== "upsert" || !reviewableLegacyRow(original.item)))) return fail("Original intent or amendment contains unresolved fields. No part has been omitted.")
        }
      }
      if (typeof v.id !== "string" || !v.id || entries.filter(e => object(e) && e.id === v.id).length !== 1) return fail("Missing or duplicate source ID. Review the original data manually.")
      if (!Number.isInteger(v.pokemonId) || (v.pokemonId as number) <= 0 || typeof v.queuedAt !== "string") return fail("Missing original identity or timestamp.")
      if (entries.filter(e => object(e) && e.pokemonId === v.pokemonId && (sameCollectionOrigin(parseCollectionOrigin(e.origin), parseCollectionOrigin(v.origin)) || (!parseCollectionOrigin(e.origin) && !parseCollectionOrigin(v.origin)))).length !== 1) return fail("Multiple original changes for this Pokémon, no change has been deduplicated.")
      if (!("base" in v) || (v.base !== null && !reviewableLegacyRow(v.base))) return fail("The original base or delivery outcome is unknown. Download the data and compare before making a new edit.")
      if (v.type === "upsert" && reviewableLegacyRow(v.item) && v.item.pokemon_id === v.pokemonId)
        return [{ ...result, label: v.item.pokemon_name, operation: { type: "upsert", pokemonId: v.pokemonId as number, item: v.item } }]
      if (v.type === "delete") return [{ ...result, operation: { type: "delete", pokemonId: v.pokemonId as number } }]
      return fail("The saved row has unknown fields, duplicate wanted cards or wanted-by semantics. It remains unresolved.")
    })
  })
}
