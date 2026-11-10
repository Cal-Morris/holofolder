import type { CollectionOrigin } from "@/lib/collection/recipient"
// Remote collection writes through /app/api/collection, plus error helpers.
import type { AcquisitionIntent } from "@/lib/partner-push"
import { COLLECTION_FINGERPRINT_VERSION } from "@/lib/collection/sync"
import { isSlotStatus, type CollectedPokemon } from "@/lib/domain/cards"
import { normalizeCollectionItem } from "@/lib/collection/normalize"

export function extractErrorMessage(error: unknown) {
  if (!error) return "Unknown error"
  if (error instanceof Error) return error.message
  if (typeof error === "object") {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [candidate.message, candidate.details, candidate.hint, candidate.code].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    if (parts.length > 0) {
      return parts.join(" | ")
    }
  }
  return String(error)
}

export function isMissingStatusColumnError(error: unknown) {
  const message = extractErrorMessage(error).toLowerCase()
  return message.includes("status") && (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  )
}

export async function readJsonResponse(response: Response) {
  return response.json().catch(() => null)
}

export function getCollectionRequestBody(item: CollectedPokemon, binderId: string | null = null) {
  return {
    ...(binderId ? { binderId } : {}),
    pokemonId: item.pokemon_id,
    pokemonName: item.pokemon_name,
    cardId: item.card_id,
    cardName: item.card_name,
    cardImage: item.card_image,
    cardSet: item.card_set,
    cardLanguage: item.card_language ?? "en",
    cardFinish: item.card_finish ?? "normal",
    wantedCards: item.wanted_cards ?? [],
    status: item.status,
  }
}

/** A failed /app/api/collection write. `status` is null for network errors; on row-conflict 409, `serverItem` is the current row. Compatibility 409 has no row. */
export class CollectionWriteError extends Error {
  status: number | null
  code: string | null
  serverItem: CollectedPokemon | null

  constructor(message: string, status: number | null, serverItem: CollectedPokemon | null = null, code: string | null = null) {
    super(message)
    this.name = "CollectionWriteError"
    this.code = code
    this.status = status
    this.serverItem = serverItem
  }
}

export interface RemoteWriteOptions {
  recipient?: CollectionOrigin
  operationId?: string
  onCommittedEvent?: (eventId:string)=>void
  importOnly?: true
  acquisition?: AcquisitionIntent
  /** Fingerprint of the row this edit was based on; the server rejects the write with 409 if it changed. */
  baseFingerprint?: string
  /** The binder the edit belongs to; omitted means the owner's default binder. */
  binderId?: string | null
}

async function sendCollectionWrite(input: string, init: RequestInit) {
  try {
    return await fetch(input, init)
  } catch (error) {
    throw new CollectionWriteError(extractErrorMessage(error), null)
  }
}

async function toWriteError(response: Response, fallback: string) {
  const payload = await readJsonResponse(response)
  // An interrupted/unreadable error body is not proof of a row conflict or an absent row.
  if (!payload || typeof payload !== "object") return new CollectionWriteError(fallback, null)
  const code = typeof payload?.code === "string" ? payload.code : null
  const message = payload?.error || `${fallback} (${response.status})`
  const serverItem = response.status === 409
    ? (payload?.item ? normalizeCollectionItem(payload.item) : null)
    : null
  if (isMissingStatusColumnError(message)) {
    return new CollectionWriteError(
      "The database is missing pokemon_collection.status. Run scripts/008_add_collection_status.sql against Supabase, then retry.",
      response.status,
      null,
      code,
    )
  }
  return new CollectionWriteError(message, response.status, serverItem, code)
}

export async function saveRemoteCollectionItem(item: CollectedPokemon, options: RemoteWriteOptions = {}) {
  const response = await sendCollectionWrite("/app/api/collection", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...getCollectionRequestBody(item, options.binderId ?? null),
      recipient: options.recipient,
      operationId: options.operationId,
      ...(options.importOnly ? { origin: "import" } : {}),
      fingerprintVersion: COLLECTION_FINGERPRINT_VERSION,
      ...(options.acquisition ? { acquisition: options.acquisition } : {}),
      ...(options.baseFingerprint !== undefined ? { baseFingerprint: options.baseFingerprint } : {}),
    }),
  })

  if (!response.ok) {
    throw await toWriteError(response, "Failed to save collection item")
  }

  const payload = await readJsonResponse(response)
  const saved = payload?.item
  if (!saved || typeof saved !== "object" || typeof saved.id !== "string" || saved.pokemon_id !== item.pokemon_id
    || typeof saved.pokemon_name !== "string" || !isSlotStatus(saved.status) || !Array.isArray(saved.wanted_cards) || typeof saved.collected_at !== "string")
    throw new CollectionWriteError("The save reply was unreadable. Keep the original request on this device.", null)
  const eventId=response.headers.get('X-Activity-Event')
  if(eventId)options.onCommittedEvent?.(eventId)
  return normalizeCollectionItem(saved)
}

export async function deleteRemoteCollectionItem(pokemonId: number, options: RemoteWriteOptions = {}) {
  const params = new URLSearchParams({ pokemonId: String(pokemonId), fingerprintVersion: String(COLLECTION_FINGERPRINT_VERSION) })
  if (options.recipient?.kind === "account") {
    params.set("actorUserId", options.recipient.actorUserId)
    params.set("ownerUserId", options.recipient.ownerUserId)
  }
  if (options.operationId) params.set("operationId", options.operationId)
  if (options.binderId) params.set("binderId", options.binderId)
  if (options.baseFingerprint !== undefined) params.set("baseFingerprint", options.baseFingerprint)
  const response = await sendCollectionWrite(`/app/api/collection?${params.toString()}`, {
    method: "DELETE",
  })

  if (!response.ok) {
    throw await toWriteError(response, "Failed to delete collection item")
  }
  const payload = await readJsonResponse(response)
  if (payload?.success !== true) throw new CollectionWriteError("The delete reply was unreadable. Keep the original request on this device.", null)
  const eventId=response.headers.get('X-Activity-Event')
  if(eventId)options.onCommittedEvent?.(eventId)
}
