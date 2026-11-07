import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { parseRevisitCards, revisitAskingInput, saveRevisitCard, revisitKey, revisitStorageKey } from "../lib/show-revisit"
import { toRecentCard } from "../lib/recent-cards"

const card = toRecentCard({ id: "synthetic-1", name: "Synthetic card", localId: "1", dexIds: [1], language: "en", set: { id: "synthetic", name: "Synthetic set" } }, { id: 1, name: "bulbasaur" }, "2026-11-07", "normal")
const entry = { card, askingPrice: 12.5, currency: "GBP" as const, note: "Table 14, corner whitening", savedAt: "2026-11-07" }

describe("show revisit list", () => {
  test("keeps variants and languages separate, updates the same printing", () => {
    const holo = { ...entry, card: { ...card, finish: "holo" as const } }
    let list = saveRevisitCard([], entry)
    list = saveRevisitCard(list, holo)
    list = saveRevisitCard(list, { ...entry, note: "Table 15" })
    assert.equal(list.length, 2)
    assert.equal(list[0].note, "Table 15")
    assert.notEqual(revisitKey(card), revisitKey(holo.card))
    assert.notEqual(revisitKey(card), revisitKey({ ...card, language: "ja" }))
  })
  test("parses saved metadata for offline reopening and rejects invalid entries", () => {
    assert.deepEqual(parseRevisitCards(JSON.stringify([entry])), [entry])
    for (const value of [null, "oops", "{}", JSON.stringify([{ ...entry, currency: "fake" }]), JSON.stringify([{ ...entry, askingPrice: -2 }]), JSON.stringify([{ ...entry, askingPrice: "12" }]), JSON.stringify([{ ...entry, card: { id: 1 } }])]) assert.deepEqual(parseRevisitCards(value), [])
    assert.equal(parseRevisitCards(JSON.stringify([{ ...entry, askingPrice: null }])).length, 1)
  })
  test("scopes private notes to both the viewer and collection owner", () => {
    assert.notEqual(revisitStorageKey("a", "owner"), revisitStorageKey("b", "owner"))
    assert.notEqual(revisitStorageKey("a", "owner"), revisitStorageKey("a", "other"))
    assert.equal(revisitStorageKey(null, "owner"), null)
  })
  test("restores an untouched offer when its currency becomes available, without replacing edits", () => {
    assert.equal(revisitAskingInput(entry, "USD", null), "")
    assert.equal(revisitAskingInput(entry, "GBP", null), "12.5")
    assert.equal(revisitAskingInput(entry, "GBP", "9"), "9")
    assert.equal(revisitAskingInput(entry, "GBP", ""), "")
  })

})
