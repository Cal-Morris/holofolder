// Remote collection writes through /api/collection, plus error helpers.
import type { CollectedPokemon } from "@/lib/domain/cards"
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

/** A failed /api/collection write. `status` is null for network errors; on 409, `serverItem` is the current row. */
export class CollectionWriteError extends Error {
  status: number | null
  serverItem: CollectedPokemon | null

  constructor(message: string, status: number | null, serverItem: CollectedPokemon | null = null) {
    super(message)
    this.name = "CollectionWriteError"
    this.status = status
    this.serverItem = serverItem
  }
}

export interface RemoteWriteOptions {
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
  const message = payload?.error || `${fallback} (${response.status})`
  const serverItem = response.status === 409
    ? (payload?.item ? normalizeCollectionItem(payload.item) : null)
    : null
  if (isMissingStatusColumnError(message)) {
    return new CollectionWriteError(
      "The database is missing pokemon_collection.status. Run scripts/008_add_collection_status.sql against Supabase, then retry.",
      response.status,
    )
  }
  return new CollectionWriteError(message, response.status, serverItem)
}

export async function saveRemoteCollectionItem(item: CollectedPokemon, options: RemoteWriteOptions = {}) {
  const response = await sendCollectionWrite("/api/collection", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...getCollectionRequestBody(item, options.binderId ?? null),
      ...(options.baseFingerprint !== undefined ? { baseFingerprint: options.baseFingerprint } : {}),
    }),
  })

  if (!response.ok) {
    throw await toWriteError(response, "Failed to save collection item")
  }

  const payload = await readJsonResponse(response)
  return normalizeCollectionItem(payload?.item ?? item)
}

export async function deleteRemoteCollectionItem(pokemonId: number, options: RemoteWriteOptions = {}) {
  const params = new URLSearchParams({ pokemonId: String(pokemonId) })
  if (options.binderId) params.set("binderId", options.binderId)
  if (options.baseFingerprint !== undefined) params.set("baseFingerprint", options.baseFingerprint)
  const response = await sendCollectionWrite(`/api/collection?${params.toString()}`, {
    method: "DELETE",
  })

  if (!response.ok) {
    throw await toWriteError(response, "Failed to delete collection item")
  }
}
