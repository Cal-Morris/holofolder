import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { editWantedCards } from "../lib/collection/wanted-card-edit"
import type { WantedCard } from "../lib/domain/cards"

const original: WantedCard = { card_id: "synthetic-1", card_name: "Synthetic card", card_language: "en", card_finish: "holo", added_at: "2026-01-01", wanted_by: ["owner"] }
const normal: WantedCard = { ...original, card_finish: "normal" }
const japanese: WantedCard = { ...original, card_language: "ja" }

describe("editing one wanted printing", () => {
  test("removing a printing keeps other finishes and languages", () => {
    assert.deepEqual(editWantedCards([normal, original, japanese], original, null), [normal, japanese])
  })
  test("replacement keeps its position and assignment without touching siblings", () => {
    const replacement = { ...normal, card_id: "synthetic-2", wanted_by: undefined }
    assert.deepEqual(editWantedCards([normal, original, japanese], original, replacement), [normal, { ...replacement, wanted_by: ["owner"], added_at: original.added_at }, japanese])
  })
  test("replacing with an existing wanted printing does not duplicate or reassign it", () => {
    assert.deepEqual(editWantedCards([normal, original, japanese], original, japanese), [normal, japanese])
  })
  test("a stale edit cannot add or replace another wanted card", () => {
    assert.deepEqual(editWantedCards([normal], original, japanese), [normal])
  })
})
