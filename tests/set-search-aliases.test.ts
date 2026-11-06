import { test } from "node:test"
import assert from "node:assert/strict"
import { parseCardSearchQuery } from "../lib/pokemon-card-browse"
import { searchOfflineCards, searchOfflineSets } from "../lib/offline-card-index"

test("printed set codes work with collector numbers online and against cached offline cards", () => {
  // Synthetic card used only to exercise search contracts.
  const card = { id: "me06-001", localId: "001", name: "Fixture", dexIds: [25], set: { id: "me06", name: "Delta Reign" } }
  assert.deepEqual(parseCardSearchQuery("DLR 001"), { text: "me06", number: "001", cardId: null })
  for (const query of ["DLR", "me06", "Delta Reign", "DLR 001"]) assert.deepEqual(searchOfflineCards([card], query), [card])
  assert.deepEqual(searchOfflineCards([card], "DLR 002"), [])
  assert.deepEqual(searchOfflineSets([card.set], "DLR"), [card.set])
  assert.deepEqual(searchOfflineSets([], "DLR"), [])
})
