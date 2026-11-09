import { test } from "node:test"
import assert from "node:assert/strict"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"
import type { SlotOfflineIntent } from "@/lib/collection/slot-optimistic"
import type { InventorySnapshot, GradingRecord } from "@/lib/domain/inventory"
import type { InventoryCommand, InventoryItemRef, InventorySlotRef } from "@/lib/domain/inventory-commands"

// Synthetic copies, certificates, catalog identities and asset IDs only.
const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]
const grade: GradingRecord = { provider: { kind: "known", id: "psa" }, grade: "10", scale: null, designation: null, subgrades: [], certificate: "synthetic-cert", holder: null, label: { variant: null, assetIds: ["synthetic-private-asset"] } }
function state(): InventorySnapshot {
  return { ownerUserId: "synthetic-owner", inventoryRevision: 7,
    items: ["graded", "raw"].map(id => ({ id, ownerUserId: "synthetic-owner", identity: { kind: "card", cardId: "synthetic-card" }, grading: id === "graded" ? grade : null, acquiredAt: "2026-01-01T00:00:00Z", version: 2 })),
    placements: [{ inventoryItemId: "graded", collectionId: ids[0], slotId: "slot-a", version: 4 }],
    collections: ids.map(id => ({ id, ownerUserId: "synthetic-owner", name: "Synthetic", kind: "binder", defaultPresentation: "binder", version: 3 })),
    binders: ids.map((collectionId, i) => ({ ownerUserId: "synthetic-owner", collectionId, layoutRevision: 5, presetManifest: null, slots: [{ id: i ? "slot-b" : "slot-a", ownerUserId: "synthetic-owner", collectionId, version: 6, inventoryItemId: i ? null : "graded", status: i ? null : "collected", wantedCards: [], target: null, presetOrigin: null }] })),
  }
}
function ref(s: InventorySnapshot, index: number): InventorySlotRef {
  const slot = s.binders[index].slots[0], item = s.items.find(i => i.id === slot.inventoryItemId), placement = s.placements.find(p => p.inventoryItemId === item?.id)
  return { collectionId: ids[index], slot: { id: slot.id, version: slot.version, inventoryItemId: item?.id ?? null, itemVersion: item?.version ?? null, placementVersion: placement?.version ?? null } }
}
function item(s: InventorySnapshot): InventoryItemRef { return { itemId: "graded", itemVersion: 2, placement: ref(s, 0) } }
function intent(s: InventorySnapshot, commands: InventoryCommand[]): SlotOfflineIntent {
  return { kind: "inventory", request: { operationId: "synthetic-operation", inventoryRevision: s.inventoryRevision, collections: s.collections.map((c, i) => ({ collectionId: c.id, version: c.version, layoutRevision: s.binders[i].layoutRevision })), commands },
    context: { source: "app", clientId: "synthetic-device", operationId: "synthetic-operation", batchId: "synthetic-batch", clientOccurredAt: "2026-01-01T00:00:00Z" } }
}
const catalog = () => ({ kind: "card" as const, id: "synthetic-card", pokemonIds: [25] })
test("move/undo retain copy identity, grade/assets/acquisition and source wants; stale partner placement rejects", () => {
  const s = state(), wanted = { card_id: "synthetic-other", card_name: "Synthetic", added_at: "2026-01-01T00:00:00Z" }
  s.binders[0].slots[0].wantedCards = [wanted]
  const move = intent(s, [{ kind: "move", item: item(s), destination: ref(s, 1), occupied: "cancel", fulfillWant: null }])
  const moved = projectSlotIntent(s, move, catalog)
  assert.deepEqual(moved.items[0], s.items[0]); assert.deepEqual(moved.binders[0].slots[0].wantedCards, [wanted])
  assert.deepEqual(moved.placements[0], { inventoryItemId: "graded", collectionId: ids[1], slotId: "slot-b", version: 5 })
  assert.throws(() => projectSlotIntent(moved, move, catalog), /inventory-conflict/)
  const undo = intent(moved, [{ kind: "move", item: { itemId: "graded", itemVersion: 2, placement: ref(moved, 1) }, destination: ref(moved, 0), occupied: "cancel", fulfillWant: null }])
  const restored = projectSlotIntent(moved, undo, catalog)
  assert.equal(restored.placements[0].slotId, "slot-a"); assert.deepEqual(restored.items, s.items)
})
test("swap is explicit, target-compatible and retains both physical copies", () => {
  const s = state(); s.binders[1].slots[0].inventoryItemId = "raw"; s.binders[1].slots[0].status = "collected"
  s.placements.push({ inventoryItemId: "raw", collectionId: ids[1], slotId: "slot-b", version: 1 })
  const next = projectSlotIntent(s, intent(s, [{ kind: "move", item: item(s), destination: ref(s, 1), occupied: "swap", fulfillWant: null }]), catalog)
  assert.deepEqual(next.items, s.items)
  assert.equal(next.binders[0].slots[0].inventoryItemId, "raw"); assert.equal(next.binders[1].slots[0].inventoryItemId, "graded")
  assert.equal(next.placements.find(p => p.inventoryItemId === "raw")!.version, 2)
})
test("selected wants are exact, never remove another entry; a failed batch leaves its input unchanged", () => {
  const s = state(), want = { card_id: "synthetic-card", card_name: "Synthetic", added_at: "2026-01-01T00:00:00Z" }
  s.binders[1].slots[0].wantedCards = [want, { ...want, card_id: "synthetic-other" }]
  const command: InventoryCommand = { kind: "assign", selection: { kind: "existing", inventoryItemId: "raw", itemVersion: 2 }, destination: ref(s, 1), occupied: "cancel", fulfillWant: { index: 0, expected: want } }
  const before = structuredClone(s), next = projectSlotIntent(s, intent(s, [command]), catalog)
  assert.deepEqual(next.binders[1].slots[0].wantedCards.map(w => w.card_id), ["synthetic-other"])
  assert.deepEqual(s, before)
  command.fulfillWant = { index: 1, expected: want }
  assert.throws(() => projectSlotIntent(s, intent(s, [command]), catalog), /wanted-conflict/)
  assert.deepEqual(s, before)
})
test("generic selection reuses eligible unassigned raw, explicit missing copy never clones", () => {
  const s = state()
  const assign: InventoryCommand = { kind: "assign", selection: { kind: "catalog", identity: { kind: "card", cardId: "synthetic-card" }, newItemId: "stable-new-copy" }, destination: ref(s, 1), occupied: "cancel", fulfillWant: null }
  const next = projectSlotIntent(s, intent(s, [assign]), catalog)
  assert.equal(next.items.length, 2); assert.equal(next.binders[1].slots[0].inventoryItemId, "raw")
  assign.selection = { kind: "existing", inventoryItemId: "selected-missing", itemVersion: 2 }
  assert.throws(() => projectSlotIntent(s, intent(s, [assign]), catalog), /item-conflict/)
})
test("slot removal retains owned copy unassigned; explicit removeOwned alone removes ownership", () => {
  const s = state()
  const cleared = projectSlotIntent(s, intent(s, [{ kind: "removeSlots", slots: [ref(s, 0)] }]), catalog)
  assert.deepEqual(cleared.items, s.items); assert.equal(cleared.placements.length, 0); assert.equal(cleared.binders[0].slots.length, 0)
  const removed = projectSlotIntent(s, intent(s, [{ kind: "removeOwned", item: item(s) }]), catalog)
  assert.equal(removed.items.length, 1); assert.equal(removed.binders[0].slots[0].inventoryItemId, null)
  assert.equal(removed.binders[0].slots.length, 1)
})
test("independent item, placement, slot, layout and collection predicates each reject stale writes", () => {
  const s = state(), command: InventoryCommand = { kind: "move", item: item(s), destination: ref(s, 1), occupied: "cancel", fulfillWant: null }, originalIntent = intent(s, [command])
  for (const mutate of [
    (copy: InventorySnapshot) => copy.items[0].version++, (copy: InventorySnapshot) => copy.placements[0].version++,
    (copy: InventorySnapshot) => copy.binders[0].slots[0].version++, (copy: InventorySnapshot) => copy.binders[1].layoutRevision++,
    (copy: InventorySnapshot) => copy.collections[0].version++,
  ]) { const copy = structuredClone(s); mutate(copy); assert.throws(() => projectSlotIntent(copy, originalIntent, catalog), /conflict/) }
})
