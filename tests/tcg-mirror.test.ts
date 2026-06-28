import test from "node:test"
import assert from "node:assert/strict"
import { pickExternalCardImageUrl } from "../lib/tcg-mirror"

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
