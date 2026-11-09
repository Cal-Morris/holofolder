import { test } from "node:test"
import assert from "node:assert/strict"
import { captureBulkSelection, bulkSelectionState, prepareBulkLayoutIntent, savedPageSlotIds } from "@/lib/binder-bulk-editing"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"
import { syntheticSlotPickerSnapshot } from "./fixtures/slot-picker"
import { pickerCandidate } from "@/lib/slot-picker"

const context = { source: "app" as const, clientId: null, operationId: "bulk-operation", batchId: null, clientOccurredAt: null }
function setup() {
  const { inventory, cards } = syntheticSlotPickerSnapshot()
  const scope = { ownerUserId: inventory.ownerUserId, collectionId: inventory.binders[0].collectionId, slotId: null }
  const catalog = (id: string) => { const c = cards.find(c => c.id === id); return c ? pickerCandidate(c) : undefined }
  return { inventory, scope, catalog }
}

test("[A,C] after D produces [B,D,A,C] in one ordered whole-slot command", () => {
  const { inventory, scope, catalog } = setup()
  inventory.binders[0].slots = inventory.binders[0].slots.slice(0, 4)
  const selection = captureBulkSelection(inventory, scope, ["slot-c", "slot-a"])
  const original = structuredClone(inventory)
  const result = prepareBulkLayoutIntent(inventory, scope, selection, { kind: "move", destination: { kind: "after", slotId: "slot-d" } }, context, catalog)
  assert.deepEqual(result.preview.binders[0].slots.map(s => s.id), ["slot-b", "slot-d", "slot-a", "slot-c"])
  assert.equal(result.intent.request.commands.length, 1)
  assert.deepEqual(result.preview.items, inventory.items)
  assert.deepEqual(result.preview.placements, inventory.placements)
  for (const slot of result.preview.binders[0].slots) assert.deepEqual(slot, inventory.binders[0].slots.find(s => s.id === slot.id))
  assert.deepEqual(inventory, original)
})

test("selected anchors explicitly reject, adjacent selected successors resolve against remaining layout", () => {
  const { inventory, scope, catalog } = setup()
  const selected = captureBulkSelection(inventory, scope, ["slot-a", "slot-c"])
  for (const kind of ["before", "after"] as const) assert.throws(() => prepareBulkLayoutIntent(inventory, scope, selected, { kind: "move", destination: { kind, slotId: "slot-c" } }, context, catalog), /selected-anchor/)
  const result = prepareBulkLayoutIntent(inventory, scope, selected, { kind: "move", destination: { kind: "after", slotId: "slot-b" } }, context, catalog)
  assert.deepEqual(result.preview.binders[0].slots.slice(0, 4).map(s => s.id), ["slot-b", "slot-a", "slot-c", "slot-d"])
  for (const kind of ["beginning", "end"] as const) {
    const moved = prepareBulkLayoutIntent(inventory, scope, selected, { kind: "move", destination: { kind } }, context, catalog)
    assert.deepEqual((kind === "beginning" ? moved.preview.binders[0].slots.slice(0, 2) : moved.preview.binders[0].slots.slice(-2)).map(s => s.id), ["slot-a", "slot-c"])
  }
})

test("page selection excludes implicit padding and grids only repaginate stable slots", () => {
  const { inventory, scope } = setup()
  assert.deepEqual(savedPageSlotIds(inventory, scope, 1, 2, 2), ["slot-e", "slot-f", "slot-g"])
  assert.deepEqual(savedPageSlotIds(inventory, scope, 6, 1, 1), ["slot-g"])
  assert.deepEqual(savedPageSlotIds(inventory, scope, 1, 2, 3), ["slot-g"])
  assert.deepEqual(savedPageSlotIds(inventory, scope, 9, 2, 2), [])
  for (const dimensions of [[0, 2], [9, 1], [1.5, 2]]) assert.throws(() => savedPageSlotIds(inventory, scope, 0, ...dimensions as [number, number]), /grid/)
})

test("bulk insertion shifts whole layout at exact anchors, preserving target, wants and provenance", () => {
  const { inventory, scope, catalog } = setup()
  const source = { id: "synthetic-preset", version: "1" }
  inventory.binders[0].presetManifest = { source, name: "Synthetic", entries: [{ id: "entry-a", target: inventory.binders[0].slots[0].target }] }
  inventory.binders[0].slots[0].presetOrigin = { source, entryId: "entry-a" }
  inventory.binders[0].slots[0].wantedCards = [{ card_id: "synthetic-snorlax-b", card_name: "Synthetic", added_at: "2026-01-01" }]
  const selection = captureBulkSelection(inventory, scope, [])
  for (const [destination, at] of [[{ kind: "before", slotId: "slot-a" }, 0], [{ kind: "after", slotId: "slot-d" }, 4], [{ kind: "end" }, 7]] as const) {
    const result = prepareBulkLayoutIntent(inventory, scope, selection, { kind: "insert", ids: ["new-a", "new-b", "new-c", "new-d"], destination }, context, catalog)
    const slots = result.preview.binders[0].slots
    assert.deepEqual(slots.slice(at, at + 4).map(s => s.id), ["new-a", "new-b", "new-c", "new-d"])
    assert.deepEqual(slots.filter(s => !s.id.startsWith("new-")), inventory.binders[0].slots)
    assert.deepEqual(result.preview.items, inventory.items)
    assert.deepEqual(result.preview.placements, inventory.placements)
    assert.equal(result.preview.binders[0].presetManifest?.source.id, source.id)
  }
})

