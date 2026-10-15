import test from "node:test"
import assert from "node:assert/strict"
import { pickExternalCardImageUrl } from "../lib/tcg-mirror"

test("a reviewed printing image takes precedence over its base card artwork", () => {
  assert.equal(pickExternalCardImageUrl({
    catalog: { image: "https://product-images.tcgplayer.com/685563.jpg" },
    tcgdex: { image: "https://assets.tcgdex.net/en/me/mep/070/high.webp" },
  }), "https://product-images.tcgplayer.com/685563.jpg")
})

test("pickExternalCardImageUrl prefers mirrored PokemonTCG art before TCGplayer product art", () => {
  assert.equal(pickExternalCardImageUrl({
    pokemon_tcg: {
      imageLarge: "https://images.pokemontcg.io/smp/SM184_hires.png",
    },
    tcgdex: {
      variantThirdParty: [{ tcgplayer: 659232 }],
    },
  }), "https://images.pokemontcg.io/smp/SM184_hires.png")
})

test("pickExternalCardImageUrl falls back to TCGplayer product art from TCGdex third-party metadata", () => {
  assert.equal(pickExternalCardImageUrl({
    tcgdex: {
      variantThirdParty: [{ tcgplayer: 659232 }],
    },
  }), "https://product-images.tcgplayer.com/659232.jpg")
})
