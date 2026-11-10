import { test } from "node:test"
import assert from "node:assert/strict"
import { syntheticSlotPickerSnapshot } from "./fixtures/slot-picker"
import { pickerCandidate } from "../lib/slot-picker"
import { inventoryActionDestinations, prepareInventoryAction } from "../lib/inventory-actions"
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
  const destination = inventoryActionDestinations(inventory, itemId, resolve)[0]
  assert.ok(destination)
  const planned = prepareInventoryAction(inventory, { kind: "place", itemId, collectionId: destination.collectionId, slotId: destination.slot.id }, context, resolve)
  assert.equal(planned.intent.request.commands[0].kind, "assign")
  assert.equal(planned.preview.placements.find(p => p.inventoryItemId === itemId)?.slotId, destination.slot.id)
  const second = inventoryActionDestinations(planned.preview, itemId, resolve)[0]
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
  const d = inventoryActionDestinations(inventory, "unassigned-b", resolve)[0]
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
    const { preview } = prepareInventoryAction(inventory, { kind: "place", itemId: item.id, collectionId: d.collectionId, slotId: d.slot.id }, context, resolve)
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
