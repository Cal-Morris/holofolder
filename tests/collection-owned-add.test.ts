import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { resolveWantedCardsAfterOwnedAdd } from "../lib/collection/owned-add"
import type { WantedCard } from "../lib/domain/cards"

// Synthetic wanted entries; ids mirror TCGdex formats (a normal set, 30th Celebration, 30th Classic Collection).
const wanted = (card_id: string, extra: Partial<WantedCard> = {}): WantedCard => ({
  card_id,
  card_name: "Squirtle",
  card_language: "en",
  card_finish: "normal",
  added_at: "2026-10-21T00:00:00.000Z",
  ...extra,
})

describe("resolveWantedCardsAfterOwnedAdd", () => {
  for (const cardId of ["sv03.5-007", "30th-007", "30th-c-003"]) {
    test(`a wanted slot becomes owned with ${cardId}: the wanted list is cleared`, () => {
      const wantedCards = [wanted(cardId), wanted("base1-63")]
      assert.deepEqual(resolveWantedCardsAfterOwnedAdd({
        existing: { status: "wishlisted", wanted_cards: wantedCards },
        wantedCards,
        status: "collected",
        cardId,
        cardLanguage: "en",
        cardFinish: "normal",
      }), [])
    })
  }

  test("a slot with no row yet starts with no wanted cards", () => {
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({ existing: undefined, wantedCards: [], status: "collected", cardId: "30th-c-003" }), [])
  })

  test("a different printing on a wanted slot also fills it", () => {
    const wantedCards = [wanted("30th-007", { card_finish: "holo" })]
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({
      existing: { status: "wishlisted", wanted_cards: wantedCards },
      wantedCards,
      status: "collected",
      cardId: "30th-c-003",
    }), [])
  })

  test("an owned slot keeps upgrade targets but drops the printing just added (including aliases)", () => {
    const upgrade = wanted("30th-007", { card_finish: "holo" })
    const other = wanted("base1-63")
    const alias = wanted("30th-c-003-alias")
    const existing = { status: "collected" as const, card_id: "sv03.5-007", card_language: "en" as const, card_finish: "normal" as const, wanted_cards: [upgrade, other] }
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({ existing, wantedCards: [upgrade, other], status: "collected", cardId: "30th-007", cardFinish: "holo" }), [other])
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({ existing, wantedCards: [alias, other], status: "finalized", cardId: "30th-c-003", cardIds: ["30th-c-003-alias"], cardFinish: "normal" }), [other])
  })

  test("an owned slot keeps a wanted card in another language or finish", () => {
    const japanese = wanted("30th-007", { card_language: "ja", card_finish: "holo" })
    const reverse = wanted("30th-007", { card_finish: "reverse_holo" })
    const existing = { status: "collected" as const, card_id: "sv03.5-007", wanted_cards: [japanese, reverse] }
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({ existing, wantedCards: [japanese, reverse], status: "collected", cardId: "30th-007", cardLanguage: "en", cardFinish: "holo" }), [japanese, reverse])
  })

  test("writes that keep the owned printing never touch the wanted list", () => {
    // e.g. wanting another finish of the card you own, or removing a wanted card from an owned slot
    const holo = wanted("30th-007", { card_finish: "holo" })
    const existing = { status: "collected" as const, card_id: "30th-007", card_language: "en" as const, card_finish: "holo" as const, wanted_cards: [] }
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({ existing, wantedCards: [holo], status: "collected", cardId: "30th-007", cardLanguage: "en", cardFinish: "holo" }), [holo])
  })

  test("wanted-mode writes and marking owned without a card leave the wanted list alone", () => {
    const wantedCards = [wanted("30th-007")]
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({ existing: { status: "wishlisted", wanted_cards: wantedCards }, wantedCards, status: "wishlisted", cardId: undefined }), wantedCards)
    assert.deepEqual(resolveWantedCardsAfterOwnedAdd({ existing: { status: "wishlisted", wanted_cards: wantedCards }, wantedCards, status: "collected", cardId: undefined }), wantedCards)
  })
})
