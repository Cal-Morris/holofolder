import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { resolveCardSearchQuery } from "../lib/card-search-query"
import { searchOfflineCards } from "../lib/offline-card-index"

// Synthetic cards using catalog set identifiers/names, never pricing evidence.
const sets = [
  { id: "sv03.5", name: "151" },
  { id: "base1", name: "Base Set" },
  { id: "me06", name: "Delta Reign" },
]
const cards = [
  { id: "sv03.5-063", name: "Abra", localId: "063", set: sets[0], dexIds: [63] },
  { id: "sv03.5-064", name: "Kadabra", localId: "064", set: sets[0], dexIds: [64] },
  { id: "base1-43", name: "Abra", localId: "43", set: sets[1], dexIds: [63] },
  { id: "base1-151", name: "Abra", localId: "151", set: sets[1], dexIds: [63] },
  { id: "base1-44", name: "Bulbasaur", localId: "44", set: sets[1], dexIds: [1] },
  { id: "me06-063", name: "Abra", localId: "063", set: sets[2], dexIds: [63] },
]
const ids = (query: string) => searchOfflineCards(cards, query).map(card => card.id)

describe("catalog-backed compound card search", () => {
  test("151 is a known set, with card name matching as a separate AND constraint", () => {
    for (const query of ["abra 151", "151 abra", "Abra sv03.5"]) {
      assert.deepEqual(resolveCardSearchQuery(query, sets), { text: "abra", number: null, cardId: null, setIds: ["sv03.5"] })
      assert.deepEqual(ids(query), ["sv03.5-063", "sv03.5-064"])
    }
    assert.deepEqual(ids("pikachu 151"), [])
  })
  test("multiword catalog names and the existing verified DLR alias work", () => {
    assert.deepEqual(ids("abra base set"), ["base1-43", "base1-151"])
    assert.deepEqual(ids("base set abra"), ["base1-43", "base1-151"])
    assert.deepEqual(ids("abra delta reign"), ["me06-063"])
    assert.deepEqual(ids("abra DLR"), ["me06-063"])
    assert.deepEqual(ids("DLR 63"), ["me06-063"])
  })
  test("explicit collector numbers and card ids retain their meaning", () => {
    assert.deepEqual(ids("abra #151"), ["base1-151"])
    assert.deepEqual(ids("bulbasaur 44/102"), ["base1-44"])
    assert.deepEqual(ids("44/102 bulbasaur"), ["base1-44"])
    assert.deepEqual(ids("abra 151 #063"), ["sv03.5-063"])
    assert.deepEqual(ids("abra 151 063/165"), ["sv03.5-063"])
    assert.deepEqual(ids("sv03.5-063"), ["sv03.5-063"])
    assert.equal(resolveCardSearchQuery("mep-070~685563", sets).cardId, "mep-070~685563")
  })
  test("unknown bare numbers remain collector numbers, no catalog data is invented", () => {
    assert.deepEqual(ids("abra 43"), ["base1-43"])
    assert.deepEqual(resolveCardSearchQuery("abra 151", []), { text: "abra", number: "151", cardId: null, setIds: [] })
    assert.deepEqual(ids("abra made up set"), [])
  })
})
