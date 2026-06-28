import test from "node:test"
import assert from "node:assert/strict"
import {
  normalizeSlotPreviewImage,
  pickRepresentativeSlotPreviewCard,
} from "../lib/slot-preview-card"

test("normalizeSlotPreviewImage rejects empty image strings", () => {
  assert.equal(normalizeSlotPreviewImage(null), null)
  assert.equal(normalizeSlotPreviewImage("   "), null)
  assert.equal(normalizeSlotPreviewImage(" https://assets.tcgdex.net/en/sv/sv01/001/high.webp "), "https://assets.tcgdex.net/en/sv/sv01/001/high.webp")
})

test("pickRepresentativeSlotPreviewCard returns the first usable card image", () => {
  const preview = pickRepresentativeSlotPreviewCard([
    { id: "missing", name: "Missing", image: "" },
    { id: "sv01-001", name: "Sprigatito", image: "https://assets.tcgdex.net/en/sv/sv01/001/high.webp" },
  ])

  assert.deepEqual(preview, {
    cardId: "sv01-001",
    image: "https://assets.tcgdex.net/en/sv/sv01/001/high.webp",
    name: "Sprigatito",
  })
})

test("pickRepresentativeSlotPreviewCard prefers normal cards over jumbo supplement rows", () => {
  const preview = pickRepresentativeSlotPreviewCard([
    {
      id: "jumbo-sv02-062",
      name: "Pikachu Jumbo",
      image: "https://assets.tcgdex.net/en/sv/sv02/062/high.webp",
      set: { id: "jumbo" },
      variants: { jumbo: true },
    },
    {
      id: "sv02-062",
      name: "Pikachu",
      image: "https://assets.tcgdex.net/en/sv/sv02/062/high.webp",
      set: { id: "sv02" },
      variants: { normal: true },
    },
  ])

  assert.equal(preview?.cardId, "sv02-062")
  assert.equal(preview?.name, "Pikachu")
})
