import { test } from "node:test"
import assert from "node:assert/strict"
import { getPokemonOfficialArtworkUrl, resolveSlotImageUrl } from "../components/binder/pokemon-slot"
import { toCardImageSrc } from "../lib/card-image-url"

test("binder slots retain the original scan URL for responsive resizing", () => {
  const image = "https://assets.tcgdex.net/en/base/base1/44/high.webp"
  assert.equal(resolveSlotImageUrl(1, image), toCardImageSrc(image))
  assert.equal(toCardImageSrc(image), `/app/api/card-image-proxy?url=${encodeURIComponent(image)}`)
})

test("binder slots preserve other providers and local images, and use artwork for missing images", () => {
  for (const image of ["https://images.pokemontcg.io/base1/44_hires.png", "/app/api/card-image-proxy?url=x", "data:image/png;base64,AA", "blob:https://holofolder.com/1"]) {
    assert.equal(resolveSlotImageUrl(1, image), toCardImageSrc(image))
  }
  for (const image of [undefined, null, "", "null", "undefined", "javascript:alert(1)"]) {
    assert.equal(resolveSlotImageUrl(1, image), getPokemonOfficialArtworkUrl(1))
  }
})
