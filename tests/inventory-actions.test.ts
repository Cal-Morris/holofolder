import { test } from "node:test"
import assert from "node:assert/strict"
import { syntheticSlotPickerSnapshot } from "./fixtures/slot-picker"
import { pickerCandidate } from "../lib/slot-picker"
import { inventoryActionDestinations, inventoryOccupiedChoices, prepareInventoryAction } from "../lib/inventory-actions"
import { projectSlotIntent } from "../lib/collection/slot-optimistic"

const context = { source: "app" as const, clientId: null, operationId: "synthetic-raw-action", batchId: null, clientOccurredAt: null }
const setup = () => {
  const data = syntheticSlotPickerSnapshot()
  return { ...data, resolve: (id: string) => { const c = data.cards.find(c => c.id === id); return c ? pickerCandidate(c) : undefined } }
}
test("explicit add creates a separate raw Unassigned copy even with raw and graded duplicates", () => {
  const { inventory, resolve } = setup()
  const before = structuredClone(inventory)
  const identity = { kind: "card" as const, cardId: "synthetic-snorlax-a" }
  const { intent, preview } = prepareInventoryAction(inventory, { kind: "add", itemId: "new-copy", identity }, context, resolve)
  assert.equal(preview.items.length, inventory.items.length + 1)
  assert.deepEqual(preview.items.find(i => i.id === "new-copy"), { id: "new-copy", ownerUserId: inventory.ownerUserId, identity, grading: null, acquiredAt: null, version: 0 })
  assert.deepEqual(preview.placements, inventory.placements)
  assert.deepEqual(intent.request.collections, [])
  assert.deepEqual(inventory, before)
})
test("selected duplicate moves, unassigns and removes alone with complete exact predicates", () => {
  const { inventory, resolve } = setup()
  const itemId = "unassigned-b"
  const destination = inventoryActionDestinations(inventory, itemId, resolve).find(d => d.slot.inventoryItemId === null)!
  assert.ok(destination)
  const planned = prepareInventoryAction(inventory, { kind: "place", itemId, collectionId: destination.collectionId, slotId: destination.slot.id }, context, resolve)
  assert.equal(planned.intent.request.commands[0].kind, "assign")
  assert.equal(planned.preview.placements.find(p => p.inventoryItemId === itemId)?.slotId, destination.slot.id)
  const second = inventoryActionDestinations(planned.preview, itemId, resolve).find(d => d.slot.inventoryItemId === null)!
  const moved = prepareInventoryAction(planned.preview, { kind: "place", itemId, collectionId: second.collectionId, slotId: second.slot.id }, context, resolve)
  assert.equal(moved.intent.request.commands[0].kind, "move")
  assert.equal(moved.preview.placements.filter(p => p.inventoryItemId === itemId).length, 1)
  const item = moved.preview.items.find(i => i.id === itemId)
  const unassigned = prepareInventoryAction(moved.preview, { kind: "unassign", itemId }, context, resolve)
  assert.deepEqual(unassigned.preview.items.find(i => i.id === itemId), item)
  assert.equal(unassigned.preview.placements.some(p => p.inventoryItemId === itemId), false)
  const removed = prepareInventoryAction(moved.preview, { kind: "removeOwned", itemId }, context, resolve)
  assert.equal(removed.preview.items.some(i => i.id === itemId), false)
  assert.equal(removed.preview.items.length, inventory.items.length - 1)
  assert.deepEqual(removed.preview.items.filter(i => i.id !== itemId), inventory.items.filter(i => i.id !== itemId))
  assert.deepEqual(removed.preview.binders[0].slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin]), inventory.binders[0].slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin]))
})
test("stale item, slot, inventory, layout and collection versions conflict rather than selecting a different copy", () => {
  const { inventory, resolve } = setup()
  const d = inventoryActionDestinations(inventory, "unassigned-b", resolve).find(d => d.slot.inventoryItemId === null)!
  const { intent } = prepareInventoryAction(inventory, { kind: "place", itemId: "unassigned-b", collectionId: d.collectionId, slotId: d.slot.id }, context, resolve)
  for (const mutate of [
    (s: typeof inventory) => { s.inventoryRevision++ },
    (s: typeof inventory) => { s.items.find(i => i.id === "unassigned-b")!.version++ },
    (s: typeof inventory) => { s.collections[0].version++ },
    (s: typeof inventory) => { s.binders[0].layoutRevision++ },
    (s: typeof inventory) => { s.binders[0].slots.find(slot => slot.id === d.slot.id)!.version++ },
  ]) { const changed = structuredClone(inventory); mutate(changed); assert.throws(() => projectSlotIntent(changed, intent, resolve)) }
})
test("unknown printing/language/finish stay unknown; only free slots or provably compatible targets are offered", () => {
  const { inventory, resolve } = setup()
  const item = inventory.items.find(i => i.id === "unassigned-b")!
  item.identity = { kind: "card", cardId: "unknown-printing" }
  const offered = inventoryActionDestinations(inventory, item.id, resolve)
  assert.ok(offered.length)
  for (const d of offered) {
    assert.equal(inventory.binders[0].slots.find(s => s.id === d.slot.id)?.target, null)
    const { preview } = prepareInventoryAction(inventory, { kind: "place", itemId: item.id, collectionId: d.collectionId, slotId: d.slot.id, ...(d.slot.inventoryItemId ? { occupied: "unassign" as const } : {}) }, context, resolve)
    assert.deepEqual(preview.items.find(i => i.id === item.id)?.identity, item.identity)
  }
  assert.throws(() => prepareInventoryAction(inventory, { kind: "add", itemId: "unknown-new", identity: item.identity as Extract<typeof item.identity, { kind: "card" }> }, context, resolve))
})
test("graded, occupied, cross-owner and nonexistent copies/destinations are refused", () => {
  const { inventory, resolve } = setup()
  for (const itemId of ["unassigned-grade", "missing-copy"]) assert.throws(() => prepareInventoryAction(inventory, { kind: "removeOwned", itemId }, context, resolve))
  for (const destination of [{ collectionId: inventory.collections[0].id, slotId: "slot-a" }, { collectionId: "foreign-owner", slotId: "slot-g" }]) {
    assert.throws(() => prepareInventoryAction(inventory, { kind: "place", itemId: "unassigned-b", ...destination }, context, resolve))
  }
  const copy = inventory.items.find(i => i.id === "unassigned-b")!
  copy.ownerUserId = "another-owner"
  assert.throws(() => prepareInventoryAction(inventory, { kind: "removeOwned", itemId: copy.id }, context, resolve))
})

