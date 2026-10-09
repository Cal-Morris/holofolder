import test from "node:test"
import assert from "node:assert/strict"

import { buildPokemonSearchPreview } from "../lib/pokemon-search-preview"

test("buildPokemonSearchPreview keeps Pokemon art primary and card art as a badge", () => {
  const preview = buildPokemonSearchPreview({
    pokemonArtwork: "https://img.example/bulbasaur.png",
    cardImage: "https://img.example/bulbasaur-card.webp",
    status: "collected",
  })

  assert.equal(preview.previewImage, "https://img.example/bulbasaur.png")
  assert.equal(preview.previewFitClass, "object-contain")
  assert.equal(preview.cardPreviewImage, "https://img.example/bulbasaur-card.webp")
  assert.equal(preview.cardPreviewToneClass, "")
})

test("buildPokemonSearchPreview falls back to card art when Pokemon art is missing", () => {
  const preview = buildPokemonSearchPreview({
    pokemonArtwork: null,
    cardImage: "https://img.example/unknown-card.webp",
    status: "wishlisted",
  })

  assert.equal(preview.previewImage, "https://img.example/unknown-card.webp")
  assert.equal(preview.previewFitClass, "object-contain")
  assert.equal(preview.cardPreviewImage, null)
  assert.equal(preview.previewToneClass, "grayscale saturate-[0.8] brightness-[0.92]")
})
