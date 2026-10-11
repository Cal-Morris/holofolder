import test from "node:test"
import assert from "node:assert/strict"
import { getSelectedSlotCardDisplay, getBinderDisplayCard } from "../lib/selected-slot-card-display"

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


test("binder defaults to current and wanted mode keeps each printing's metadata together", () => {
  const current = { card_id: "current", card_name: "Current", card_image: "current.png", card_language: "en" as const, card_finish: "holo" as const, status: "collected" as const }
  const wanted = { card_id: "wanted", card_name: "Wanted", card_image: "wanted.png", card_language: "ja" as const, card_finish: "reverse_holo" as const, added_at: "2026-10-11T00:00:00Z" }
  const item = { ...current, wanted_cards: [wanted] }
  assert.equal(getBinderDisplayCard(item, "current"), item)
  assert.equal(getBinderDisplayCard(item, "wanted"), wanted)
  assert.equal(getBinderDisplayCard(current, "wanted"), current)
  assert.equal(getBinderDisplayCard({ ...item, status: "wishlisted" }, "current"), null)
  assert.equal(getBinderDisplayCard({ ...item, status: "wishlisted" }, "wanted"), wanted)
  assert.equal(getBinderDisplayCard(null, "current"), null)
})


test("legacy wishlisted printings remain wanted and never become current", () => {
  const item = { card_id: "legacy", card_name: "Legacy wanted", card_image: "wanted.png", status: "wishlisted" as const, wanted_cards: [] }
  assert.equal(getBinderDisplayCard(item, "current"), null)
  assert.equal(getBinderDisplayCard(item, "wanted"), item)
  const display = getSelectedSlotCardDisplay(item)
  assert.equal(display.primaryCard?.cardId, "legacy")
  assert.equal(display.currentCard, null)
})
