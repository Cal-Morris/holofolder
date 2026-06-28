import test from "node:test"
import assert from "node:assert/strict"
import { buildJumboVariantSupplementRows } from "../lib/card-db-sync"

test("buildJumboVariantSupplementRows creates cards in the Jumbo cards set from jumbo variants", () => {
  const result = buildJumboVariantSupplementRows([
    {
      id: "sv02-062",
      series_id: "sv",
      set_id: "sv02",
      local_id: "062",
      local_id_sort: 62,
      name_json: { en: "Pikachu" },
      name_en: "Pikachu",
      category: "Pokemon",
      rarity: "Common",
      hp: 70,
      illustrator: "Test Artist",
      types_json: ["Lightning"],
      image_languages_json: ["en"],
      variants_json: { normal: true, reverse: true, jumbo: true },
      external_ids_json: { tcgdex: { image: "https://assets.tcgdex.net/en/sv/sv02/062/high.webp" } },
      raw_json: {
        variants: [
          { type: "normal" },
          { type: "normal", size: "jumbo", stamp: ["rain-city"], thirdParty: { cardmarket: 793388 } },
        ],
      },
    },
  ], [{ card_id: "sv02-062", dex_id: 25 }])

  assert.equal(result.cards.length, 1)
  assert.deepEqual(result.series.id, "misc")
  assert.deepEqual(result.set.id, "jumbo")
  assert.equal(result.cards[0].id, "jumbo-sv02-062")
  assert.equal(result.cards[0].set_id, "jumbo")
  assert.equal(result.cards[0].name_en, "Pikachu Jumbo")
  assert.deepEqual(result.cards[0].variants_json, { jumbo: true })
  assert.deepEqual(result.dexLinks, [{ card_id: "jumbo-sv02-062", dex_id: 25 }])
  assert.equal(result.cards[0].raw_json.sourceCardId, "sv02-062")
})
