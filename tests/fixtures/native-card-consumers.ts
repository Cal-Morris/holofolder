import type { NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { completeInventoryBrowseFixture, inventoryProjectionFixture, inventoryProjectionCatalog } from "./inventory-browse"

// Synthetic owner, cards, copies and wants. No live provider or authority evidence.
export async function nativeConsumerFixture(unknownWant = false) {
  const snapshot = inventoryProjectionFixture()
  const ids = new Map(snapshot.collections.map((c, i) => [c.id, `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`]))
  snapshot.collections.forEach(c => { c.id = ids.get(c.id)! })
  snapshot.binders.forEach(b => { b.collectionId = ids.get(b.collectionId)!; b.slots.forEach(s => { s.collectionId = b.collectionId }) })
  snapshot.placements.forEach(p => { p.collectionId = ids.get(p.collectionId)! })
  const want = { card_id: "synthetic-trainer", card_name: "Synthetic Trainer", card_language: "en" as const, card_finish: "normal" as const, added_at: "2026-11-09T00:00:00Z" }
  snapshot.binders[0].slots[0].target = null
  snapshot.binders[0].slots[0].wantedCards = [unknownWant ? { ...want, card_id: "synthetic-unknown" } : want, want]
  snapshot.binders[0].slots[1].wantedCards = [want]
  const scope = { accountUserId: "synthetic-actor", ownerUserId: snapshot.ownerUserId, sessionId: "synthetic-session" }
  const read = { scope, catalog: inventoryProjectionCatalog, layouts: [], evidence: { kind: "complete" as const, snapshot: await completeInventoryBrowseFixture(snapshot) } }
  const binding: NativeConsumerBinding = { scope, read, openCard: () => {}, editingAvailable: true, admit: () => ({ scope, read, context: { source: "app", clientId: null, operationId: "synthetic-operation", batchId: null, clientOccurredAt: null }, receive: () => {} }) }
  return { snapshot, binding }
}
