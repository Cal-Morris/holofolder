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

export function getCollectionRequestBody(item: CollectedPokemon) {
  return {
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

export async function saveRemoteCollectionItem(item: CollectedPokemon) {
  const response = await fetch("/api/collection", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(getCollectionRequestBody(item)),
  })

  if (!response.ok) {
    const payload = await readJsonResponse(response)
    const message = payload?.error || `Failed to save collection item (${response.status})`
    if (isMissingStatusColumnError(message)) {
      throw new Error(
        "The database is missing pokemon_collection.status. Run scripts/008_add_collection_status.sql against Supabase, then retry.",
      )
    }
    throw new Error(message)
  }

  const payload = await readJsonResponse(response)
  return normalizeCollectionItem(payload?.item ?? item)
}

export async function deleteRemoteCollectionItem(pokemonId: number) {
  const response = await fetch(`/api/collection?pokemonId=${pokemonId}`, {
    method: "DELETE",
  })

  if (!response.ok) {
    const payload = await readJsonResponse(response)
    throw new Error(payload?.error || `Failed to delete collection item (${response.status})`)
  }
}
