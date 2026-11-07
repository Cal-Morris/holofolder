import test from "node:test"
import assert from "node:assert/strict"
import { getSelectedSlotCardDisplay, getBinderDisplayCard } from "../lib/selected-slot-card-display"

test("an explicitly opened wanted printing overrides the binder display without replacing owned metadata", () => {
  const first = { card_id: "synthetic-first", card_name: "First", added_at: "2026-01-01" }
  const tapped = { ...first, card_id: "synthetic-tapped", card_name: "Tapped", card_language: "ja" as const, card_finish: "holo" as const }
  const item = { card_id: "synthetic-owned", card_name: "Owned", status: "collected" as const, wanted_cards: [first, tapped] }
  const display = getSelectedSlotCardDisplay(item, "current", tapped)
  assert.equal(display.primaryCard?.cardId, tapped.card_id)
  assert.equal(display.primaryCard?.cardLanguage, "ja")
  assert.equal(display.primaryCard?.cardFinish, "holo")
  assert.equal(display.currentCard?.cardId, item.card_id)
})

test("getSelectedSlotCardDisplay follows the selected mode and retains owned metadata", () => {
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
  }, "wanted")

  assert.equal(display.primaryCard?.cardId, "wanted-1")
  assert.equal(display.primaryCard?.cardName, "Wanted Pikachu")
  assert.equal(display.currentCard?.cardId, "current-1")
  assert.equal(display.currentCard?.cardName, "Allocated Pikachu")
})


test("owned and wanted mode keeps each printing's metadata together", () => {
  const current = { card_id: "current", card_name: "Current", card_image: "current.png", card_language: "en" as const, card_finish: "holo" as const, status: "collected" as const }
  const wanted = { card_id: "wanted", card_name: "Wanted", card_image: "wanted.png", card_language: "ja" as const, card_finish: "reverse_holo" as const, added_at: "2026-10-11T00:00:00Z" }
  const item = { ...current, wanted_cards: [wanted] }
  assert.equal(getBinderDisplayCard(item, "current"), item)
  assert.equal(getBinderDisplayCard(item, "wanted"), wanted)
  assert.equal(getBinderDisplayCard(current, "wanted"), null)
  assert.equal(getBinderDisplayCard({ ...item, status: "wishlisted" }, "current"), null)
  assert.equal(getBinderDisplayCard({ ...item, status: "wishlisted" }, "wanted"), wanted)
  assert.equal(getBinderDisplayCard(null, "current"), null)
})


test("legacy wishlisted printings remain wanted and never become current", () => {
  const item = { card_id: "legacy", card_name: "Legacy wanted", card_image: "wanted.png", status: "wishlisted" as const, wanted_cards: [] }
  assert.equal(getBinderDisplayCard(item, "current"), null)
  assert.equal(getBinderDisplayCard(item, "wanted"), item)
  const display = getSelectedSlotCardDisplay(item, "wanted")
  assert.equal(display.primaryCard?.cardId, "legacy")
  assert.equal(display.currentCard, null)
})

test("current details do not borrow wanted metadata, and missing wanted stays missing", () => {
  const item = { card_id: "owned", card_name: "Owned", status: "collected" as const, wanted_cards: [{ card_id: "wanted", card_name: "Wanted", card_set: "Wanted Set", added_at: "2026-10-11T00:00:00Z" }] }
  assert.equal(getSelectedSlotCardDisplay(item, "current").primaryCard?.cardId, "owned")
  assert.equal(getSelectedSlotCardDisplay(item, "current").primaryCard?.cardSet, undefined)
  assert.equal(getSelectedSlotCardDisplay({ ...item, wanted_cards: [] }, "wanted").primaryCard, null)
})


test("mixed restores wanted-first printings alongside owned and legacy wanted slots", () => {
  const owned = { card_id: "owned", card_name: "Owned", status: "collected" as const }
  const wanted = { card_id: "wanted", card_name: "Wanted", added_at: "2026-10-11T00:00:00Z" }
  const both = { ...owned, wanted_cards: [wanted] }
  assert.equal(getBinderDisplayCard(both, "mixed"), wanted)
  assert.equal(getBinderDisplayCard(owned, "mixed"), owned)
  assert.equal(getBinderDisplayCard({ status: "wishlisted", wanted_cards: [wanted] }, "mixed"), wanted)
  const legacy = { ...owned, status: "wishlisted" as const }
  assert.equal(getBinderDisplayCard(legacy, "mixed"), legacy)
  assert.equal(getBinderDisplayCard(null, "mixed"), null)
  assert.equal(getBinderDisplayCard({ wanted_cards: [] }, "mixed"), null)
  assert.equal(getSelectedSlotCardDisplay(both, "mixed").primaryCard?.cardId, "wanted")
  assert.equal(getSelectedSlotCardDisplay(both, "mixed").currentCard?.cardId, "owned")
})
