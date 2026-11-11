import { test } from "node:test"
import assert from "node:assert/strict"
import { parseProxyImageWidth } from "../app/api/card-image-proxy/route"
import { cardImageLoader, getCardImageAttributes } from "../lib/card-image-loader"

const source = "https://assets.tcgdex.net/en/base/base1/44/low.webp"
const image = `/app/api/card-image-proxy?url=${encodeURIComponent(source)}`

test("the loader resizes through the existing proxy and preserves its source", () => {
  for (const [requested, expected] of [[80, 96], [160, 160], [200, 240], [300, 320], [480, 480]]) {
    const url = new URL(cardImageLoader({ src: image, width: requested }), "https://holofolder.com")
    assert.equal(url.pathname, "/app/api/card-image-proxy")
    assert.equal(url.searchParams.get("url"), source)
    assert.equal(url.searchParams.get("w"), String(expected))
  }
  assert.equal(cardImageLoader({ src: `${image}&w=240`, width: 600 }), `${image}&w=600`)
})

test("local, data, blob and unrelated URLs bypass resizing", () => {
  for (const src of ["/app/logo.png", "data:image/png;base64,AA", "blob:https://holofolder.com/1", "https://example.com/card.webp"]) {
    assert.equal(cardImageLoader({ src, width: 160 }), src)
    const attrs = getCardImageAttributes(src, "80px")
    assert.equal(attrs.src, src)
    assert.equal(attrs.srcSet, undefined)
  }
})

test("prefetch attributes use the same Next Image loader, sizes and safe proxy widths", () => {
  const attrs = getCardImageAttributes(image, "80px")
  assert.equal(attrs.sizes, "80px")
  assert.ok(attrs.srcSet)
  for (const candidate of attrs.srcSet.split(", ")) {
    const url = new URL(candidate.split(" ")[0], "https://holofolder.com")
    assert.equal(url.pathname, "/app/api/card-image-proxy")
    assert.equal(url.searchParams.get("url"), source)
    assert.notEqual(parseProxyImageWidth(url.searchParams.get("w")), null)
  }
  assert.ok(!attrs.srcSet.includes("/_next/image"))
})

test('asset images use stored low/high variants and no Vercel image optimizer',()=>{
 const high='https://assets.holofolder.com/pokemon/tcg/cards/en/base1/1/high.webp'
 assert.equal(cardImageLoader({src:high,width:600}),high)
 const attrs=getCardImageAttributes(high,'80px')
 assert.ok(attrs.srcSet?.includes('/low.webp'))
 assert.ok(!attrs.srcSet?.includes('/_next/image'))
})
