import test from "node:test"
import assert from "node:assert/strict"
import { getWantedCardPreview, getWantedDisplayCard } from "../lib/collection-display"

const wantedCard = {
  card_id: "sv1-25",
  card_name: "Pikachu Illustration Rare",
  card_image: "https://example.com/pikachu-ir.png",
  card_set: "Scarlet & Violet",
  card_language: "en" as const,
  card_finish: "illustration_rare" as const,
  added_at: "2026-06-28T12:00:00.000Z",
}

test("getWantedCardPreview returns the first specific wanted card", () => {
  assert.deepEqual(getWantedCardPreview({
    pokemon_id: 25,
    pokemon_name: "Pikachu",
    wanted_cards: [wantedCard],
    status: "wishlisted",
    collected_at: "2026-06-28T12:00:00.000Z",
  }), wantedCard)
})

test("getWantedDisplayCard prefers wanted card fields over generic collection fields", () => {
  assert.deepEqual(getWantedDisplayCard({
    pokemon_id: 25,
    pokemon_name: "Pikachu",
    card_id: "base-025",
    card_name: "Pikachu",
    card_image: "https://example.com/generic-pikachu.png",
    card_set: "Base Set",
    wanted_cards: [wantedCard],
    status: "collected",
    collected_at: "2026-06-28T12:00:00.000Z",
  }, "Pikachu"), {
    id: "sv1-25",
    name: "Pikachu Illustration Rare",
    image: "https://example.com/pikachu-ir.png",
    set: "Scarlet & Violet",
    language: "en",
    finish: "illustration_rare",
    isSpecificCard: true,
  })
})

test("getWantedDisplayCard falls back without inventing a specific card", () => {
  assert.deepEqual(getWantedDisplayCard({
    pokemon_id: 25,
    pokemon_name: "Pikachu",
    wanted_cards: [],
    status: "wishlisted",
    collected_at: "2026-06-28T12:00:00.000Z",
  }, "Pikachu"), {
    id: null,
    name: "Pikachu",
    image: null,
    set: null,
    language: null,
    finish: null,
    isSpecificCard: false,
  })
})
