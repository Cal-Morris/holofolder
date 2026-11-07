import test from "node:test"
import assert from "node:assert/strict"
import { buildCollectionCsv, collectionCsvFilename, toCsvField } from "../lib/collection-export"
import type { CollectedPokemon } from "../lib/domain/cards"
import { getCardPriceKey } from "../lib/card-pricing"

const NOW = Date.parse("2026-10-22T12:00:00Z")

test("toCsvField quotes commas and quotes and neutralises formulas", () => {
  assert.equal(toCsvField("Pikachu"), "Pikachu")
  assert.equal(toCsvField('Farfetch\'d, "V"'), '"Farfetch\'d, ""V"""')
  assert.equal(toCsvField("=HYPERLINK(1)"), "'=HYPERLINK(1)")
  assert.equal(toCsvField(-4), "-4")
  assert.equal(toCsvField(null), "")
})

test("buildCollectionCsv lists owned, wanted and card-less owned slots by dex number", () => {
  const collection: CollectedPokemon[] = [
    {
      id: "a", pokemon_id: 25, pokemon_name: "Pikachu", status: "collected", collected_at: "2026-01-02T10:00:00Z",
      card_id: "base1-58", card_name: "Pikachu", card_set: "Base Set", card_language: "en", card_finish: "normal",
      wanted_cards: [{ card_id: "sv03.5-025", card_name: "Pikachu", card_set: "151", card_language: "ja", card_finish: "holo", added_at: "2026-03-04T00:00:00Z" }],
    },
    { id: "b", pokemon_id: 1, pokemon_name: "Bulbasaur", status: "considering", collected_at: "2026-02-01T00:00:00Z", wanted_cards: [] },
  ]
  const prices = {
    [getCardPriceKey("base1-58", "en")]: { source: "cardmarket", confidence: "high", marketGbpAmount: 12.5, updatedAt: "2026-10-20T00:00:00Z", variantLabel: "Normal" },
  } as never
  const lines = buildCollectionCsv(collection, prices, NOW).trimEnd().split("\r\n")
  assert.equal(lines[0], "dex_number,pokemon,list,slot_status,card_id,card_name,set,language,finish,market_gbp,price_source,price_basis,added")
  assert.equal(lines.length, 4)
  assert.equal(lines[1], "1,Bulbasaur,owned,considering,,,,,,,,,2026-02-01")
  assert.equal(lines[2], "25,Pikachu,owned,collected,base1-58,Pikachu,Base Set,en,normal,12.50,cardmarket,exact_finish,2026-01-02")
  assert.equal(lines[3], "25,Pikachu,wanted,collected,sv03.5-025,Pikachu,151,ja,holo,,,,2026-03-04")
})

test("collectionCsvFilename is dated", () => {
  assert.equal(collectionCsvFilename(new Date(NOW)), "holofolder-collection-2026-10-22.csv")
})


test("CSV labels generic quotes as finish estimates", () => {
  // Synthetic catalogue quote with an unverified finish.
  const collection: CollectedPokemon[] = [{ id: "fixture", pokemon_id: 1, pokemon_name: "Fixture", status: "collected", collected_at: "2026-10-20", card_id: "fixture", card_name: "Fixture", card_finish: "normal", wanted_cards: [] }]
  const prices = { "fixture::en": { source: "tcgplayer", marketGbpAmount: 5, updatedAt: "2026-10-20T00:00:00Z", variantLabel: null } } as never
  assert.match(buildCollectionCsv(collection, prices, NOW), /5.00,tcgplayer,finish_estimate/)
})
