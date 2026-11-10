import { test } from "node:test"
import assert from "node:assert/strict"
import { parseInventoryCommand } from "../lib/server/operations/inventory"

const request = { operationId: "synthetic-inventory-001", inventoryRevision: 0, collections: [],
  commands: [{ kind: "add", itemId: "synthetic-copy", identity: { kind: "card", cardId: "synthetic-card" }, grading: null, acquiredAt: null }] }
test("strict inventory command preserves copy identity and rejects spoofed authority/extra keys", () => {
  assert.deepEqual(parseInventoryCommand(request), request)
  const copy = parseInventoryCommand(request)
  copy.commands.length = 0
  assert.equal(request.commands.length, 1)
  for (const bad of [{ ...request, ownerId: "spoof" }, { ...request, context: {} }, { ...request, commands: [] },
    { ...request, commands: [{ ...request.commands[0], certificate: "clone" }] },
    { ...request, commands: [{ ...request.commands[0], grading: {} }] },
    { ...request, commands: Array(101).fill(request.commands[0]) }]) assert.throws(() => parseInventoryCommand(bad))
})

test("bulk move preview consumes accepted plans, retains explicit pairing and rejects the whole mixed/occupied batch", async () => {
  const { previewInventoryMoves } = await import("../lib/inventory-plans")
  const snapshot = {
    ownerUserId: "owner", inventoryRevision: 0,
    items: [{ id: "a", ownerUserId: "owner", identity: { kind: "pokemon" as const, pokemonId: 25 }, grading: null, acquiredAt: null, version: 0 }],
    placements: [{ inventoryItemId: "a", collectionId: "one", slotId: "from", version: 0 }],
    collections: ["one", "two"].map(id => ({ id, ownerUserId: "owner", name: id, kind: "binder" as const, defaultPresentation: "binder" as const, version: 0 })),
    binders: ["one", "two"].map((collectionId, index) => ({ collectionId, ownerUserId: "owner", layoutRevision: 0, presetManifest: null,
      slots: [{ id: index ? "to" : "from", collectionId, ownerUserId: "owner", target: null, inventoryItemId: index ? null : "a", status: index ? null : "collected" as const, wantedCards: [], version: 0, presetOrigin: null }] })),
  }
  const context = { actor: { kind: "unknown" as const }, source: "app" as const, clientId: null, operationId: "synthetic-preview", batchId: null, clientOccurredAt: null, affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] } }
  const move = { inventoryItemId: "a", itemVersion: 0, placementVersion: 0, source: { collectionId: "one", slotId: "from", layoutRevision: 0, slotVersion: 0 }, destination: { collectionId: "two", slotId: "to", layoutRevision: 0, slotVersion: 0 }, occupied: "cancel" as const }
  const input = { inventoryRevision: 0, context, moves: [move] }
  const original = structuredClone(snapshot)
  assert.deepEqual(previewInventoryMoves(snapshot, input, () => undefined), { ok: true, pairings: [{ inventoryItemId: "a", sourceSlotId: "from", destinationSlotId: "to", displacedInventoryItemId: null, occupied: "cancel" }] })
  assert.deepEqual(snapshot, original)
  assert.equal(previewInventoryMoves(snapshot, { ...input, moves: [move, move] }, () => undefined).ok, false)
  assert.equal(previewInventoryMoves(snapshot, { ...input, moves: [{ ...move, destination: { ...move.destination, collectionId: "foreign" } }] }, () => undefined).ok, false)
})

test("internal binding preserves trusted original intent, rejects unknown actors and cannot accept body authority", async () => {
  const { executeInventoryCommand } = await import("../lib/server/operations/inventory")
  const owner = "03830000-0000-4000-8000-000000000001"
  const context = { actor: { kind: "user" as const, userId: owner }, source: "mcp" as const, clientId: "synthetic-client", operationId: request.operationId,
    batchId: "synthetic-batch", clientOccurredAt: "2020-01-01T00:00:00Z", affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] } }
  let calls = 0
  const result = await executeInventoryCommand(async (actor, resolvedOwner, body, intent) => {
    calls++
    assert.equal(actor, owner); assert.equal(resolvedOwner, owner)
    assert.deepEqual(body, request)
    assert.deepEqual(intent, { source: "mcp", clientId: "synthetic-client", batchId: "synthetic-batch", clientOccurredAt: "2020-01-01T00:00:00Z" })
    return "synthetic-result"
  }, owner, parseInventoryCommand(request), context)
  assert.equal(result, "synthetic-result")
  await assert.rejects(executeInventoryCommand(async () => { calls++; }, owner, parseInventoryCommand(request), { ...context, actor: { kind: "unknown" } }))
  assert.equal(calls, 1)
})
