import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { toCardImageSrc, toCardImageProxySrc } from "../lib/card-image-url"

const proxied = (url: string) => `/app/api/card-image-proxy?url=${encodeURIComponent(url)}`

describe("toCardImageSrc", () => {
  test("serves TCGdex and fallback-source images from the public asset domain", () => {
    for (const [url,key] of [
      ["https://assets.tcgdex.net/en/me/30th/001/high.webp","cards/en/30th/001/high.webp"],
      ["https://product-images.tcgplayer.com/162268.jpg","cards/src/tcgplayer/162268.webp"],
      ["https://images.pokemontcg.io/smp/SM168_hires.png","cards/src/pokemontcg/smp/SM168_hires.webp"],
      ["https://images.scrydex.com/pokemon/me55c-106p/large","cards/src/scrydex/me55c-106p/large.webp"],
      ["https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_001_R_EN_LG.png","cards/src/limitless/MEP/MEP_001_R_EN_LG.webp"],
    ]) {
      assert.equal(toCardImageSrc(url), "https://assets.holofolder.com/"+key)
      assert.equal(toCardImageSrc(proxied(url)), "https://assets.holofolder.com/"+key)
      assert.equal(toCardImageProxySrc(url),proxied(url))
    }
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
  assert.equal(toCardImageSrc(scan), "https://assets.holofolder.com/cards/src/playshop/pokemon-2019sm-fr-1-bulbizarre.webp")
  const other = "https://cdn.shopify.com/s/files/1/0000/0000/0001/files/logo.png"
  assert.equal(toCardImageSrc(other), other)
})