test("occupied assignment requires a deliberate decision and retains both exact physical copies", () => {
  const { inventory, resolve } = setup()
  const destination = inventoryActionDestinations(inventory, "unassigned-b", resolve).find(d => d.slot.id === "slot-a")!
  const action = { kind: "place" as const, itemId: "unassigned-b", collectionId: destination.collectionId, slotId: destination.slot.id }
  assert.deepEqual(destination.slot, { id: "slot-a", version: 1, inventoryItemId: "item-a", itemVersion: 1, placementVersion: 1 })
  assert.deepEqual(inventoryOccupiedChoices(inventory, action.itemId, destination, resolve), ["unassign"])
  assert.throws(() => prepareInventoryAction(inventory, action, context, resolve), /explicit-occupied-decision/)
  assert.throws(() => prepareInventoryAction(inventory, { ...action, occupied: "swap" }, context, resolve), /swap-source/)
  const { intent, preview } = prepareInventoryAction(inventory, { ...action, occupied: "unassign" }, context, resolve)
  assert.deepEqual(preview.items, inventory.items)
  assert.equal(preview.placements.find(p => p.inventoryItemId === "unassigned-b")?.slotId, "slot-a")
  assert.equal(preview.placements.some(p => p.inventoryItemId === "item-a"), false)
  assert.equal(intent.request.commands[0].kind, "assign")
  assert.equal((intent.request.commands[0] as { fulfillWant: null }).fulfillWant, null)
})
test("swap with recorded graded destination preserves private metadata, wants and targets", () => {
  const { inventory, resolve } = setup()
  inventory.items[1].grading!.certificate = "PRIVATE-CERT"
  inventory.items[1].acquiredAt = "2026-01-02T00:00:00Z"
  inventory.binders[0].slots[1].wantedCards = [{ card_id: "synthetic-snorlax-b", card_name: "Synthetic Snorlax", added_at: "2026-01-01T00:00:00Z", wanted_by: ["00000000-0000-4000-8000-000000000001"] }]
  const before = structuredClone(inventory)
  const destination = inventoryActionDestinations(inventory, "item-a", resolve).find(d => d.slot.id === "slot-b")!
  assert.deepEqual(inventoryOccupiedChoices(inventory, "item-a", destination, resolve), ["unassign", "swap"])
  for (const occupied of ["unassign", "swap"] as const) {
    const { preview, intent } = prepareInventoryAction(inventory, { kind: "place", itemId: "item-a", collectionId: destination.collectionId, slotId: destination.slot.id, occupied }, context, resolve)
    assert.deepEqual(preview.items, before.items)
    assert.equal(preview.placements.find(p => p.inventoryItemId === "item-a")?.slotId, "slot-b")
    assert.equal(preview.placements.find(p => p.inventoryItemId === "item-b")?.slotId, occupied === "swap" ? "slot-a" : undefined)
    assert.deepEqual(preview.binders[0].slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin]), before.binders[0].slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin]))
    assert.equal(intent.request.commands.length, 1)
    assert.equal((intent.request.commands[0] as { fulfillWant: null }).fulfillWant, null)
  }
  assert.deepEqual(inventory, before)
})
test("reverse mismatch refuses swap but allows reviewed unassignment; same slot cannot be selected", () => {
  const { inventory, resolve } = setup()
  const destination = inventoryActionDestinations(inventory, "item-a", resolve).find(d => d.slot.id === "slot-c")!
  assert.deepEqual(inventoryOccupiedChoices(inventory, "item-a", destination, resolve), ["unassign"])
  assert.throws(() => prepareInventoryAction(inventory, { kind: "place", itemId: "item-a", collectionId: destination.collectionId, slotId: destination.slot.id, occupied: "swap" }, context, resolve))
  assert.equal(inventoryActionDestinations(inventory, "item-a", resolve).some(d => d.slot.id === "slot-a"), false)
})
test("occupied plans fence either copy, placement, slot, target, layout and collection changes", () => {
  const { inventory, resolve } = setup()
  const { intent } = prepareInventoryAction(inventory, { kind: "place", itemId: "item-a", collectionId: inventory.collections[0].id, slotId: "slot-b", occupied: "swap" }, context, resolve)
  for (const mutate of [
    (s: typeof inventory) => { s.inventoryRevision++ },
    (s: typeof inventory) => { s.items[0].version++ },
    (s: typeof inventory) => { s.items[1].version++ },
    (s: typeof inventory) => { s.placements[0].version++ },
    (s: typeof inventory) => { s.placements[1].version++ },
    (s: typeof inventory) => { s.binders[0].slots[0].version++ },
    (s: typeof inventory) => { s.binders[0].slots[1].version++ },
    (s: typeof inventory) => { s.binders[0].slots[0].target = { kind: "pokemon", pokemonId: 25 } },
    (s: typeof inventory) => { s.binders[0].layoutRevision++ },
    (s: typeof inventory) => { s.collections[0].version++ },
    (s: typeof inventory) => { s.items[1].ownerUserId = "foreign" },
  ]) { const changed = structuredClone(inventory); mutate(changed); assert.throws(() => projectSlotIntent(changed, intent, resolve)) }
})

