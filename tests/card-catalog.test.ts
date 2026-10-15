import { test } from "node:test"
import assert from "node:assert/strict"
import { deduplicateCatalogCards, preserveCatalogIds, readCatalogMetadata, selectCatalogPricing } from "../lib/card-catalog"

test("catalog aliases collapse without merging different stamped printings", () => {
  const rows = [
    { id: "gallery-TG07", external_ids_json: { catalog: { canonicalId: "parent-TG07" } } },
    { id: "parent-TG07", external_ids_json: {} },
    { id: "mep-070", external_ids_json: {} },
    { id: "mep-070~685563", external_ids_json: { catalog: { productId: "685563" } } },
  ]
  assert.deepEqual(deduplicateCatalogCards(rows).map(row => row.id), ["parent-TG07", "mep-070", "mep-070~685563"])
  assert.equal(rows.length, 4)
})

test("an alias remains usable when its canonical record is outside the requested set", () => {
  const alias = { id: "gallery-TG07", external_ids_json: { catalog: { canonicalId: "parent-TG07" } } }
  assert.deepEqual(deduplicateCatalogCards([alias]), [alias])
})

test("catalog metadata rejects untrusted image hosts and invalid product identities", () => {
  assert.deepEqual(readCatalogMetadata({ catalog: { image: "https://evil.test/image.jpg", productId: -1 } }), {})
  assert.deepEqual(readCatalogMetadata(null), {})
  assert.equal(readCatalogMetadata({ catalog: { image: "https://product-images.tcgplayer.com/685563.jpg", productId: "685563", localId: "070" } }).productId, "685563")
})

test("source renames retain the catalog ID used by saved binders and remap links", () => {
  const payload = { cards: [{ id: "new-1", set_id: "set", local_id: "1" }], dexLinks: [{ card_id: "new-1", dex_id: 702 }], externalSources: [{ card_id: "new-1", source: "pokemon_tcg" }] }
  const result = preserveCatalogIds(payload, [{ id: "saved-1", set_id: "set", local_id: "1" }])
  assert.equal(result.cards[0].id, "saved-1")
  assert.equal(result.dexLinks[0].card_id, "saved-1")
  assert.equal(result.externalSources[0].card_id, "saved-1")
  assert.equal(payload.cards[0].id, "new-1")
})

test("stamped pricing uses only its exact variant and never the base card quote", () => {
  // Synthetic prices distinguish provider branches, not market observations.
  const payload = { pricing: { marker: "base" }, variants_detailed: [{ variantId: "stamp", type: "holo", thirdParty: { tcgplayer: 685563 }, pricing: { marker: "stamped" } }] }
  assert.deepEqual(selectCatalogPricing(payload, { variantId: "stamp", productId: "685563" })?.pricing, { marker: "stamped" })
  assert.equal(selectCatalogPricing(payload, { variantId: "missing", productId: "1" }), null)
  assert.deepEqual(selectCatalogPricing(payload, {})?.pricing, { marker: "base" })
})

test("alias metadata normalizes known IDs and rejects malformed families", () => {
  assert.deepEqual(readCatalogMetadata({ catalog: { aliasIds: ["old-1", "old-1", "old-2"] } }).aliasIds, ["old-1", "old-2"])
  assert.equal(readCatalogMetadata({ catalog: { aliasIds: ["old-1", 123] } }).aliasIds, undefined)
})
