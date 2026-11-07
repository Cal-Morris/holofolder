import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { getQuickCardState } from "../lib/quick-card-state"
import type { CollectedPokemon } from "../lib/domain/cards"
import type { SearchCardResult } from "../lib/pokemon-card-browse"

const card: SearchCardResult = { id: "sv-1", dexIds: [1], aliasIds: ["alias-1"], name: "Bulbasaur", localId: "1", language: "en", set: { id: "sv", name: "Synthetic set" } }
const row: CollectedPokemon = { id: "row", pokemon_id: 1, pokemon_name: "bulbasaur", card_id: "alias-1", card_name: "Old Bulbasaur", card_language: "en", card_finish: "holo", status: "collected", wanted_cards: [], collected_at: "2026-01-01" }
const lookup = { binders: [{ id: "a", name: "Main" }, { id: "b", name: "Trades" }], collections: new Map([["a", []], ["b", [row]]]), loadedBinderIds: ["a", "b"] }

describe("deal checker acquisition state", () => {
  test("matches aliases but keeps language and finish distinct", () => {
    assert.equal(getQuickCardState(card, row, "holo").owned, true)
    assert.equal(getQuickCardState(card, row, "normal").owned, false)
    assert.equal(getQuickCardState({ ...card, language: "ja" }, row, "holo").owned, false)
    assert.equal(getQuickCardState(card, { ...row, status: "finalized" }, "holo").owned, true)
    assert.equal(getQuickCardState(card, { ...row, status: "wishlisted" }, "holo").owned, false)
  })
  test("reports exact copies in other binders and the destination printing being replaced", () => {
    const state = getQuickCardState(card, { ...row, card_id: "other" }, "holo", lookup, "a")
    assert.deepEqual(state.ownedElsewhere, ["Trades"])
    assert.equal(state.replacing, "Old Bulbasaur")
    assert.deepEqual(getQuickCardState(card, null, "normal", lookup, "a").ownedElsewhere, [])
  })
  test("wants match the selected printing rather than just the card id", () => {
    const wanted = { card_id: "sv-1", card_name: "Bulbasaur", card_language: "ja" as const, card_finish: "holo" as const, added_at: "2026-01-01" }
    assert.equal(getQuickCardState(card, { ...row, wanted_cards: [wanted] }, "holo").wanted, false)
    assert.equal(getQuickCardState({ ...card, language: "ja" }, { ...row, wanted_cards: [wanted] }, "holo").wanted, true)
    assert.equal(getQuickCardState({ ...card, language: "ja" }, { ...row, wanted_cards: [wanted] }, "normal").wanted, false)
  })
  test("an absent or partial lookup never claims a complete duplicate check", () => {
    assert.equal(getQuickCardState(card, null, "normal").otherBindersIncomplete, true)
    assert.equal(getQuickCardState(card, null, "normal", { ...lookup, loadedBinderIds: ["a"] }, "a").otherBindersIncomplete, true)
    assert.equal(getQuickCardState(card, null, "normal", lookup, "a").otherBindersIncomplete, false)
  })
})
