import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { buildTcgdexAssetImageUrl, pickLocalizedText, pickTcgdexImageFromExternalIds } from "../lib/tcgdex-shared"
import { buildTcgdexCardImageUrl, parseTcgdexCardImageUrl } from "../lib/card-image-blob"

describe("tcgdex-shared", () => {
  test("pickLocalizedText prefers the requested language, then the fallback order", () => {
    assert.equal(pickLocalizedText("Pikachu"), "Pikachu")
    assert.equal(pickLocalizedText({ en: "Pikachu", fr: "Pikachu FR" }, "fr"), "Pikachu FR")
    assert.equal(pickLocalizedText({ ko: "피카츄", ja: "ピカチュウ" }, "de"), "ピカチュウ")
    assert.equal(pickLocalizedText({ zh: "皮卡丘" }), "皮卡丘")
    assert.equal(pickLocalizedText({ en: "" }), null)
    assert.equal(pickLocalizedText(null), null)
  })

  test("buildTcgdexAssetImageUrl encodes segments and round-trips through the Blob parser", () => {
    const url = buildTcgdexAssetImageUrl("en", "swsh", "swshp", "SWSH001", "low")
    assert.equal(url, "https://assets.tcgdex.net/en/swsh/swshp/SWSH001/low.webp")
    const ref = parseTcgdexCardImageUrl(url)
    assert.ok(ref)
    assert.equal(buildTcgdexCardImageUrl(ref), url)
  })

  test("pickTcgdexImageFromExternalIds reads tcgdex.image only", () => {
    assert.equal(pickTcgdexImageFromExternalIds({ tcgdex: { image: "https://assets.tcgdex.net/en/a/b/1" } }), "https://assets.tcgdex.net/en/a/b/1")
    assert.equal(pickTcgdexImageFromExternalIds({ pokemon_tcg: { imageLarge: "x" } }), null)
    assert.equal(pickTcgdexImageFromExternalIds([]), null)
  })
})
