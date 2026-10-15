import { test } from "node:test"
import assert from "node:assert/strict"
import { buildCatalogSupplement } from "../lib/card-catalog-supplement"
import { readCatalogMetadata } from "../lib/card-catalog"
import type { MirrorCardRow, MirrorSetRow } from "../lib/card-db-sync"

// Synthetic metadata fixtures with real card identities; no synthetic price evidence.
const set: MirrorSetRow = { id: "mep", series_id: "me", name_json: { en: "MEP Black Star Promos" }, name_en: "MEP Black Star Promos", official_card_count: 0, release_date: "2025-09-26", raw_json: {} }
function card(id = "mep-070", setId = "mep", number = "070", name = "Tyrunt"): MirrorCardRow {
  return { id, set_id: setId, series_id: "me", local_id: number, local_id_sort: 70, name_en: name, name_json: { en: name }, category: "Pokemon", rarity: "Promo", hp: 100, illustrator: null, types_json: [], image_languages_json: [], variants_json: { holo: true }, external_ids_json: {}, raw_json: {} }
}
const products = [685562, 685563].map((id, i) => ({ productId: id, groupId: 24451, name: `Tyrunt - 070${i ? " (Pokemon Center Exclusive)" : ""}`, extendedData: [{ name: "Number", value: "070" }, { name: "HP", value: "100" }] }))

test("supplements recover base artwork and preserve a stamped printing as a distinct stable ID", () => {
  const base = card()
  base.raw_json.variants = [
    { type: "holo", size: "standard", thirdParty: { tcgplayer: 685562 } },
    { type: "holo", size: "standard", stamp: ["pokemon-center"], variantId: "stamp-id", thirdParty: { tcgplayer: 685563 } },
  ]
  const result = buildCatalogSupplement({ cards: [base], sets: [set], products, legacySets: [], legacyCards: [], checkedImages: new Set(["685562", "685563"]) })
  assert.equal(result.cards.length, 2)
  assert.equal(readCatalogMetadata(result.cards.find(c => c.id === "mep-070")?.external_ids_json).image, "https://product-images.tcgplayer.com/685562.jpg")
  const stamped = result.cards.find(c => c.id === "mep-070~685563")!
  assert.equal(stamped.name_en, "Tyrunt (Pokémon Center)")
  assert.equal(readCatalogMetadata(stamped.external_ids_json).localId, "070")
  assert.deepEqual(result.dexLinks.find(c => c.card_id === stamped.id), { card_id: stamped.id, dex_id: 696 })
  assert.equal(base.external_ids_json.catalog, undefined)
  const again = buildCatalogSupplement({ cards: result.cards, sets: [set], products, legacySets: [], legacyCards: [], checkedImages: new Set(["685562", "685563"]) })
  assert.equal(again.cards.length, 2)
  assert.equal(again.report.added, 0)
})

test("source-only alternate promos import once without replacing owned base-card IDs", () => {
  const base = card("sm10-195", "sm10", "195", "Dedenne GX")
  const source = { id: "sm10-195a", sourceSetId: "sm10", name: "Dedenne-GX", number: "195a", supertype: "Pokémon", hp: "160", nationalPokedexNumbers: [702], images: {}, tcgplayer: { url: "https://www.tcgplayer.com/product/216699" } }
  const result = buildCatalogSupplement({ cards: [base], sets: [{ ...set, id: "sm10" }], products: [], legacySets: [], legacyCards: [source], checkedImages: new Set(["216699"]) })
  assert.ok(result.cards.some(c => c.id === "sm10-195"))
  assert.ok(result.cards.some(c => c.id === "sm10-195a"))
  assert.equal(result.report.added, 1)
  assert.equal(result.cards.find(c => c.id === "sm10-195a")?.local_id, "195a")
})

