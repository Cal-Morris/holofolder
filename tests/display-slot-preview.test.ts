import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { displaySlotPreview, WANTED_PREVIEW_TONE, type ReadOnlyDisplaySlot } from "@/lib/binder-display-model"

// Synthetic slots only.
const owned: ReadOnlyDisplaySlot = { id: "a", target: { kind: "pokemon", pokemonId: 6 }, item: { grading: null }, card: { name: "Charizard", image: "owned.webp" }, pokemon: { id: 6, name: "charizard" } }
const want = [{ card_image: "want.webp" }]

describe("displaySlotPreview", () => {
  test("raw owned stays full colour", () => assert.deepEqual(displaySlotPreview(owned), { image: "owned.webp", isCard: true, tone: "" }))
  test("a want previews its printing dimmed, owned or not", () => {
    assert.deepEqual(displaySlotPreview({ ...owned, wantedCards: want }), { image: "want.webp", isCard: true, tone: WANTED_PREVIEW_TONE })
    assert.deepEqual(displaySlotPreview({ ...owned, item: null, card: null, wantedCards: want }, "wanted"), { image: "want.webp", isCard: true, tone: WANTED_PREVIEW_TONE })
  })
  test("Owned display ignores wants", () => assert.equal(displaySlotPreview({ ...owned, wantedCards: want }, "current").image, "owned.webp"))
  test("a want without an image keeps the honest placeholder, still dimmed", () => {
    const preview = displaySlotPreview({ ...owned, item: null, card: null, wantedCards: [{}] })
    assert.match(preview.image ?? "", /official-artwork/)
    assert.equal(preview.isCard, false)
    assert.equal(preview.tone, WANTED_PREVIEW_TONE)
  })
  test("missing wanted artwork cannot substitute the owned printing", () => {
    const preview = displaySlotPreview({ ...owned, wantedCards: [{}] })
    assert.match(preview.image ?? "", /official-artwork/)
    assert.notEqual(preview.image, owned.card?.image)
    assert.equal(preview.isCard, false)
    assert.equal(displaySlotPreview({ ...owned, wantedCards: [{}] }, "current").image, "owned.webp")
  })
  test("Wanted display dims owned copies without a want", () => assert.deepEqual(displaySlotPreview(owned, "wanted"), { image: "owned.webp", isCard: true, tone: "grayscale opacity-45" }))
  test("plain unfilled target keeps existing dimming", () => assert.equal(displaySlotPreview({ ...owned, item: null }).tone, "grayscale opacity-45"))
})
