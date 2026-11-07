// Offline write sync: how queued collection edits reach the server.
//
// Conflict model (no schema change needed): every queued edit remembers the server row it was based on
// ("base"). The server only applies a write when the row still matches that base (compare-and-set on a
// fingerprint of the row's meaningful fields); otherwise it answers 409 with the current row and the client
// does a three-way merge per field group:
//   - owned printing (card + language + finish), status: the side that changed since base wins; if only the
//     server changed it, the server's value is kept.
//   - wanted cards: set merge; local additions and removals since base are applied on top of the server's list.
//   - a queued delete only goes through if nobody changed the row since; otherwise the newer server row stays.
// Writes are idempotent (upsert on (user_id, pokemon_id), delete by key), and an edit whose result the server
// already has is dropped, so a retry after a lost response never duplicates anything.
import type { CollectedPokemon, WantedCard } from "@/lib/domain/cards"
import { normalizeCollectionItem } from "@/lib/collection/normalize"
import { mergeWantedPeople } from "@/lib/wanted-people"

export const COLLECTION_FINGERPRINT_VERSION = 2

export const ABSENT_ROW_FINGERPRINT = "absent"

function wantedKey(card: WantedCard) {
  return `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`
}

function ownedGroup(item: CollectedPokemon) {
  return JSON.stringify([item.card_id ?? null, item.card_language ?? "en", item.card_finish ?? "normal"])
}

/** Stable fingerprint of what a row means to the user (ids, names and timestamps are ignored). */
export function collectionFingerprint(item: Partial<CollectedPokemon> | null | undefined) {
  if (!item) return ABSENT_ROW_FINGERPRINT
  const normalized = normalizeCollectionItem(item)
  return JSON.stringify({
    status: normalized.status,
    owned: ownedGroup(normalized),
    wanted: normalized.wanted_cards.map(card => `${wantedKey(card)}${card.wanted_by === undefined ? "" : `:wanted-by:${[...card.wanted_by].sort().join(",")}`}`).sort(),
  })
}

/** Older installed clients do not know wanted_by; their other conflict protections still apply. */
export function matchesCollectionFingerprint(item: Partial<CollectedPokemon> | null | undefined, expected: string, allowLegacyPeople = false) {
  if (collectionFingerprint(item) === expected) return true
  if (!allowLegacyPeople || !item) return false
  return collectionFingerprint({ ...item, wanted_cards: item.wanted_cards?.map(({ wanted_by: _people, ...card }) => card) }) === expected
}

export type PendingEdit =
  | { type: "upsert"; pokemonId: number; item: CollectedPokemon; base?: CollectedPokemon | null }
  | { type: "delete"; pokemonId: number; base?: CollectedPokemon | null }

/** Re-apply queued edits on top of a collection loaded from the server or the page, so they never flash away. */
export function applyPendingEdits(collection: CollectedPokemon[], edits: PendingEdit[]) {
  if (edits.length === 0) return collection
  const byId = new Map(collection.map((item) => [item.pokemon_id, item] as const))
  for (const edit of edits) {
    if (edit.type === "upsert") {
      const current = byId.get(edit.pokemonId)
      byId.set(edit.pokemonId, current ? { ...edit.item, id: current.id } : edit.item)
    } else {
      byId.delete(edit.pokemonId)
    }
  }
  return [...byId.values()].sort((a, b) => a.pokemon_id - b.pokemon_id)
}

export type ConflictResolution =
  | { action: "write"; item: CollectedPokemon; base: CollectedPokemon | null }
  | { action: "delete"; base: CollectedPokemon }
  | { action: "drop"; serverItem: CollectedPokemon | null }

/** Three-way merge of a queued edit against the row the server has now. */
export function resolveConflict(edit: PendingEdit, serverItem: CollectedPokemon | null): ConflictResolution {
  const base = edit.base ?? null

  if (edit.type === "delete") {
    if (!serverItem) return { action: "drop", serverItem: null }
    // Someone changed the row after we decided to remove it: keep their newer version.
    if (collectionFingerprint(serverItem) !== collectionFingerprint(base)) return { action: "drop", serverItem }
    return { action: "delete", base: serverItem }
  }

  const local = edit.item
  if (collectionFingerprint(local) === collectionFingerprint(serverItem)) {
    return { action: "drop", serverItem }
  }
  if (!serverItem) {
    // Removed elsewhere while we edited it: our edit is the latest explicit intent, so it is re-created.
    return { action: "write", item: local, base: null }
  }

  const baseItem = base ?? null
  const ownedChangedLocally = !baseItem || ownedGroup(local) !== ownedGroup(baseItem)
  const statusChangedLocally = !baseItem || local.status !== baseItem.status

  const baseWanted = new Map((baseItem?.wanted_cards ?? []).map((card) => [wantedKey(card), card] as const))
  const localWanted = new Map(local.wanted_cards.map((card) => [wantedKey(card), card] as const))
  const mergedWanted = new Map(serverItem.wanted_cards.map((card) => [wantedKey(card), card] as const))
  for (const [key, card] of localWanted) {
    const remote = mergedWanted.get(key)
    if (!baseWanted.has(key)) {
      mergedWanted.set(key, remote ? { ...card, wanted_by: mergeWantedPeople(undefined, card.wanted_by, remote.wanted_by) } : card)
    } else if (remote) {
      mergedWanted.set(key, { ...remote, wanted_by: mergeWantedPeople(baseWanted.get(key)?.wanted_by, card.wanted_by, remote.wanted_by) })
    }
  }
  for (const key of baseWanted.keys()) if (!localWanted.has(key)) mergedWanted.delete(key)

  const owned = ownedChangedLocally ? local : serverItem
  const merged = normalizeCollectionItem({
    ...serverItem,
    pokemon_name: local.pokemon_name || serverItem.pokemon_name,
    card_id: owned.card_id,
    card_name: owned.card_name,
    card_image: owned.card_image,
    card_set: owned.card_set,
    card_language: owned.card_language,
    card_finish: owned.card_finish,
    status: statusChangedLocally ? local.status : serverItem.status,
    wanted_cards: [...mergedWanted.values()],
  })

  if (collectionFingerprint(merged) === collectionFingerprint(serverItem)) {
    return { action: "drop", serverItem }
  }
  return { action: "write", item: merged, base: serverItem }
}

export type WriteFailureKind = "retry" | "conflict" | "hard" | "paused"

/**
 * Network errors, timeouts, 5xx, 401 (session refresh), 408 and 429 are retried with backoff. 409 is a conflict.
 * Any other 4xx means the server will never accept this edit, so it is rolled back.
 */
export function classifyWriteFailure(error: unknown): WriteFailureKind {
  const status = typeof (error as { status?: unknown } | null)?.status === "number" ? (error as { status: number }).status : null
  if (status === null) return "retry"
  if (status === 402) return "paused"
  if (status === 409) return "conflict"
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "retry"
  if (status >= 400) return "hard"
  return "retry"
}

export const SYNC_RETRY_BASE_MS = 2_000
export const SYNC_RETRY_MAX_MS = 5 * 60_000

/** Exponential backoff with jitter: ~2 s, 4 s, 8 s … capped at 5 min. */
export function nextSyncRetryDelay(attempt: number, random = Math.random) {
  const exponential = Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * 2 ** Math.max(0, attempt))
  return Math.round(exponential * (0.75 + random() * 0.5))
}
