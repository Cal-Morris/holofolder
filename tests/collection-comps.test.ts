import { test } from "node:test"
import assert from "node:assert/strict"
import { collectionCompsTargets } from "../lib/collection-comps"
import type { CollectedPokemon } from "../lib/domain/cards"

test("current binder targets use wanted printings and exclude wishlisted owned slots", () => {
  // Synthetic binder rows, no market or account data.
  const base: CollectedPokemon = { id: "1", pokemon_id: 1, pokemon_name: "Synthetic", status: "collected", collected_at: "", card_id: "owned", card_language: "en", card_finish: "holo", wanted_cards: [{ card_id: "wanted", card_name: "Synthetic wanted", card_language: "ja", card_finish: "normal", added_at: "" }] }
  const rows = [base, { ...base, id: "2", status: "wishlisted" as const, card_id: "not-owned", wanted_cards: [] }]
  assert.deepEqual(collectionCompsTargets(rows, "owned"), [{ cardId: "owned", language: "en", finish: "holo" }])
  assert.deepEqual(collectionCompsTargets(rows, "wanted"), [{ cardId: "wanted", language: "ja", finish: "normal" }])
  assert.deepEqual(collectionCompsTargets([], "owned"), [])
})
