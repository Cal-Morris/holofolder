import { test } from "node:test"
import assert from "node:assert/strict"
import { fixture } from "./fixtures/inventory-read-server"
import { readInventoryCatalog } from "@/lib/server/inventory-read-catalog"

// Synthetic ownership, actual mirror coordinates and image metadata only.
test("native catalog projects attested printing images just like legacy mirror reads", async () => {
  const f = fixture(0)
  const { inventoryBrowseFixture } = await import("./fixtures/inventory-browse")
  const snapshot = inventoryBrowseFixture(1)
  f.tables.tcg_cards = [{ id: "base1-4", series_id: "base", set_id: "base1", local_id: "4", name_en: "Charizard",
    name_json: { en: "Charizard", ja: "リザードン" }, image_languages_json: ["en", "ja"], external_ids_json: {} }]
  f.tables.tcg_sets = [{ id: "base1", name_en: "Base Set" }]
  const read = () => readInventoryCatalog(f.client, snapshot, new AbortController().signal, () => {})
  let cards = await read()
  assert.equal(cards[0].card.image, "https://assets.tcgdex.net/en/base/base1/4/high.webp")
  assert.equal(cards[1].card.image, "https://assets.tcgdex.net/ja/base/base1/4/high.webp")
  f.tables.tcg_cards[0].external_ids_json = { catalog: { image: "https://images.pokemontcg.io/base1/4.png" } }
  cards = await read()
  assert.equal(cards[0].card.image, "https://images.pokemontcg.io/base1/4.png")
  f.tables.tcg_cards[0].external_ids_json = {}
  f.tables.tcg_cards[0].image_languages_json = []
  assert.equal((await read())[0].card.image, undefined)
})
