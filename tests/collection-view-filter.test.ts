import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { displaySlotFilterFacts, legacyItemFilterFacts, matchesCollectionViewFilter, type CollectionViewFilter } from "@/lib/collection-view-filter"

// Synthetic pockets, not real collection data.
const want = { card_id: "base1-15" }
const pockets = {
  owned: displaySlotFilterFacts({ item: { id: "copy-1" }, target: { kind: "pokemon", pokemonId: 6 }, wantedCards: [] }, "collected"),
  ownedUpgrade: displaySlotFilterFacts({ item: { id: "copy-2" }, target: { kind: "pokemon", pokemonId: 9 }, wantedCards: [want] }, "collected"),
  perfect: displaySlotFilterFacts({ item: { id: "copy-3" }, target: null, wantedCards: [] }, "finalized"),
  wanted: displaySlotFilterFacts({ item: null, target: { kind: "pokemon", pokemonId: 3 }, wantedCards: [want] }, "wishlisted"),
  missing: displaySlotFilterFacts({ item: null, target: { kind: "pokemon", pokemonId: 1 }, wantedCards: [] }, null),
  spacer: displaySlotFilterFacts({ item: null, target: null, wantedCards: [] }, null),
}
const shown = (filter: CollectionViewFilter) => Object.entries(pockets).filter(([, facts]) => matchesCollectionViewFilter(facts, filter)).map(([name]) => name)

describe("native pocket filters", () => {
  test("All shows every pocket", () => assert.deepEqual(shown("all"), Object.keys(pockets)))
  test("Owned shows every pocket holding a copy, whatever its status", () => assert.deepEqual(shown("owned"), ["owned", "ownedUpgrade", "perfect"]))
  test("Wanted shows pockets with a want, owned or not", () => assert.deepEqual(shown("wanted"), ["ownedUpgrade", "wanted"]))
  test("Missing shows targets with nothing owned, never spacers", () => assert.deepEqual(shown("needed"), ["wanted", "missing"]))
  test("Upgrades and Perfect split owned pockets", () => {
    assert.deepEqual(shown("upgradeable"), ["owned", "ownedUpgrade"])
    assert.deepEqual(shown("favorite"), ["perfect"])
  })
})

describe("legacy row filters", () => {
  test("a wishlisted row is wanted and missing, not owned", () => {
    const facts = legacyItemFilterFacts({ status: "wishlisted", wanted_cards: [want] })
    assert.equal(matchesCollectionViewFilter(facts, "owned"), false)
    assert.equal(matchesCollectionViewFilter(facts, "wanted"), true)
    assert.equal(matchesCollectionViewFilter(facts, "needed"), true)
  })
  test("no row is missing only", () => {
    const facts = legacyItemFilterFacts(undefined)
    assert.deepEqual((["owned", "wanted", "needed", "favorite"] as const).map(f => matchesCollectionViewFilter(facts, f)), [false, false, true, false])
  })
  test("a finalized row is owned and perfect", () => {
    const facts = legacyItemFilterFacts({ status: "finalized", wanted_cards: [] })
    assert.deepEqual((["owned", "upgradeable", "favorite"] as const).map(f => matchesCollectionViewFilter(facts, f)), [true, false, true])
  })
})
