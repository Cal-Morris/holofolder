import { test } from "node:test"
import assert from "node:assert/strict"
import { captureScanDestination, mapScanCells, prepareScanDraft, scanDestinations } from "@/lib/scan-destinations"
import { syntheticSlotPickerSnapshot } from "./fixtures/slot-picker"
import { pickerCandidate } from "@/lib/slot-picker"

function setup() {
  const seed = syntheticSlotPickerSnapshot()
  const snapshot = seed.inventory
  const binder = snapshot.binders[0]
  // Synthetic empty repeated targets, an exact Trainer target and free cells.
  snapshot.items = []; snapshot.placements = []
  binder.slots.forEach(s => { s.inventoryItemId = null; s.status = null })
  const view = { ownerUserId: snapshot.ownerUserId, collectionId: binder.collectionId, sessionId: "session-a", rows: 2, cols: 4, pageSlotIds: binder.slots.map(s => s.id) }
  const catalog = (id: string) => { const card = seed.cards.find(c => c.id === id); return card ? pickerCandidate(card) : undefined }
  const capture = captureScanDestination(snapshot, view)
  const context = { source: "app" as const, clientId: null, operationId: "synthetic-scan-operation", batchId: null, clientOccurredAt: null }
  return { ...seed, snapshot, binder, view, catalog, capture, context }
}

test("maps shuffled detection cells to captured row/column IDs, occupancy alone has no card", () => {
  const s = setup()
  const mapped = mapScanCells(s.capture, [{ index: 5, row: 1, col: 1, occupied: true }, { index: 0, row: 0, col: 0, occupied: true }])
  assert.deepEqual(mapped.map(c => c.slotId), ["slot-a", "slot-f"])
  assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture, [], s.context, s.catalog), /unconfirmed/)
  assert.equal(s.snapshot.items.length, 0)
  assert.throws(() => mapScanCells(s.capture, [{ index: 0, row: 1, col: 0, occupied: true }]), /cell/)
})

test("rejects reordered, revision, grid, page and session/owner changes rather than positional retargeting", () => {
  for (const change of ["order", "revision", "grid", "page", "session", "owner", "collection"] as const) {
    const s = setup()
    if (change === "order") s.binder.slots.reverse()
    if (change === "revision") s.binder.layoutRevision++
    if (change === "grid") s.view.cols = 3
    if (change === "page") s.view.pageSlotIds.reverse()
    if (change === "session") s.view.sessionId = "session-b"
    if (change === "owner") s.view.ownerUserId = "other-owner"
    if (change === "collection") s.view.collectionId = "other-collection"
    assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture, [{ cellIndex: 0, slotId: "slot-a", card: s.cards[0], copy: "raw" }], s.context, s.catalog), /scan-stale/)
  }
})

test("non-Pokémon Energy/supporter accept only explicit compatible targets/free slots", () => {
  const s = setup(), trainer = s.cards[2], energy = s.cards[3]
  assert.deepEqual(scanDestinations(s.snapshot, s.view, trainer).map(s => s.id), ["slot-c", "slot-d", "slot-f", "slot-g"])
  assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture, [{ cellIndex: 0, slotId: "slot-a", card: energy, copy: "raw" }], s.context, s.catalog), /target-mismatch/)
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, [{ cellIndex: 0, slotId: "slot-g", card: trainer, copy: "raw" }], s.context, s.catalog)
  assert.equal(result.preview.binders[0].slots.find(s => s.id === "slot-g")!.inventoryItemId !== null, true)
  assert.equal(s.snapshot.items.length, 0)
  assert.equal(result.preview.items.at(-1)!.grading, null)
})

test("repeated species require selected destination and batch cannot duplicate cells or slots", () => {
  const s = setup(), card = s.cards[0]
  const choice = { cellIndex: 1, slotId: "slot-b", card, copy: "raw" as const }
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, [choice], s.context, s.catalog)
  assert.equal(result.preview.binders[0].slots[0].inventoryItemId, null)
  assert.notEqual(result.preview.binders[0].slots[1].inventoryItemId, null)
  assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture, [{ ...choice, slotId: "" }], s.context, s.catalog))
  assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture, [choice, choice], s.context, s.catalog), /duplicate/)
})

