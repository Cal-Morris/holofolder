import type { Page } from "@playwright/test"
import { E2E_USER, SEEDED_COLLECTION } from "./fixtures"
import { mockCardPrices, type FixturePrice } from "./price-fixtures"

/**
 * TEST FIXTURES ONLY: a small want list across several Pokémon with synthetic prices.
 * Illustrator credits and amounts are made up for the tests.
 */
type SeedWanted = { card_id: string; card_name: string; card_set: string; local_id: string; set_total?: number; card_finish?: string; rarity?: string; illustrator?: string; added_at: string }

function wanted(card: SeedWanted) {
  const setId = card.card_id.slice(0, card.card_id.lastIndexOf("-"))
  return { card_language: "en", card_finish: "normal", card_image: `https://assets.tcgdex.net/en/mock/${setId}/${card.local_id}/high.webp`, ...card }
}

export const WANTED_COLLECTION = [
  { ...SEEDED_COLLECTION[0], wanted_cards: [wanted({ card_id: "sv03.5-166", card_name: "Bulbasaur", card_set: "151", local_id: "166", set_total: 165, card_finish: "holo", rarity: "Illustration Rare", illustrator: "Mitsuhiro Arita", added_at: "2026-03-01T00:00:00.000Z" })] },
  { ...SEEDED_COLLECTION[1], wanted_cards: [wanted({ card_id: "sv03.5-168", card_name: "Charmander", card_set: "151", local_id: "168", set_total: 165, card_finish: "holo", rarity: "Illustration Rare", illustrator: "Kouki Saitō", added_at: "2026-05-01T00:00:00.000Z" })] },
  { id: "e2e-5", user_id: E2E_USER.id, pokemon_id: 5, pokemon_name: "charmeleon", status: "wishlisted", collected_at: "2026-01-01T00:00:00.000Z", wanted_cards: [wanted({ card_id: "sv03.5-005", card_name: "Charmeleon", card_set: "151", local_id: "005", set_total: 165, added_at: "2026-02-01T00:00:00.000Z" })] },
  { id: "e2e-6", user_id: E2E_USER.id, pokemon_id: 6, pokemon_name: "charizard", status: "wishlisted", collected_at: "2026-01-01T00:00:00.000Z", wanted_cards: [wanted({ card_id: "sv03.5-006", card_name: "Charizard ex", card_set: "151", local_id: "006", set_total: 165, card_finish: "holo", added_at: "2026-04-01T00:00:00.000Z" })] },
  { id: "e2e-7", user_id: E2E_USER.id, pokemon_id: 7, pokemon_name: "squirtle", status: "wishlisted", collected_at: "2026-01-01T00:00:00.000Z", wanted_cards: [
    wanted({ card_id: "sv03.5-007", card_name: "Squirtle", card_set: "151", local_id: "007", set_total: 165, added_at: "2026-01-15T00:00:00.000Z" }),
    wanted({ card_id: "30th-007", card_name: "Squirtle", card_set: "30th Celebration", local_id: "007", set_total: 128, card_finish: "holo", added_at: "2026-06-01T00:00:00.000Z" }),
  ] },
]

export const WANTED_PRICES: Record<string, FixturePrice> = {
  "sv03.5-168": { confidence: "high", market: 85, trend: { "30d": 62, "7d": 70, Trend: 85 } },
  "sv03.5-166": { confidence: "high", market: 42, trend: { "30d": 44, "7d": 43, Trend: 42 } },
  "sv03.5-006": { confidence: "medium", market: 18.5 },
  "sv03.5-007": { confidence: "medium", market: 1.2 },
  "sv03.5-005": { confidence: "medium", market: 0.9 },
}

/** Serve the seeded want list and prices; call harness.open() afterwards so the binder loads them. */
export async function seedWantList(page: Page, collection: unknown[] = WANTED_COLLECTION) {
  await mockCardPrices(page, WANTED_PRICES)
  await page.route(/\/rest\/v1\/pokemon_collection/, (route) => route.request().method() === "GET" ? route.fulfill({ json: collection }) : route.fallback())
}