test("stale revisions require review and changed or missing selected copies reject the entire group", () => {
  const { inventory, scope, catalog } = setup()
  const selection = captureBulkSelection(inventory, scope, ["slot-a", "slot-c"])
  const action = { kind: "move", destination: { kind: "end" } } as const
  const old = prepareBulkLayoutIntent(inventory, scope, selection, action, context, catalog)
  const changed = structuredClone(inventory)
  changed.binders[0].layoutRevision++
  assert.equal(bulkSelectionState(changed, scope, selection), "layout-changed")
  assert.throws(() => prepareBulkLayoutIntent(changed, scope, selection, action, context, catalog), /review/)
  assert.throws(() => projectSlotIntent(changed, old.intent, catalog), /conflict/)
  const reviewed = captureBulkSelection(changed, scope, selection.slots.map(s => s.slot.id))
  assert.doesNotThrow(() => prepareBulkLayoutIntent(changed, scope, reviewed, action, context, catalog))
  for (const mutate of [
    () => { changed.binders[0].slots[0].inventoryItemId = "different-copy" },
    () => { changed.binders[0].slots.splice(0, 1) },
    () => { changed.items[0].version++ },
    () => { changed.placements[0].version++ },
    () => { changed.binders[0].slots[0].wantedCards = [{ card_id: "synthetic", card_name: "Synthetic", added_at: "2026-01-01" }] },
  ]) {
    Object.assign(changed, structuredClone(inventory)); mutate()
    assert.equal(bulkSelectionState(changed, scope, selection), "selection-changed")
    assert.throws(() => prepareBulkLayoutIntent(changed, scope, selection, action, context, catalog), /selection/)
  }
})

test("bounds reject atomically without splitting, invalid selections and IDs never partially apply", () => {
  const { inventory, scope, catalog } = setup()
  const selection = captureBulkSelection(inventory, scope, [])
  for (const ids of [[], ["duplicate", "duplicate"], ["slot-a"], Array.from({ length: 257 }, (_, i) => `new-${i}`)])
    assert.throws(() => prepareBulkLayoutIntent(inventory, scope, selection, { kind: "insert", ids, destination: { kind: "end" } }, context, catalog))
  assert.throws(() => captureBulkSelection(inventory, scope, ["slot-a", "missing"]), /selection/)
  assert.throws(() => captureBulkSelection(inventory, scope, ["slot-a", "slot-a"]), /selection/)
  assert.throws(() => captureBulkSelection(inventory, { ...scope, ownerUserId: "wrong" }, []), /scope/)
  const free = inventory.binders[0].slots[6]
  inventory.binders[0].slots.push(...Array.from({ length: 4096 - 7 }, (_, i) => ({ ...free, id: `capacity-${i}` })))
  assert.throws(() => captureBulkSelection(inventory, scope, inventory.binders[0].slots.slice(0, 257).map(s => s.id)), /limit/)
  assert.throws(() => prepareBulkLayoutIntent(inventory, scope, captureBulkSelection(inventory, scope, []), { kind: "insert", ids: ["too-many"], destination: { kind: "end" } }, context, catalog), /capacity/)
})

test("group moves preserve wants and preset provenance, adjacency is a true no-op", () => {
  const { inventory, scope, catalog } = setup()
  const source = { id: "synthetic-preset", version: "1" }
  inventory.binders[0].presetManifest = { source, name: "Synthetic", entries: [{ id: "entry-a", target: inventory.binders[0].slots[0].target }] }
  inventory.binders[0].slots[0].presetOrigin = { source, entryId: "entry-a" }
  inventory.binders[0].slots[0].wantedCards = [{ card_id: "synthetic-snorlax-b", card_name: "Synthetic", added_at: "2026-01-01" }]
  const selection = captureBulkSelection(inventory, scope, ["slot-a", "slot-c"])
  const moved = prepareBulkLayoutIntent(inventory, scope, selection, { kind: "move", destination: { kind: "end" } }, context, catalog)
  assert.deepEqual(moved.preview.binders[0].slots.slice(-2), [inventory.binders[0].slots[0], inventory.binders[0].slots[2]])
  assert.deepEqual(moved.preview.binders[0].presetManifest, inventory.binders[0].presetManifest)
  const adjacent = captureBulkSelection(inventory, scope, ["slot-a", "slot-b"])
  const unchanged = prepareBulkLayoutIntent(inventory, scope, adjacent, { kind: "move", destination: { kind: "before", slotId: "slot-c" } }, context, catalog)
  assert.deepEqual(unchanged.preview, inventory)
})

test("the exact 256-slot bound is accepted as one command, including whole-page grids", () => {
  const { inventory, scope, catalog } = setup()
  const inserted = prepareBulkLayoutIntent(inventory, scope, captureBulkSelection(inventory, scope, []), {
    kind: "insert", ids: Array.from({ length: 256 }, (_, i) => `synthetic-insert-${i}`), destination: { kind: "beginning" },
  }, context, catalog)
  const selection = captureBulkSelection(inserted.preview, scope, inserted.preview.binders[0].slots.slice(0, 256).map(s => s.id))
  assert.equal(savedPageSlotIds(inserted.preview, scope, 0, 8, 8).length, 64)
  const moved = prepareBulkLayoutIntent(inserted.preview, scope, selection, { kind: "move", destination: { kind: "end" } }, { ...context, operationId: "bulk-second-operation" }, catalog)
  assert.equal(moved.intent.request.commands.length, 1)
  assert.deepEqual(moved.preview.binders[0].slots.slice(-256).map(s => s.id), selection.slots.map(s => s.slot.id))
})