for (const provider of [{ kind: "known", id: "psa" }, { kind: "custom", name: "Synthetic custom provider" }] as const) test(`exact graded ${provider.kind} placement preserves every private field`, () => {
  const { inventory, resolve } = setup()
  const item = inventory.items.find(i => i.id === "unassigned-grade")!
  item.grading = { provider, grade: "09.5", scale: "Synthetic scale", designation: "Synthetic qualifier", subgrades: [{ name: "Centering", grade: "09" }], certificate: "PRIVATE-CERT", holder: "Synthetic holder", label: { variant: "PRIVATE-LABEL", assetIds: ["PRIVATE-ASSET"] } }
  item.acquiredAt = "2026-01-02T00:00:00Z"
  const before = structuredClone(inventory)
  const assign = prepareInventoryAction(inventory, { kind: "place", itemId: item.id, collectionId: inventory.collections[0].id, slotId: "slot-e" }, context, resolve)
  assert.deepEqual(assign.preview.items, before.items)
  for (const mutate of [
    (s: typeof inventory) => { s.items.find(i => i.id === item.id)!.version++ },
    (s: typeof inventory) => { s.inventoryRevision++ },
    (s: typeof inventory) => { s.binders[0].slots.find(s => s.id === "slot-e")!.version++ },
  ]) { const stale = structuredClone(inventory); mutate(stale); assert.throws(() => projectSlotIntent(stale, assign.intent, resolve)) }
  assert.deepEqual(assign.intent.request.commands[0], { kind: "assign", selection: { kind: "existing", inventoryItemId: item.id, itemVersion: item.version }, destination: { collectionId: inventory.collections[0].id, slot: { id: "slot-e", version: 1, inventoryItemId: null, itemVersion: null, placementVersion: null } }, occupied: "cancel", fulfillWant: null })
  for (const occupied of ["unassign", "swap"] as const) {
    const moved = prepareInventoryAction(assign.preview, { kind: "place", itemId: item.id, collectionId: inventory.collections[0].id, slotId: "slot-b", occupied }, context, resolve)
    assert.deepEqual(moved.preview.items, before.items)
    assert.equal(moved.preview.placements.find(p => p.inventoryItemId === "item-b")?.slotId, occupied === "swap" ? "slot-e" : undefined)
    const unassigned = prepareInventoryAction(moved.preview, { kind: "unassign", itemId: item.id }, context, resolve)
    assert.deepEqual(unassigned.preview.items, before.items)
    assert.equal(unassigned.preview.placements.some(p => p.inventoryItemId === item.id), false)
    assert.deepEqual(unassigned.preview.binders[0].slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin]), before.binders[0].slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin]))
  }
  const occupiedAssign = prepareInventoryAction(inventory, { kind: "place", itemId: item.id, collectionId: inventory.collections[0].id, slotId: "slot-a", occupied: "unassign" }, context, resolve)
  assert.deepEqual(occupiedAssign.preview.items, before.items)
  assert.equal(occupiedAssign.preview.placements.some(p => p.inventoryItemId === "item-a"), false)
  assert.throws(() => prepareInventoryAction(inventory, { kind: "removeOwned", itemId: item.id }, context, resolve), /raw-copy-required/)
  const unknown = structuredClone(inventory)
  unknown.items.find(i => i.id === item.id)!.identity = { kind: "card", cardId: "unknown" }
  assert.ok(inventoryActionDestinations(unknown, item.id, resolve).every(d => unknown.binders[0].slots.find(s => s.id === d.slot.id)!.target === null))
  assert.deepEqual(inventory, before)
})

