import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { parseSourceCardImageUrl, pickCardImageUrl, pickExternalCardImageUrl } from "../lib/card-image-sources"
import { pokemonComCardImageUrl } from "../lib/pokemoncom-card-images"

const BASE = "https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web"

describe("pokemonComCardImageUrl", () => {
  test("maps our set and card ids to the CDN URLs that exist", () => {
    const cases: Array<[string, string, string]> = [
      ["bw10", "8", "BW10/BW10_EN_8"],
      ["sv01", "001", "SV01/SV01_EN_1"],
      ["sv03.5", "001", "SV3PT5/SV3PT5_EN_1"],
      ["swsh12.5", "1", "SWSH12PT5/SWSH12PT5_EN_1"],
      ["sm3.5", "1", "SM35/SM35_EN_1"],
      ["swsh9tg", "TG01", "SWSH9/SWSH9_EN_TG01"],
      ["swsh4.5sv", "SV001", "SWSH45/SWSH45_EN_SV001"],
      ["swsh12.5gg", "GG01", "SWSH12PT5GG/SWSH12PT5GG_EN_GG01"],
      ["swshp", "SWSH001", "SWSHP/SWSHP_EN_SWSH001"],
    ]
    for (const [setId, localId, path] of cases) assert.equal(pokemonComCardImageUrl(setId, localId), `${BASE}/${path}.png`, `${setId}-${localId}`)
  })

  test("refuses ids the CDN can't express", () => {
    assert.equal(pokemonComCardImageUrl("svp", "013~490730"), null)
    assert.equal(pokemonComCardImageUrl("tk-bw-e", "1"), null)
  })
})

describe("pokemoncom image source", () => {
  test("only the card image path on the shared asset host is a source, keyed deterministically", () => {
    assert.equal(parseSourceCardImageUrl(`${BASE}/BW10/BW10_EN_8.png`)?.pathname, "pokemon/tcg/cards/src/pokemoncom/BW10/BW10_EN_8.webp")
    assert.equal(parseSourceCardImageUrl(`${BASE}/BW10/SV01_EN_8.png`), null)
    assert.equal(parseSourceCardImageUrl("https://assets.pokemon.com/static2/_ui/js/main.js"), null)
  })

  test("is preferred over pokemontcg.io for cards without a TCGdex image", () => {
    const url = `${BASE}/BW10/BW10_EN_8.png`
    assert.equal(pickExternalCardImageUrl({ pokemoncom: { image: url }, pokemon_tcg: { imageLarge: "https://images.pokemontcg.io/bw10/8_hires.png" } }), url)
  })
})

describe("pickCardImageUrl", () => {
  const official = `${BASE}/BW10/BW10_EN_8.png`

  test("the official scan (245 px) comes after TCGdex's English print but before a foreign one", () => {
    assert.equal(pickCardImageUrl({ pokemoncom: { image: official } }, "en", "tcgdex:en"), "tcgdex:en")
    assert.equal(pickCardImageUrl({ pokemoncom: { image: official } }, "ja", "tcgdex:ja"), official, "English requested, TCGdex only has Japanese")
    assert.equal(pickCardImageUrl({ pokemoncom: { image: official } }, "ja", "tcgdex:ja", "ja"), "tcgdex:ja", "Japanese requested")
    assert.equal(pickCardImageUrl({ pokemoncom: { image: official } }, null, null), official)
  })

  test("a reviewed catalog image still wins, and a non-pokemon.com URL is ignored", () => {
    const reviewed = "https://images.pokemontcg.io/bw10/8_hires.png"
    assert.equal(pickCardImageUrl({ catalog: { image: reviewed }, pokemoncom: { image: official } }, "en", "tcgdex:en"), reviewed)
    assert.equal(pickCardImageUrl({ pokemoncom: { image: "https://evil.test/x.png" } }, "en", "tcgdex:en"), "tcgdex:en")
  })
})