test("parent/gallery aliases collapse while identical artwork from different sets remains distinct", () => {
  const base = card("swsh9-TG07", "swsh9", "TG07", "Dedenne")
  const alias = card("swsh9tg-TG07", "swsh9tg", "TG07", "Dedenne")
  const reprint = card("other-TG07", "other", "TG07", "Dedenne")
  const result = buildCatalogSupplement({ cards: [base, alias, reprint], sets: [], products: [], legacySets: [], legacyCards: [], checkedImages: new Set() })
  assert.equal(readCatalogMetadata(result.cards.find(c => c.id === alias.id)?.external_ids_json).canonicalId, base.id)
  assert.equal(result.cards.find(c => c.id === reprint.id)?.external_ids_json.catalog, undefined)
})

test("a failed image check cannot replace artwork and bad source dex IDs are quarantined", () => {
  const source = { id: "svp-6", sourceSetId: "svp", name: "Pawmot", number: "6", supertype: "Pokémon", nationalPokedexNumbers: [922] }
  const result = buildCatalogSupplement({ cards: [], sets: [{ ...set, id: "svp" }], products: [], legacySets: [], legacyCards: [source], checkedImages: new Set() })
  assert.equal(result.cards.length, 0)
  assert.ok(result.report.unresolved.length)
})

test("a card whose only printing is stamped does not duplicate itself", () => {
  const base = card()
  base.raw_json.variants = [{ type: "holo", size: "standard", stamp: ["set-logo"], thirdParty: { tcgplayer: 685562 } }]
  const result = buildCatalogSupplement({ cards: [base], sets: [set], products, legacySets: [], legacyCards: [], checkedImages: new Set(["685562"]) })
  assert.equal(result.cards.length, 1)
  assert.equal(result.report.added, 0)
})

test("normal and holo finishes of the same stamp do not create another artwork tile", () => {
  const base = card()
  base.raw_json.variants = [
    { type: "normal", size: "standard", stamp: ["25th-celebration"], thirdParty: { tcgplayer: 685562 } },
    { type: "holo", size: "standard", stamp: ["25th-celebration"], thirdParty: { tcgplayer: 685563 } },
  ]
  const result = buildCatalogSupplement({ cards: [base], sets: [set], products, legacySets: [], legacyCards: [], checkedImages: new Set(["685562", "685563"]) })
  assert.equal(result.cards.length, 1)
})

test("Japanese promo numbers never enter English promo sets even in an English product group", () => {
  const japanese = { productId: 257103, groupId: 2545, name: "Pikachu - 227/S-P", extendedData: [{ name: "Number", value: "227/S-P" }, { name: "HP", value: "60" }] }
  const result = buildCatalogSupplement({ cards: [], sets: [{ ...set, id: "swshp" }], products: [japanese], legacySets: [], legacyCards: [], checkedImages: new Set(["257103"]) })
  assert.equal(result.cards.length, 0)
  assert.ok(result.report.unresolved.length)
})

test("a missing English set is imported from its published metadata without making up card data", () => {
  const source = { id: "fut20-1", sourceSetId: "fut20", name: "Pikachu on the Ball", number: "1", supertype: "Pokémon", hp: "60", nationalPokedexNumbers: [25] }
  const result = buildCatalogSupplement({ cards: [], sets: [], products: [], legacySets: [{ id: "fut20", name: "Pokémon Futsal", releaseDate: "2020/09/11", printedTotal: 5 }], legacyCards: [source], checkedImages: new Set() })
  assert.equal(result.cards[0]?.id, "fut20-1")
  assert.equal(result.sets[0]?.name_en, "Pokémon Futsal")
  assert.equal(result.sets[0]?.official_card_count, 5)
})

test("incorrect provider product IDs cannot replace a card's artwork or exact price identity", () => {
  const base = card("2021swsh-16", "2021swsh", "16", "Scorbunny")
  base.raw_json.variants = [{ type: "holo", thirdParty: { tcgplayer: 232341 } }]
  const wrong = { productId: 232341, groupId: 2782, name: "Litten - 15/25", extendedData: [{ name: "Number", value: "015/025" }] }
  const sameNameWrongNumber = { productId: 123, groupId: 2782, name: "Scorbunny - 15/25", extendedData: [{ name: "Number", value: "015/025" }] }
  base.raw_json.variants = [...base.raw_json.variants as object[], { thirdParty: { tcgplayer: 123 } }]
  const result = buildCatalogSupplement({ cards: [base], sets: [], products: [wrong, sameNameWrongNumber], legacySets: [], legacyCards: [], checkedImages: new Set(["232341", "123"]) })
  assert.equal(readCatalogMetadata(result.cards[0].external_ids_json).image, undefined)
  assert.ok(result.report.unresolved.some(r => r.reason.includes("Product identity")))
})

