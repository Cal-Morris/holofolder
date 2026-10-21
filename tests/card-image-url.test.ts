import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { toCardImageSrc } from "../lib/card-image-url"

const proxied = (url: string) => `/api/card-image-proxy?url=${encodeURIComponent(url)}`

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
    assert.equal(toCardImageSrc(" /api/card-image-proxy?url=x "), "/api/card-image-proxy?url=x")
    assert.equal(toCardImageSrc("data:image/png;base64,AA"), "data:image/png;base64,AA")
    assert.equal(toCardImageSrc("blob:https://binder.cal.gg/1"), "blob:https://binder.cal.gg/1")
    assert.equal(toCardImageSrc("https://example.com/card.png"), "https://example.com/card.png")
  })

  test("drops empty and unusable values", () => {
    for (const value of [null, undefined, "", "  ", "null", "undefined", "javascript:alert(1)", "not a url", 42]) assert.equal(toCardImageSrc(value), null)
  })
})
