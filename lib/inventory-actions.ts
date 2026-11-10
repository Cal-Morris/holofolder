import type { OperationIntentContext } from "@/lib/domain/audit-context"
import { inventoryItemCandidate, type InventoryCatalogResolver, type InventoryIdentity, type InventorySnapshot } from "@/lib/domain/inventory"
import { matchesSlotTarget } from "@/lib/domain/binder-slots"
import type { InventoryCommand, InventoryItemRef, InventorySlotRef } from "@/lib/domain/inventory-commands"
import type { SlotLocalAcceptance } from "@/lib/binder-slot-editing"
import { parseSlotIntent, projectSlotIntent, type SlotOfflineIntent } from "@/lib/collection/slot-optimistic"

export type InventoryAction = { kind: "add"; itemId: string; identity: Extract<InventoryIdentity, { kind: "card" }> }
  | { kind: "place"; itemId: string; collectionId: string; slotId: string }
  | { kind: "unassign" | "removeOwned"; itemId: string }
export interface InventoryOwnershipBinding {
  snapshot: InventorySnapshot
  catalog: InventoryCatalogResolver
  available: boolean
  receive: (intent: Extract<SlotOfflineIntent, { kind: "inventory" }>, catalog: InventoryCatalogResolver) => Promise<SlotLocalAcceptance>
}

/** Resolve the complete private copy, not the public browse row or a target placeholder. */
export function inventoryActionItemRef(snapshot: InventorySnapshot, itemId: string): InventoryItemRef {
  const item = snapshot.items.find(i => i.id === itemId && i.ownerUserId === snapshot.ownerUserId)
  if (!item || item.grading !== null) throw new Error("raw-copy-required")
  const placement = snapshot.placements.find(p => p.inventoryItemId === itemId)
  if (!placement) return { itemId, itemVersion: item.version, placement: null }
  const slot = snapshot.binders.find(b => b.collectionId === placement.collectionId)?.slots.find(s => s.id === placement.slotId)
  if (!slot || slot.inventoryItemId !== itemId) throw new Error("placement-unavailable")
  return { itemId, itemVersion: item.version, placement: { collectionId: placement.collectionId,
    slot: { id: slot.id, version: slot.version, inventoryItemId: itemId, itemVersion: item.version, placementVersion: placement.version } } }
}

/** Only explicit empty, compatible stable slots. Unknown metadata cannot satisfy a constrained target. */
export function inventoryActionDestinations(snapshot: InventorySnapshot, itemId: string, catalog: InventoryCatalogResolver): InventorySlotRef[] {
  inventoryActionItemRef(snapshot, itemId)
  const item = snapshot.items.find(i => i.id === itemId)!
  const candidate = inventoryItemCandidate(item, catalog)
  return snapshot.binders.flatMap(b => b.slots.filter(s => s.inventoryItemId === null && s.ownerUserId === snapshot.ownerUserId
    && snapshot.collections.some(c => c.id === b.collectionId && c.ownerUserId === snapshot.ownerUserId)
    && (s.target === null || candidate && matchesSlotTarget(candidate, s.target)))
    .map(s => ({ collectionId: b.collectionId, slot: { id: s.id, version: s.version, inventoryItemId: null, itemVersion: null, placementVersion: null } })))
}

/** Existing command parser and atomic projector own invariants; this adds no mutation protocol. */
export function prepareInventoryAction(snapshot: InventorySnapshot, action: InventoryAction, context: OperationIntentContext, catalog: InventoryCatalogResolver) {
  let command: InventoryCommand
  const collections = new Set<string>()
  if (action.kind === "add") {
    if (!catalog(action.identity.cardId)) throw new Error("catalog-selection-required")
    command = { ...action, grading: null, acquiredAt: null }
  } else {
    const item = inventoryActionItemRef(snapshot, action.itemId)
    if (item.placement) collections.add(item.placement.collectionId)
    if (action.kind === "place") {
      const destination = inventoryActionDestinations(snapshot, action.itemId, catalog).find(d => d.collectionId === action.collectionId && d.slot.id === action.slotId)
      if (!destination) throw new Error("compatible-empty-slot-required")
      collections.add(destination.collectionId)
      command = item.placement ? { kind: "move", item, destination, occupied: "cancel", fulfillWant: null }
        : { kind: "assign", selection: { kind: "existing", inventoryItemId: item.itemId, itemVersion: item.itemVersion }, destination, occupied: "cancel", fulfillWant: null }
    } else {
      if (action.kind === "unassign" && !item.placement) throw new Error("already-unassigned")
      command = { kind: action.kind, item }
    }
  }
  const intent = parseSlotIntent({ kind: "inventory", context, request: { operationId: context.operationId, inventoryRevision: snapshot.inventoryRevision,
    collections: [...collections].map(collectionId => {
      const collection = snapshot.collections.find(c => c.id === collectionId)!
      const binder = snapshot.binders.find(b => b.collectionId === collectionId)!
      return { collectionId, version: collection.version, layoutRevision: binder.layoutRevision }
    }), commands: [command] } })
  return { intent, preview: projectSlotIntent(snapshot, intent, catalog) }
}
