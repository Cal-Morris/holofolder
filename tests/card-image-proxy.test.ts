import test from "node:test"
import assert from "node:assert/strict"
import { isAllowedImageHost } from "../app/api/card-image-proxy/route"

test("isAllowedImageHost allows mirrored card art fallback hosts", () => {
  assert.equal(isAllowedImageHost("assets.tcgdex.net"), true)
  assert.equal(isAllowedImageHost("en.tcgdex.net"), true)
  assert.equal(isAllowedImageHost("images.pokemontcg.io"), true)
  assert.equal(isAllowedImageHost("product-images.tcgplayer.com"), true)
})

test("isAllowedImageHost rejects unrelated image hosts", () => {
  assert.equal(isAllowedImageHost("example.com"), false)
  assert.equal(isAllowedImageHost("tcgplayer.com"), false)
  assert.equal(isAllowedImageHost("product-images.tcgplayer.com.evil.test"), false)
})
