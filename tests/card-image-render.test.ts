import { test } from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { getCardImageAttributes } from "../lib/card-image-loader"
import { toCardImageSrc } from "../lib/card-image-url"
import CardImage from "../components/card-image"

// Synthetic card URLs: the tests render markup without fetching any images.
const src = "https://assets.tcgdex.net/en/mock/base1/44/high.webp"

test("card images render responsive asset variants and an inline loading placeholder", () => {
  const html = renderToStaticMarkup(createElement(CardImage, { src, alt: "Synthetic card", sizes: "80px" }))
  assert.equal(html.match(/srcSet="([^"]+)"/)?.[1].replace(/&amp;/g, "&"), getCardImageAttributes(toCardImageSrc(src)!, "80px").srcSet)
  assert.match(html, /sizes="80px"/)
  assert.equal(html.match(/<img[^>]+ src="([^"]+)"/)?.[1], "https://assets.holofolder.com/cards/en/base1/44/high.webp")
  assert.doesNotMatch(html, /\/_next\/image/)
  assert.match(html, /background-image:url/)
  assert.match(html, /data:image\/svg\+xml/)
  assert.match(html, /loading="lazy"/)
  assert.match(html, /width="600" height="825"/)
})

test("fill images preserve their container, eager priority and accessibility", () => {
  const html = renderToStaticMarkup(createElement(CardImage, { src, alt: "Synthetic owned card", sizes: "80px", fill: true, loading: "eager", fetchPriority: "high" }))
  assert.match(html, /data-nimg="fill"/)
  assert.match(html, /position:absolute/)
  assert.match(html, /alt="Synthetic owned card"/)
  assert.match(html, /fetchPriority="high"/)
  assert.doesNotMatch(html, /loading="lazy"/)
})

test("original-image fallback bypasses resizing while preserving its placeholder", () => {
  const html = renderToStaticMarkup(createElement(CardImage, { src, alt: "Synthetic card", sizes: "80px", unoptimized: true }))
  assert.doesNotMatch(html, /srcSet=|\/_next\/image|&amp;w=/)
  assert.match(html, /background-image:url/)
})
