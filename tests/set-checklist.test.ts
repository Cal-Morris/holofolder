import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { getSetSlotState, getSetCardState, hasWantedSetCard, getSetChecklistCards, mergeSetSlots, matchesSetSlotFilter } from "../lib/set-checklist"
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
  assert.equal(matchesSetSlotFilter(slot, wantedElsewhere, "wanted"), false, "an owned species is not Wanted")
  assert.equal(matchesSetSlotFilter(slot, { ...owned, status: "wishlisted" }, "owned"), false)
  assert.equal(matchesSetSlotFilter(slot, { ...owned, status: "wishlisted" }, "open"), true)
  assert.equal(matchesSetSlotFilter(slot, { ...owned, status: "wishlisted" }, "wanted"), true)
  assert.equal(matchesSetSlotFilter(slot, undefined, "open"), true)
  assert.equal(matchesSetSlotFilter(slot, undefined, "wanted"), false)
})

test("reviewed parent/gallery aliases merge without losing saved alias state or physical printings", () => {
  const canonical = { ...card, aliasIds: ["fixture-gallery-1"] }
  const alias = { ...card, id: "fixture-gallery-1", canonicalId: card.id, aliasIds: [card.id], set: { id: "fixture-gallery", name: "Gallery" } }
  const stamp = { ...card, id: `${card.id}~123`, name: "Fixture (Pokémon Center)" }
  const reprint = { ...card, id: "other-set-1" }
  const saved = { ...owned, card_id: alias.id, wanted_cards: [{ card_id: alias.id, card_name: "Fixture", added_at: "2026-01-01" }] }
  const merged = mergeSetSlots([[{ ...slot, cards: [alias] }], [{ ...slot, cards: [canonical, stamp, reprint] }]])[0]
  assert.deepEqual(merged.cards.map(c => c.id), [card.id, stamp.id, reprint.id])
  assert.deepEqual(getSetSlotState(merged, saved), { ownedInSet: true, ownedElsewhere: false, wantedInSet: true })
  assert.deepEqual(getSetCardState(merged.cards[0], [saved]), { owned: true, wanted: true })
  assert.deepEqual(getSetCardState(stamp, [saved]), { owned: false, wanted: false })
  assert.deepEqual(getSetChecklistCards({ sets: [], selectedSet: null, slots: [], cards: [alias, canonical, stamp, reprint] }).map(c => c.id), [card.id, stamp.id, reprint.id])
  assert.equal(saved.card_id, alias.id)
  assert.equal(saved.wanted_cards[0].card_id, alias.id)
  assert.deepEqual(getSetCardState(canonical, [saved]), { owned: true, wanted: true })
})


test("duplicate alias wants match language and finish, not just artwork", () => {
  const canonical = { ...card, aliasIds: ["old-1"] }
  const saved = { ...owned, wanted_cards: [{ card_id: "old-1", card_name: "Fixture", added_at: "2026-01-01", card_language: "fr" as const, card_finish: "holo" as const }] }
  assert.equal(hasWantedSetCard(canonical, saved), false)
  assert.equal(hasWantedSetCard({ ...canonical, language: "fr", inferredFinish: "holo" }, saved), true)
  assert.equal(hasWantedSetCard({ ...canonical, language: "fr", inferredFinish: "normal" }, saved), false)
})
