import test from "node:test"
import assert from "node:assert/strict"
import { isAllowedImageHost, isAllowedImageUrl, parseProxyImageWidth } from "../app/api/card-image-proxy/route"
import { getOfficialArtworkSourceUrl, getOfficialArtworkUrl } from "../lib/pokemon-artwork"

test("isAllowedImageHost allows mirrored card art fallback hosts", () => {
  assert.equal(isAllowedImageHost("assets.tcgdex.net"), true)
  assert.equal(isAllowedImageHost("en.tcgdex.net"), true)
  assert.equal(isAllowedImageHost("images.pokemontcg.io"), true)
  assert.equal(isAllowedImageHost("product-images.tcgplayer.com"), true)
  assert.equal(isAllowedImageHost("images.scrydex.com"), true)
  assert.equal(isAllowedImageHost("limitlesstcg.nyc3.cdn.digitaloceanspaces.com"), true)
})

test("isAllowedImageHost rejects unrelated image hosts", () => {
  assert.equal(isAllowedImageHost("example.com"), false)
  assert.equal(isAllowedImageHost("tcgplayer.com"), false)
  assert.equal(isAllowedImageHost("product-images.tcgplayer.com.evil.test"), false)
})

test("isAllowedImageUrl allows PokeAPI artwork on GitHub but nothing else there", () => {
  assert.equal(isAllowedImageUrl(new URL(getOfficialArtworkSourceUrl(25))), true)
  assert.equal(isAllowedImageUrl(new URL("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png")), true)
  assert.equal(isAllowedImageUrl(new URL("https://raw.githubusercontent.com/someone/else/main/evil.png")), false)
  assert.equal(isAllowedImageUrl(new URL("https://raw.githubusercontent.com/PokeAPI/sprites/master/README.md")), false)
  assert.equal(isAllowedImageUrl(new URL("http://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png")), false)
  assert.equal(isAllowedImageUrl(new URL("https://assets.tcgdex.net/en/base/base1/44/low.webp")), true)
  assert.equal(isAllowedImageUrl(new URL("ftp://assets.tcgdex.net/x.png")), false)
})

test("parseProxyImageWidth only accepts the fixed widths", () => {
  assert.equal(parseProxyImageWidth(null), null)
  assert.equal(parseProxyImageWidth("240"), 240)
  assert.equal(parseProxyImageWidth("241"), null)
  assert.equal(parseProxyImageWidth("abc"), null)
})

test("getOfficialArtworkUrl points at the proxy with a grid width by default", () => {
  const url = new URL(getOfficialArtworkUrl(25), "https://binder.cal.gg")
  assert.equal(url.pathname, "/api/card-image-proxy")
  assert.equal(url.searchParams.get("url"), getOfficialArtworkSourceUrl(25))
  assert.equal(url.searchParams.get("w"), "240")
  assert.equal(new URL(getOfficialArtworkUrl(25, 480), "https://x").searchParams.get("w"), "480")
})

test("isAllowedImageUrl allows only the playshop.fr store path on the shared Shopify CDN", () => {
  assert.equal(isAllowedImageUrl(new URL("https://cdn.shopify.com/s/files/1/1015/7057/6719/files/pokemon-2013bw-1-phyllali.png")), true)
  assert.equal(isAllowedImageUrl(new URL("https://cdn.shopify.com/s/files/1/0000/0000/0001/files/logo.png")), false)
})

