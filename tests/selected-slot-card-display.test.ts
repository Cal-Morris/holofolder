import test from "node:test"
import assert from "node:assert/strict"
import { getSelectedSlotCardDisplay } from "../lib/selected-slot-card-display"

test("getSelectedSlotCardDisplay keeps wanted primary and current as secondary", () => {
  const display = getSelectedSlotCardDisplay({
    card_id: "current-1",
    card_name: "Allocated Pikachu",
    card_image: "current.png",
    card_set: "Base Set",
    card_language: "en",
    card_finish: "holo",
    wanted_cards: [
      {
        card_id: "wanted-1",
        card_name: "Wanted Pikachu",
        card_image: "wanted.png",
        card_set: "Jungle",
        card_language: "ja",
        card_finish: "reverse_holo",
        added_at: "2026-06-28T12:00:00.000Z",
      },
    ],
  })

  assert.equal(display.primaryCard?.cardId, "wanted-1")
  assert.equal(display.primaryCard?.cardName, "Wanted Pikachu")
  assert.equal(display.currentCard?.cardId, "current-1")
  assert.equal(display.currentCard?.cardName, "Allocated Pikachu")
})
