import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { getBinderGoalPresentation } from "@/lib/binder-goals"
import { instantiatePreset } from "@/lib/domain/binder-presets"
import { speciesPreset, blankPreset, printingPreset } from "@/lib/binder-creation-draft"
import { syntheticSlotPickerSnapshot } from "./fixtures/slot-picker"
import { pickerCandidate } from "@/lib/slot-picker"

describe("current binder goal presentation", () => {
  test("removed, retargeted and free targets replace the denominator; provenance cannot restore them", () => {
    const d = syntheticSlotPickerSnapshot()
    d.binder = instantiatePreset(speciesPreset("Dex", Array.from({ length: 1025 }, (_, i) => i + 1)), { ownerUserId: d.binder.ownerUserId, collectionId: d.binder.collectionId }, Array.from({ length: 1025 }, (_, i) => `s${i}`))!
    const goal = () => getBinderGoalPresentation(d.inventory, d.binder, () => undefined)
    assert.equal(goal().targetCount, 1025)
    const freePage = Array.from({ length: 16 }, (_, i) => ({ ...d.binder.slots[0], id: `energy-${i}`, target: null }))
    d.binder.slots.push(...freePage)
    assert.equal(goal().targetCount, 1025)
    assert.equal(goal().freeSlotCount, 16)
    d.binder.slots.splice(1025)
    d.binder.slots.splice(1000)
    assert.equal(goal().targetCount, 1000)
    const energy = { ...d.binder.slots[0], id: "free-energy", target: null }
    d.binder.slots.push(energy)
    assert.equal(goal().targetCount, 1000)
    assert.equal(goal().freeSlotCount, 1)
    d.binder.slots[0].target = { kind: "pokemon", pokemonId: 143 }
    assert.equal(goal().targetCount, 1000)
    assert.equal(d.binder.presetManifest!.entries.length, 1025)
  })
  test("repeated printings need separate primary assignments; missing catalog remains unknown", () => {
    const d = syntheticSlotPickerSnapshot(), card = d.cards[0]
    const binder = instantiatePreset(printingPreset([card, card]), { ownerUserId: d.binder.ownerUserId, collectionId: d.binder.collectionId }, ["a", "b"])!
    const item = d.inventory.items[0]
    item.identity = { kind: "card", cardId: card.id, language: "en" }
    binder.slots[0].inventoryItemId = item.id
    binder.slots[0].status = "collected"
    d.inventory.placements = [{ inventoryItemId: item.id, collectionId: binder.collectionId, slotId: "a", version: 0 }]
    const catalog = () => pickerCandidate(card)
    assert.equal(getBinderGoalPresentation(d.inventory, binder, catalog).ownerCounts.total, d.inventory.items.length)
    assert.equal(getBinderGoalPresentation(d.inventory, binder, catalog).completedTargetCount, 1)
    assert.equal(getBinderGoalPresentation(d.inventory, binder, () => undefined).unknownTargetCount, 1)
    binder.slots[0].target = { kind: "pokemon", pokemonId: 25 }
    assert.equal(getBinderGoalPresentation(d.inventory, binder, catalog).completedTargetCount, 0)
    binder.slots[0].target = null
    const free = getBinderGoalPresentation(d.inventory, binder, catalog)
    assert.equal(free.targetCount, 1)
    assert.equal(free.filledFreeSlotCount, 1)
    d.inventory.placements = []
    assert.equal(getBinderGoalPresentation(d.inventory, binder, catalog).assignedCount, 0)
  })
  test("last missing target removal completes the edited goal, zero-target remains an empty state", () => {
    const d = syntheticSlotPickerSnapshot()
    const b = instantiatePreset(speciesPreset("Chosen", [143, 925]), { ownerUserId: d.binder.ownerUserId, collectionId: d.binder.collectionId }, ["a", "b"])!
    const item = d.inventory.items[0]
    item.identity = { kind: "pokemon", pokemonId: 143 }
    b.slots[0].inventoryItemId = item.id
    d.inventory.placements = [{ inventoryItemId: item.id, collectionId: b.collectionId, slotId: "a", version: 0 }]
    assert.equal(getBinderGoalPresentation(d.inventory, b, () => undefined).percentage, 50)
    b.slots.pop()
    assert.equal(getBinderGoalPresentation(d.inventory, b, () => undefined).percentage, 100)
    const blank = instantiatePreset(blankPreset(), { ownerUserId: d.binder.ownerUserId, collectionId: d.binder.collectionId }, [])!
    const goal = getBinderGoalPresentation(d.inventory, blank, () => undefined)
    assert.equal(goal.percentage, null)
    assert.equal(goal.targetCount, 0)
    assert.equal(goal.ownerCounts.total, d.inventory.items.length)
  })
})