test("selected graded move refuses reverse mismatch and fences both copies and placements", () => {
  const { inventory, resolve } = setup()
  const itemId = "item-b"
  const mismatched = inventoryActionDestinations(inventory, itemId, resolve).find(d => d.slot.id === "slot-c")!
  assert.deepEqual(inventoryOccupiedChoices(inventory, itemId, mismatched, resolve), ["unassign"])
  assert.throws(() => prepareInventoryAction(inventory, { kind: "place", itemId, collectionId: mismatched.collectionId, slotId: mismatched.slot.id, occupied: "swap" }, context, resolve))
  const { intent } = prepareInventoryAction(inventory, { kind: "place", itemId, collectionId: inventory.collections[0].id, slotId: "slot-a", occupied: "swap" }, context, resolve)
  for (const mutate of [
    (s: typeof inventory) => { s.items[0].version++ }, (s: typeof inventory) => { s.items[1].version++ },
    (s: typeof inventory) => { s.placements[0].version++ }, (s: typeof inventory) => { s.placements[1].version++ },
    (s: typeof inventory) => { s.binders[0].slots[0].version++ }, (s: typeof inventory) => { s.binders[0].slots[1].version++ },
    (s: typeof inventory) => { s.collections[0].version++ }, (s: typeof inventory) => { s.binders[0].layoutRevision++ },
  ]) { const changed = structuredClone(inventory); mutate(changed); assert.throws(() => projectSlotIntent(changed, intent, resolve)) }
  // Even asset-free grading stays outside this slice's removal UI/helper contract.
  assert.throws(() => prepareInventoryAction(inventory, { kind: "removeOwned", itemId }, context, resolve), /raw-copy-required/)
})
