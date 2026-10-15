import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { getSetSlotState, getSetCardState, getSetChecklistCards, mergeSetSlots, matchesSetSlotFilter } from "../lib/set-checklist"
import type { CollectedPokemon } from "../lib/domain/cards"
import type { TCGSetSlotCard, TCGSetDexSlot } from "../lib/tcg-set-slots"

// Synthetic identities test catalogue/collection membership, not real card data.
const card: TCGSetSlotCard = { id: "fixture-set-1", localId: "1", name: "Fixture", language: "en", set: { id: "fixture-set", name: "Fixture set" }, inferredFinish: "normal" }
const slot: TCGSetDexSlot = { dexId: 1, pokemonName: "fixture", cards: [card] }
const owned: CollectedPokemon = { id: "fixture-row", pokemon_id: 1, pokemon_name: "fixture", status: "collected", card_id: card.id, wanted_cards: [], collected_at: "2026-01-01" }

describe("set checklist identity", () => {
  test("only an exact tracked printing belongs to owned-in-set", () => {
    assert.deepEqual(getSetSlotState(slot, owned), { ownedInSet: true, ownedElsewhere: false, wantedInSet: false })
    assert.deepEqual(getSetSlotState(slot, { ...owned, card_id: "fixture-other-1" }), { ownedInSet: false, ownedElsewhere: true, wantedInSet: false })
    assert.deepEqual(getSetSlotState(slot, { ...owned, card_id: undefined }), { ownedInSet: false, ownedElsewhere: true, wantedInSet: false })
    assert.equal(getSetSlotState(slot, { ...owned, status: "wishlisted" }).ownedInSet, false)
    assert.equal(getSetSlotState(slot, undefined).ownedElsewhere, false)
  })
  test("wanted identities are scoped to this set, including legacy wishlisted cards", () => {
    const wanted = { card_id: "fixture-other-1", card_name: "Other", added_at: "2026-01-01" }
    assert.equal(getSetSlotState(slot, { ...owned, wanted_cards: [wanted] }).wantedInSet, false)
    assert.equal(getSetSlotState(slot, { ...owned, wanted_cards: [{ ...wanted, card_id: card.id }] }).wantedInSet, true)
    assert.deepEqual(getSetCardState(card, [{ ...owned, status: "wishlisted" }]), { owned: false, wanted: true })
    assert.deepEqual(getSetCardState(card, [owned]), { owned: true, wanted: false })
  })
  test("all-card response retains unmapped cards and deduplicates multi-species cards", () => {
    const trainer = { ...card, id: "fixture-trainer", name: "Fixture Trainer" }
    assert.deepEqual(getSetChecklistCards({ sets: [], selectedSet: null, slots: [slot, { ...slot, dexId: 2 }], cards: [card, trainer] }), [card, trainer])
    assert.deepEqual(getSetChecklistCards({ sets: [], selectedSet: null, slots: [slot, { ...slot, dexId: 2 }] }), [card])
    assert.deepEqual(getSetCardState(trainer, [owned]), { owned: false, wanted: false })
  })
})

// Losing either set's alternate printings would hide legitimate matches.
test("merge set slots keeps every printing under one Pokémon and deduplicates repeats", () => {
  const other = { ...card, id: "fixture-other-2", set: { id: "fixture-other", name: "Other fixture" }, variants: { reverse: true } }
  assert.deepEqual(mergeSetSlots([[slot], [{ ...slot, cards: [other, card] }, { ...slot, dexId: 2 }]]), [
    { ...slot, cards: [card, other] }, { ...slot, dexId: 2 },
  ])
})

test("binder filters use species ownership and wants outside the selected sets", () => {
  const wantedElsewhere = { ...owned, wanted_cards: [{ card_id: "fixture-other-3", card_name: "Other", added_at: "2026-01-01" }] }
  assert.equal(matchesSetSlotFilter(slot, wantedElsewhere, "owned"), true)
  assert.equal(matchesSetSlotFilter(slot, wantedElsewhere, "open"), false)
  assert.equal(matchesSetSlotFilter(slot, wantedElsewhere, "wanted"), true)
  assert.equal(matchesSetSlotFilter(slot, { ...owned, status: "wishlisted" }, "owned"), false)
  assert.equal(matchesSetSlotFilter(slot, { ...owned, status: "wishlisted" }, "open"), true)
  assert.equal(matchesSetSlotFilter(slot, { ...owned, status: "wishlisted" }, "wanted"), true)
  assert.equal(matchesSetSlotFilter(slot, undefined, "open"), true)
  assert.equal(matchesSetSlotFilter(slot, undefined, "wanted"), false)
})