test("alternate-art product groups enrich a unique exact legacy printing across its original set", () => {
  const base = card("sm10-195a", "sm10", "195a", "Dedenne-GX")
  const product = { productId: 216699, groupId: 1938, name: "Dedenne GX - 195a/214", extendedData: [{ name: "Number", value: "195a/214" }, { name: "HP", value: "160" }] }
  const result = buildCatalogSupplement({ cards: [base], sets: [], products: [product], legacySets: [], legacyCards: [], checkedImages: new Set(["216699"]) })
  assert.equal(result.cards.length, 1)
  assert.equal(readCatalogMetadata(result.cards[0].external_ids_json).image, "https://product-images.tcgplayer.com/216699.jpg")
})

test("generic enrichment cannot give base cards bracketed Staff or unlabelled-stamp artwork", () => {
  const base = card("mep-017", "mep", "017", "Toxtricity")
  base.raw_json.variants = [{ type: "holo", stamp: ["set-logo"], thirdParty: { tcgplayer: 663193 } }]
  const products = [
    { productId: 663193, groupId: 24451, name: "Toxtricity - 017 (Prerelease)", extendedData: [{ name: "Number", value: "017" }, { name: "HP", value: "120" }] },
    { productId: 663194, groupId: 24451, name: "Toxtricity - 017 [Staff]", extendedData: [{ name: "Number", value: "017" }, { name: "HP", value: "120" }] },
  ]
  const result = buildCatalogSupplement({ cards: [base], sets: [set], products, legacySets: [], legacyCards: [], checkedImages: new Set(["663193", "663194"]) })
  assert.equal(readCatalogMetadata(result.cards.find(c => c.id === base.id)?.external_ids_json).image, undefined)
  assert.equal(result.cards.length, 1)
})

test("a retained provider ID uses its current TCGdex identity for exact variant pricing", () => {
  const base = card("tcgplayer-685562")
  base.raw_json = { id: "mep-070", variants_detailed: [{ type: "holo", thirdParty: { tcgplayer: 685562 } }, { type: "holo", stamp: ["pokemon-center"], variantId: "stamp", thirdParty: { tcgplayer: 685563 } }] }
  const result = buildCatalogSupplement({ cards: [base], sets: [set], products, legacySets: [], legacyCards: [], checkedImages: new Set(["685562", "685563"]) })
  const stamped = result.cards.find(c => c.id === "tcgplayer-685562~685563")!
  assert.equal(readCatalogMetadata(stamped.external_ids_json).tcgdexCardId, "mep-070")
  const again = buildCatalogSupplement({ cards: result.cards, sets: [set], products, legacySets: [], legacyCards: [], checkedImages: new Set(["685562", "685563"]) })
  assert.equal(again.report.added, 0)
})

test("reviewed alias families are available on either saved ID and repeat without changes", () => {
  const base = card("swsh9-TG07", "swsh9", "TG07", "Dedenne")
  const alias = card("swsh9tg-TG07", "swsh9tg", "TG07", "Dedenne")
  const input = { cards: [base, alias], sets: [], products: [], legacySets: [], legacyCards: [], checkedImages: new Set<string>() }
  const result = buildCatalogSupplement(input)
  assert.deepEqual(readCatalogMetadata(result.cards[0].external_ids_json).aliasIds, [alias.id])
  assert.deepEqual(readCatalogMetadata(result.cards[1].external_ids_json).aliasIds, [base.id])
  assert.deepEqual(buildCatalogSupplement({ ...input, cards: result.cards }).cards, result.cards)
})
