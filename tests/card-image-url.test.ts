import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { toCardImageSrc } from "../lib/card-image-url"

const proxied = (url: string) => `/app/api/card-image-proxy?url=${encodeURIComponent(url)}`

describe("toCardImageSrc", () => {
  test("serves TCGdex and fallback-source card images through the image store proxy", () => {
    for (const url of [
      "https://assets.tcgdex.net/en/me/30th/001/high.webp",
      "https://product-images.tcgplayer.com/162268.jpg",
      "https://images.pokemontcg.io/smp/SM168_hires.png",
      "https://images.scrydex.com/pokemon/me55c-106p/large",
      "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_001_R_EN_LG.png",
    ]) assert.equal(toCardImageSrc(url), proxied(url))
  })

  test("keeps same-origin, data, blob and other-host images unchanged", () => {
    assert.equal(toCardImageSrc(" /app/api/card-image-proxy?url=x "), "/app/api/card-image-proxy?url=x")
    assert.equal(toCardImageSrc("data:image/png;base64,AA"), "data:image/png;base64,AA")
    assert.equal(toCardImageSrc("blob:https://holofolder.com/1"), "blob:https://holofolder.com/1")
    assert.equal(toCardImageSrc("https://example.com/card.png"), "https://example.com/card.png")
  })

  test("drops empty and unusable values", () => {
    for (const value of [null, undefined, "", "  ", "null", "undefined", "javascript:alert(1)", "not a url", 42]) assert.equal(toCardImageSrc(value), null)
  })
})

test("only proxies the playshop.fr path on the shared Shopify CDN", () => {
  const scan = "https://cdn.shopify.com/s/files/1/1015/7057/6719/files/pokemon-2019sm-fr-1-bulbizarre.png"
  assert.equal(toCardImageSrc(scan), `/app/api/card-image-proxy?url=${encodeURIComponent(scan)}`)
  const other = "https://cdn.shopify.com/s/files/1/0000/0000/0001/files/logo.png"
  assert.equal(toCardImageSrc(other), other)
})

