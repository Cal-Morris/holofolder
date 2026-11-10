import type { OperationIntentContext } from "@/lib/domain/audit-context"
import { inventoryItemCandidate, type InventoryCatalogResolver, type InventoryIdentity, type InventorySnapshot } from "@/lib/domain/inventory"
import { matchesSlotTarget } from "@/lib/domain/binder-slots"
import type { InventoryCommand, InventoryItemRef, InventorySlotRef } from "@/lib/domain/inventory-commands"
import type { SlotLocalAcceptance } from "@/lib/binder-slot-editing"
import { parseSlotIntent, projectSlotIntent, type SlotOfflineIntent } from "@/lib/collection/slot-optimistic"

export type InventoryAction = { kind: "add"; itemId: string; identity: Extract<InventoryIdentity, { kind: "card" }> }
  | { kind: "place"; itemId: string; collectionId: string; slotId: string; occupied?: "unassign" | "swap" }
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
  if (!item) throw new Error("copy-unavailable")
  const placement = snapshot.placements.find(p => p.inventoryItemId === itemId)
  if (!placement) return { itemId, itemVersion: item.version, placement: null }
  const slot = snapshot.binders.find(b => b.collectionId === placement.collectionId)?.slots.find(s => s.id === placement.slotId)
  if (!slot || slot.inventoryItemId !== itemId) throw new Error("placement-unavailable")
  return { itemId, itemVersion: item.version, placement: { collectionId: placement.collectionId,
    slot: { id: slot.id, version: slot.version, inventoryItemId: itemId, itemVersion: item.version, placementVersion: placement.version } } }
}

/** Explicit compatible stable slots, excluding the selected copy. A listed occupied slot still needs a decision. */
export function inventoryActionDestinations(snapshot: InventorySnapshot, itemId: string, catalog: InventoryCatalogResolver): InventorySlotRef[] {
  inventoryActionItemRef(snapshot, itemId)
  const item = snapshot.items.find(i => i.id === itemId)!
  const candidate = inventoryItemCandidate(item, catalog)
  return snapshot.binders.flatMap(b => b.slots.filter(s => s.inventoryItemId !== itemId && s.ownerUserId === snapshot.ownerUserId
    && snapshot.collections.some(c => c.id === b.collectionId && c.ownerUserId === snapshot.ownerUserId)
    && (s.target === null || candidate && matchesSlotTarget(candidate, s.target)))
    .flatMap(s => {
      const occupant = s.inventoryItemId === null ? null : snapshot.items.find(i => i.id === s.inventoryItemId && i.ownerUserId === snapshot.ownerUserId)
      const placement = snapshot.placements.find(p => p.inventoryItemId === s.inventoryItemId && p.collectionId === b.collectionId && p.slotId === s.id)
      if (s.inventoryItemId !== null && (!occupant || !placement)) return []
      return [{ collectionId: b.collectionId, slot: { id: s.id, version: s.version, inventoryItemId: s.inventoryItemId,
        itemVersion: occupant?.version ?? null, placementVersion: placement?.version ?? null } }]
    }))
}

/** Existing command parser and atomic projector own invariants; this adds no mutation protocol. */
export function prepareInventoryAction(snapshot: InventorySnapshot, action: InventoryAction, context: OperationIntentContext, catalog: InventoryCatalogResolver) {
  let command: InventoryCommand
  const collections = new Set<string>()
  if (action.kind === "add") {
    if (!catalog(action.identity.cardId)) throw new Error("catalog-selection-required")
    command = { ...action, grading: null, acquiredAt: null }
  } else {
    // Placement commands never rewrite the item. Removal cannot safely recover private label assets.
    if (action.kind === "removeOwned" && snapshot.items.find(i => i.id === action.itemId)?.grading !== null) throw new Error("raw-copy-required")
    const item = inventoryActionItemRef(snapshot, action.itemId)
    if (item.placement) collections.add(item.placement.collectionId)
    if (action.kind === "place") {
      const destination = inventoryActionDestinations(snapshot, action.itemId, catalog).find(d => d.collectionId === action.collectionId && d.slot.id === action.slotId)
      if (!destination) throw new Error("compatible-slot-required")
      const occupied = destination.slot.inventoryItemId !== null
      if (occupied ? !action.occupied : action.occupied) throw new Error("explicit-occupied-decision-required")
      if (!item.placement && action.occupied === "swap") throw new Error("swap-source-required")
      collections.add(destination.collectionId)
      command = item.placement ? { kind: "move", item, destination, occupied: action.occupied ?? "cancel", fulfillWant: null }
        : { kind: "assign", selection: { kind: "existing", inventoryItemId: item.itemId, itemVersion: item.itemVersion }, destination, occupied: action.occupied === "unassign" ? "unassign" : "cancel", fulfillWant: null }
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
  return { intent, preview: projectSlotIntent(snapshot, intent, catalog), before: structuredClone(snapshot) }
}

/** Offer only decisions accepted by the existing atomic projector, including reverse target matching. */
export function inventoryOccupiedChoices(snapshot: InventorySnapshot, itemId: string, destination: InventorySlotRef, catalog: InventoryCatalogResolver): ("unassign" | "swap")[] {
  if (destination.slot.inventoryItemId === null) return []
  return (["unassign", "swap"] as const).filter(occupied => {
    try {
      prepareInventoryAction(snapshot, { kind: "place", itemId, collectionId: destination.collectionId, slotId: destination.slot.id, occupied },
        { source: "app", clientId: null, operationId: "inventory-decision-preview", batchId: null, clientOccurredAt: null }, catalog)
      return true
    } catch { return false }
  })
}
