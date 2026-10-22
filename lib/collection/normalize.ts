// Pure normalizers for collection rows coming from Supabase, the API or local storage.
import {
  isSlotStatus,
  normalizeCardFinish,
  normalizeCardLanguage,
  type CollectedPokemon,
  type WantedCard,
} from "@/lib/domain/cards"

export function normalizeWantedCard(value: unknown): WantedCard | null {
  if (!value || typeof value !== "object") return null
  const item = value as Partial<WantedCard>
  if (typeof item.card_id !== "string" || typeof item.card_name !== "string") return null

  return {
    card_id: item.card_id,
    card_name: item.card_name,
    card_image: typeof item.card_image === "string" ? item.card_image : undefined,
    card_set: typeof item.card_set === "string" ? item.card_set : undefined,
    card_language: normalizeCardLanguage(item.card_language),
    card_finish: normalizeCardFinish(item.card_finish),
    rarity: typeof item.rarity === "string" ? item.rarity : undefined,
    local_id: typeof item.local_id === "string" ? item.local_id : undefined,
    set_total: typeof item.set_total === "number" && Number.isFinite(item.set_total) ? item.set_total : undefined,
    illustrator: typeof item.illustrator === "string" && item.illustrator.trim() ? item.illustrator.trim() : undefined,
    added_at: typeof item.added_at === "string" ? item.added_at : new Date().toISOString(),
  }
}

export function normalizeWantedCards(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const cards: WantedCard[] = []

  for (const rawCard of value) {
    const card = normalizeWantedCard(rawCard)
    if (!card) continue
    const key = `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`
    if (seen.has(key)) continue
    seen.add(key)
    cards.push(card)
  }

  return cards
}

export function normalizeCollectionItem(item: Partial<CollectedPokemon>): CollectedPokemon {
  const wantedCards = normalizeWantedCards(item.wanted_cards)
  const cardLanguage = normalizeCardLanguage(item.card_language)
  const cardFinish = normalizeCardFinish(item.card_finish)
  const status = isSlotStatus(item.status) ? item.status : "collected"
  const legacyWantedCards = status === "wishlisted" && typeof item.card_id === "string" && typeof item.card_name === "string" && wantedCards.length === 0
    ? [{
        card_id: item.card_id,
        card_name: item.card_name,
        card_image: typeof item.card_image === "string" ? item.card_image : undefined,
        card_set: typeof item.card_set === "string" ? item.card_set : undefined,
        card_language: cardLanguage,
        card_finish: cardFinish,
        added_at: typeof item.collected_at === "string" ? item.collected_at : new Date().toISOString(),
      }]
    : wantedCards

  return {
    id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
    pokemon_id: typeof item.pokemon_id === "number" ? item.pokemon_id : 0,
    pokemon_name: typeof item.pokemon_name === "string" ? item.pokemon_name : "Unknown Pokemon",
    card_id: status === "wishlisted" ? undefined : typeof item.card_id === "string" ? item.card_id : undefined,
    card_name: status === "wishlisted" ? undefined : typeof item.card_name === "string" ? item.card_name : undefined,
    card_image: status === "wishlisted" ? undefined : typeof item.card_image === "string" ? item.card_image : undefined,
    card_set: status === "wishlisted" ? undefined : typeof item.card_set === "string" ? item.card_set : undefined,
    card_language: cardLanguage,
    card_finish: cardFinish,
    wanted_cards: legacyWantedCards,
    status,
    collected_at: typeof item.collected_at === "string" ? item.collected_at : new Date().toISOString(),
  }
}

export function normalizeCollectionItems(items: Partial<CollectedPokemon>[] | null | undefined) {
  return Array.isArray(items) ? items.map((item) => normalizeCollectionItem(item)) : []
}

export function upsertCollectionItem(items: CollectedPokemon[], item: CollectedPokemon) {
  const existing = items.findIndex((currentItem) => currentItem.pokemon_id === item.pokemon_id)
  if (existing >= 0) {
    const updated = [...items]
    updated[existing] = item
    return updated.sort((a, b) => a.pokemon_id - b.pokemon_id)
  }

  return [...items, item].sort((a, b) => a.pokemon_id - b.pokemon_id)
}

export function removeCollectionItem(items: CollectedPokemon[], pokemonId: number) {
  return items.filter((item) => item.pokemon_id !== pokemonId)
}

export function numberArraysEqual(a: number[], b: number[]) {
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }

  return true
}
