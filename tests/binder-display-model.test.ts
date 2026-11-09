import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { adaptLegacyDisplaySlots, buildSlotDisplay, paginateDisplaySlots, resolveDisplaySelection } from "@/lib/binder-display-model"
import { syntheticSlotDisplaySnapshot } from "@/tests/fixtures/slot-display"

describe("stable binder display", () => {
  test("references two actual Snorlax copies and never treats target art as ownership", () => {
    const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot()
    const slots = buildSlotDisplay(binder, inventory, id => catalog[id])
    assert.equal(slots[0].item, inventory.items[0])
    assert.equal(slots[1].item, inventory.items[1])
    assert.notEqual(slots[0].id, slots[1].id)
    assert.equal(resolveDisplaySelection(slots, slots[1].id)?.card?.name, "Snorlax B")
    assert.equal(slots[4].item, null)
    assert.equal(slots[4].target?.kind, "pokemon")
    assert.equal(slots[5].target?.kind, "card")
    assert.equal(slots[6].target, null)
    assert.equal(slots[2].pokemon, null)
    assert.equal(slots[3].pokemon, null)
    assert.equal(slots[1].item?.grading?.grade, "9")
    // Separately serialized but equivalent snapshots need not share property insertion order.
    const { slots: entries, ...rest } = binder
    const equivalent = { slots: entries, ...rest }
    assert.deepEqual(buildSlotDisplay(equivalent, inventory, id => catalog[id]).map(s => s.id), slots.map(s => s.id))
  })
  test("all 1–8 dimensions preserve order, stored blanks and stable identity", () => {
    const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot()
    const slots = buildSlotDisplay(binder, inventory, id => catalog[id])
    for (let rows = 1; rows <= 8; rows++) for (let cols = 1; cols <= 8; cols++) {
      const pages = paginateDisplaySlots(slots, rows, cols)
      assert.equal(pages.length, Math.ceil(slots.length / (rows * cols)))
      assert.deepEqual(pages.flat().filter(Boolean).map(s => s!.id), slots.map(s => s.id))
      assert.ok(pages.every(p => p.length === rows * cols))
      assert.equal(resolveDisplaySelection(pages.flat().filter(s => s !== null), slots[1].id)?.item?.id, "item-b")
    }
    assert.equal(paginateDisplaySlots([], 8, 8).length, 0)
    assert.throws(() => paginateDisplaySlots(slots, 0, 9))
  })
  test("filter masking retains saved positions and does not mutate snapshot or grading", () => {
    const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot()
    const before = JSON.stringify(inventory)
    const slots = buildSlotDisplay(binder, inventory, id => catalog[id])
    const page = paginateDisplaySlots(slots, 2, 4, slot => slot.id === "slot-b")[0]
    assert.equal(page[0], null)
    assert.equal(page[1]?.id, "slot-b")
    assert.equal(page[7], null)
    assert.equal(JSON.stringify(inventory), before)
    assert.equal(resolveDisplaySelection(slots, "missing"), null)
  })
  test("rejects incomplete, foreign or divergent snapshots", () => {
    const { binder, inventory } = syntheticSlotDisplaySnapshot()
    assert.throws(() => buildSlotDisplay(binder, { ...inventory, items: [] }, () => undefined))
    assert.throws(() => buildSlotDisplay({ ...binder, ownerUserId: "other" }, inventory, () => undefined))
    assert.throws(() => buildSlotDisplay({ ...binder, slots: [] }, inventory, () => undefined))
  })
  test("legacy adapter retains species, collection references and deterministic scoped keys", () => {
    const pokemon = [{ id: 143, name: "snorlax" }]
    const a = adaptLegacyDisplaySlots("legacy-a", pokemon, () => undefined)
    assert.equal(a[0].pokemon, pokemon[0])
    assert.equal(a[0].legacyPokemonId, 143)
    assert.equal(a[0].id, adaptLegacyDisplaySlots("legacy-a", pokemon, () => undefined)[0].id)
    assert.notEqual(a[0].id, adaptLegacyDisplaySlots("legacy-b", pokemon, () => undefined)[0].id)
  })
})

import { studioCardTextureKey } from "@/lib/binder-design"
test("3D texture identity separates placeholders and actual copies of the same image", () => {
  const owned = { id: "slot-a", name: "Snorlax, Owned", image: "/app/api/card-image-proxy?url=synthetic", presentation: "owned" as const }
  const target = { ...owned, presentation: "target" as const }
  assert.notEqual(studioCardTextureKey(owned), studioCardTextureKey(target))
  assert.notEqual(studioCardTextureKey(owned), studioCardTextureKey({ ...owned, id: "slot-b" }))
  assert.equal(studioCardTextureKey({ id: "legacy", name: "Legacy", image: "legacy-image" }), "legacy-image")
})

test("rearranging whole source slots preserves independent detail and item metadata", () => {
  const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot()
  const original = buildSlotDisplay(binder, inventory, id => catalog[id])
  const moved = { ...binder, slots: [...binder.slots].reverse(), layoutRevision: 2 }
  const reordered = buildSlotDisplay(moved, { ...inventory, binders: [moved] }, id => catalog[id])
  assert.deepEqual(reordered.map(s => s.id), [...original].reverse().map(s => s.id))
  assert.equal(resolveDisplaySelection(reordered, "slot-b")?.item, original[1].item)
  assert.equal(resolveDisplaySelection(reordered, "slot-b")?.item?.grading, inventory.items[1].grading)
  assert.equal(resolveDisplaySelection(reordered, "slot-b")?.target, binder.slots[1].target)
  assert.equal(resolveDisplaySelection(reordered, "slot-b")?.wantedCards, binder.slots[1].wantedCards)
})
