import { SEEDED_COLLECTION } from "./fixtures"

const ADDED = "2026-10-01T00:00:00.000Z"
const image = (set: string, setId: string, localId: string) => `https://assets.tcgdex.net/en/${set}/${setId}/${localId}/high.webp`

/** Owned Bulbasaur and Charmander (as seeded), plus a want list across four Pokémon. */
export const HUNT_COLLECTION = [
  {
    ...SEEDED_COLLECTION[0],
    wanted_cards: [
      { card_id: "sv03.5-166", card_name: "Bulbasaur", card_set: "151", card_language: "en", card_finish: "holo", rarity: "Illustration Rare", local_id: "166", set_total: 165, card_image: image("sv", "sv03.5", "166"), added_at: ADDED },
      { card_id: "me02-001", card_name: "Bulbasaur", card_set: "Phantasmal Flames", card_language: "en", card_finish: "normal", rarity: "Common", local_id: "001", set_total: 94, card_image: image("me", "me02", "001"), added_at: ADDED },
    ],
  },
  {
    ...SEEDED_COLLECTION[1],
    wanted_cards: [
      { card_id: "sv03.5-004", card_name: "Charmander", card_set: "151", card_language: "en", card_finish: "reverse_holo", rarity: "Common", local_id: "004", set_total: 165, card_image: image("sv", "sv03.5", "004"), added_at: ADDED },
    ],
  },
  {
    id: "e2e-6", user_id: SEEDED_COLLECTION[0].user_id, pokemon_id: 6, pokemon_name: "charizard", card_id: null, card_name: null, card_set: null, card_language: null, card_finish: null, status: "wishlisted", collected_at: ADDED,
    wanted_cards: [
      { card_id: "sv03.5-006", card_name: "Charizard ex", card_set: "151", card_language: "en", card_finish: "holo", rarity: "Double Rare", local_id: "006", set_total: 165, illustrator: "5ban Graphics", card_image: image("sv", "sv03.5", "006"), added_at: ADDED },
    ],
  },
  { id: "e2e-7", user_id: SEEDED_COLLECTION[0].user_id, pokemon_id: 7, pokemon_name: "squirtle", card_id: null, card_name: null, card_set: null, card_language: null, card_finish: null, status: "wishlisted", collected_at: ADDED, wanted_cards: [] },
]

export const HUNT_PRICES = {
  "sv03.5-166": { market: 40, confidence: "high" as const },
  "me02-001": { market: 3, confidence: "high" as const },
  "sv03.5-004": { market: 1, confidence: "high" as const, finishes: [{ finish: "reverse_holo" as const, market: 2.5 }] },
  "sv03.5-006": { market: 50, confidence: "high" as const },
  "sv03.5-001": { market: 0.5, confidence: "high" as const },
  "base1-44": { market: 12, confidence: "high" as const },
}
