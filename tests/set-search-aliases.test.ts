import { test } from "node:test"
import assert from "node:assert/strict"
import { parseCardSearchQuery } from "../lib/pokemon-card-browse"
import { resolveCardSearchQuery } from "../lib/card-search-query"
import { searchOfflineCards, searchOfflineSets } from "../lib/offline-card-index"
import { rankSetMatches } from "../lib/set-search"
import { resolveSetSearchAlias } from "../lib/set-search-aliases"

test("printed set codes work with collector numbers online and against cached offline cards", () => {
  // Synthetic card used only to exercise search contracts.
  const card = { id: "me06-001", localId: "001", name: "Fixture", dexIds: [25], set: { id: "me06", name: "Delta Reign" } }
  assert.deepEqual(resolveCardSearchQuery("DLR 001", [card.set]), { text: "", number: "001", cardId: null, setIds: ["me06"] })
  for (const query of ["DLR", "me06", "Delta Reign", "DLR 001"]) assert.deepEqual(searchOfflineCards([card], query), [card])
  assert.deepEqual(searchOfflineCards([card], "DLR 002"), [])
  assert.deepEqual(searchOfflineSets([card.set], "DLR"), [card.set])
  assert.deepEqual(searchOfflineSets([], "DLR"), [])
})

// Synthetic cards on real catalog set ids (151 is sv03.5); not real collection or price data.
const set151 = { id: "sv03.5", name: "151" }
const bulbasaur = { id: "sv03.5-001", localId: "001", name: "Bulbasaur", dexIds: [1], set: set151 }
const mew151 = { id: "sv03.5-151", localId: "151", name: "Mew ex", dexIds: [151], set: set151 }
const otherMew = { id: "fx1-8", localId: "8", name: "Mew", dexIds: [151], set: { id: "fx1", name: "Fixture" } }
const cards = [bulbasaur, mew151, otherMew]

test("MEW resolves to 151 (sv03.5), with or without a collector number", () => {
  assert.equal(resolveSetSearchAlias(" MEW "), "sv03.5")
  for (const query of ["MEW 1", "MEW 001", "mew 001", "001 MEW"]) {
    assert.deepEqual(resolveCardSearchQuery(query, [set151]).setIds, ["sv03.5"], query)
    assert.deepEqual(searchOfflineCards(cards, query), [bulbasaur], query)
  }
  assert.deepEqual(searchOfflineCards(cards, "bulbasaur MEW"), [bulbasaur])
})

test("a code that is also a Pokémon name finds both, never hiding either", () => {
  assert.equal(parseCardSearchQuery("mew").text, "mew")
  assert.deepEqual(searchOfflineCards(cards, "MEW").map(card => card.id).sort(), ["fx1-8", "sv03.5-001", "sv03.5-151"])
  assert.deepEqual(searchOfflineSets([set151], "MEW"), [set151])
  assert.deepEqual(rankSetMatches([set151], "MEW"), [set151])
})

test("set search keeps name prefixes when the typed text is also a code", () => {
  const sets = [{ id: "sv02", name: "Paldea Evolved" }, { id: "sv04.5", name: "Paldean Fates" }]
  assert.deepEqual(rankSetMatches(sets, "PAL", 5).map(set => set.id), ["sv02", "sv04.5"])
  assert.deepEqual(searchOfflineSets(sets, "pal").map(set => set.id), ["sv02", "sv04.5"])
})