test("raw creation beside graded-only eligible copies stays unsupported", () => {
  const s = setup(), card = s.cards[0]
  const graded = syntheticSlotPickerSnapshot().inventory.items.find(i => i.grading)!
  s.snapshot.items.push({ ...graded, id: "graded-copy", identity: { kind: "card", cardId: card.id, language: "en" } })
  assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture,
    [{ cellIndex: 0, slotId: "slot-a", card, copy: "raw" }], s.context, s.catalog), /raw-creation-unavailable/)
  assert.equal(s.snapshot.placements.length, 0)
})

test("two confirmed duplicate printings get distinct raw item IDs in one batch", () => {
  const s = setup()
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, [
    { cellIndex: 0, slotId: "slot-a", card: s.cards[0], copy: "raw" },
    { cellIndex: 1, slotId: "slot-b", card: s.cards[0], copy: "raw" },
  ], s.context, s.catalog)
  assert.equal(result.preview.placements.length, 2)
  assert.equal(new Set(result.preview.placements.map(p => p.inventoryItemId)).size, 2)
  assert.equal(result.preview.inventoryRevision, s.snapshot.inventoryRevision + 1)
})

test("cached identity reuses exact eligible raw copy, preserves metadata and never steals placement", () => {
  const s = setup(), card = s.cards[0]
  s.snapshot.items.push({ id: "cached-raw", ownerUserId: s.snapshot.ownerUserId, identity: { kind: "card", cardId: card.id, language: "en" }, grading: null, acquiredAt: "2026-01-01T00:00:00.000Z", version: 7 })
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, [{ cellIndex: 1, slotId: "slot-b", card, copy: "raw" }], s.context, s.catalog)
  assert.equal(result.preview.placements[0].inventoryItemId, "cached-raw")
  assert.equal(result.preview.items[0].acquiredAt, "2026-01-01T00:00:00.000Z")
  assert.deepEqual(result.intent.request.commands.map(c => c.kind), ["assign"])
})

test("language and finish constraints need explicit compatible catalog evidence", () => {
  const s = setup(), card = { ...s.cards[2], aliasIds: ["trainer-alias"] }
  s.binder.slots[5].target = { kind: "card", cardId: "trainer-alias", language: "en", finish: "holo" }
  assert.equal(scanDestinations(s.snapshot, s.view, card).some(s => s.id === "slot-f"), false)
  assert.equal(scanDestinations(s.snapshot, s.view, card, "normal").some(s => s.id === "slot-f"), false)
  assert.equal(scanDestinations(s.snapshot, s.view, card, "holo").some(s => s.id === "slot-f"), true)
  assert.equal(scanDestinations(s.snapshot, s.view, { ...card, language: "ja" }, "holo").some(s => s.id === "slot-f"), false)
})

test("empty and filtered page orders cannot masquerade as a captured actual grid", () => {
  const s = setup()
  assert.throws(() => captureScanDestination(s.snapshot, { ...s.view, pageSlotIds: [] }), /scan-stale/)
  assert.throws(() => captureScanDestination(s.snapshot, { ...s.view, pageSlotIds: ["slot-a", "slot-c"] }), /scan-stale/)
  assert.throws(() => mapScanCells(s.capture, [{ index: 0, row: 0, col: 0, occupied: true }, { index: 0, row: 0, col: 0, occupied: true }]), /invalid-scan-cell/)
})

test("explicit recorded graded copy retains exact ID and all private grading fields", () => {
  const s = setup(), card = s.cards[0]
  const grading = { provider: { kind: "known" as const, id: "ace" as const }, grade: "9", scale: null, designation: null, subgrades: [], certificate: "SYNTHETIC-CERT", holder: null, label: { variant: "SYNTHETIC-LABEL", assetIds: ["synthetic-private-asset"] } }
  s.snapshot.items.push(...["copy-a", "copy-b"].map(id => ({ id, ownerUserId: s.snapshot.ownerUserId, identity: { kind: "card" as const, cardId: card.id, language: "en" as const }, grading, acquiredAt: null, version: 3 })))
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, [{ cellIndex: 0, slotId: "slot-b", card, copy: { inventoryItemId: "copy-b", itemVersion: 3 } }], s.context, s.catalog)
  assert.equal(result.preview.placements[0].inventoryItemId, "copy-b")
  assert.deepEqual(result.preview.items.find(i => i.id === "copy-b")!.grading, grading)
  assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture, [{ cellIndex: 0, slotId: "slot-b", card, copy: { inventoryItemId: "copy-b", itemVersion: 2 } }], s.context, s.catalog), /copy-choice-required/)
})
