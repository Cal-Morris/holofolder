import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { blankPreset, speciesPreset, printingPreset, parseBinderCreationDraft } from "@/lib/binder-creation-draft"
import { instantiatePreset } from "@/lib/domain/binder-presets"
import { syntheticSlotPickerSnapshot } from "./fixtures/slot-picker"

describe("preset creation drafts", () => {
  test("blank stores zero slots, Kanto and selected species copy stable ordered targets", () => {
    assert.deepEqual(instantiatePreset(blankPreset(), { ownerUserId: "o", collectionId: "b" }, [])?.slots, [])
    assert.equal(speciesPreset("Kanto", Array.from({ length: 151 }, (_, i) => i + 1)).entries.length, 151)
    assert.deepEqual(speciesPreset("Mice and Snorlax", [925, 924, 143]).entries.map(e => e.target), [925, 924, 143].map(pokemonId => ({ kind: "pokemon", pokemonId })))
    assert.throws(() => speciesPreset("Unknown", [99999]))
    assert.throws(() => speciesPreset("Duplicate", [143, 143]))
  })
  test("parsing detaches and recursively freezes drafts, independent manifests cannot change each other", () => {
    const manifest = speciesPreset("Chosen", [925, 924, 143])
    const input = { version: 1, operationId: "same-retry", ownerUserId: "owner", name: " Mice  binder ", manifest }
    const a = parseBinderCreationDraft(input), b = parseBinderCreationDraft(input)
    assert.deepEqual(a, b)
    assert.notEqual(a.manifest, b.manifest)
    manifest.entries[0].target = null
    assert.equal(a.manifest.entries[0].target?.kind, "pokemon")
    assert.ok(Object.isFrozen(a.manifest.entries[0].target))
    assert.equal(a.name, "Mice binder")
    for (const bad of [{ ...input, version: 2 }, { ...input, name: " " }, { ...input, actor: "fake" }, { ...input, operationId: "" }]) assert.throws(() => parseBinderCreationDraft(bad))
  })
  test("printing selection snapshots catalog language and order, repeats are distinct targets, no inventory or wants", () => {
    const { cards } = syntheticSlotPickerSnapshot()
    const chosen = [cards[1], cards[0], cards[0]]
    const preset = printingPreset(chosen)
    assert.deepEqual(preset.entries.map(e => e.target), chosen.map(c => ({ kind: "card", cardId: c.id, language: "en" })))
    const binder = instantiatePreset(preset, { ownerUserId: "o", collectionId: "b" }, ["a", "b", "c"])!
    assert.ok(binder.slots.every(s => s.inventoryItemId === null && s.wantedCards.length === 0 && s.status === null))
    assert.throws(() => printingPreset([{ ...cards[0], language: undefined }]))
    assert.throws(() => printingPreset([{ ...cards[0], set: { id: "", name: "Unknown" } }]))
    cards.push({ ...cards[0], id: "later-catalog-card" })
    assert.equal(preset.entries.length, 3)
  })
})

test("custom draft retains bounded private location and rejects slab exposure or incompatible location", () => {
  const input = { version: 1, operationId: "synthetic-custom", ownerUserId: "owner", name: " Box ", manifest: blankPreset(), kind: "custom", location: "  Top shelf  " }
  const custom = parseBinderCreationDraft(input)
  assert.equal(custom.kind, "custom"); assert.equal(custom.location, "Top shelf")
  assert.ok(Object.isFrozen(custom))
  assert.equal(parseBinderCreationDraft({ ...input, location: "  " }).location, null)
  assert.equal(parseBinderCreationDraft({ ...input, location: "x".repeat(200) }).location?.length, 200)
  for (const fields of [{ kind: "slab" }, { kind: "unknown" }, { location: "x".repeat(201) }, { location: 42 }, { kind: "binder" }]) {
    assert.throws(() => parseBinderCreationDraft({ ...input, ...fields }))
  }
  const binder = parseBinderCreationDraft({ ...input, kind: "binder", location: null })
  assert.equal(binder.kind, "binder"); assert.equal(binder.location, null)
})
