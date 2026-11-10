import type { InventorySnapshot } from "@/lib/domain/inventory"
import type { InventoryBrowseLocation, InventoryLayoutEvidence, InventoryLocationIntent } from "@/lib/domain/inventory-browse"

type SlotPlace = Omit<Extract<InventoryBrowseLocation, { kind: "assigned" }>, "kind" | "intent">

/** Read the current full order each time. Positions/pages are presentation, never navigation identity. */
function locateSlot(snapshot: InventorySnapshot, collectionId: string, isSlot: (slot: InventorySnapshot["binders"][number]["slots"][number]) => boolean,
  layouts: readonly InventoryLayoutEvidence[], complete: boolean): SlotPlace | null {
  const collection = snapshot.collections.find(c => c.id === collectionId)
  const binder = snapshot.binders.find(b => b.collectionId === collectionId)
  const index = binder?.slots.findIndex(isSlot) ?? -1
  if (!collection || index < 0 || !binder) return null
  const matches = layouts.filter(l => l.collectionId === collection.id && l.layoutRevision === binder.layoutRevision)
  const layout = matches.length === 1 ? matches[0] : undefined
  const known = complete && layout && [layout.rows, layout.cols].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 8)
  const capacity = known ? layout.rows * layout.cols : null
  const slot = capacity ? index % capacity + 1 : null
  return { collectionName: collection.name, position: complete ? index + 1 : null, page: capacity ? Math.floor(index / capacity) + 1 : null,
    slot, row: slot && known ? Math.floor((slot - 1) / layout.cols) + 1 : null,
    column: slot && known ? (slot - 1) % layout.cols + 1 : null }
}

export function resolveInventoryLocation(snapshot: InventorySnapshot, itemId: string,
  layouts: readonly InventoryLayoutEvidence[], complete = true): InventoryBrowseLocation {
  if (!snapshot.items.some(item => item.id === itemId)) return { kind: "missing" }
  const placement = snapshot.placements.find(p => p.inventoryItemId === itemId)
  if (!placement) return { kind: complete ? "unassigned" : "unknown" }
  const place = locateSlot(snapshot, placement.collectionId, s => s.id === placement.slotId && s.inventoryItemId === itemId, layouts, complete)
  if (!place) return { kind: "unknown" }
  return { kind: "assigned", intent: { collectionId: placement.collectionId, slotId: placement.slotId, itemId }, ...place }
}

/** Readable binder/page/slot for a slot that holds wants rather than a copy. */
export function slotLocationLabel(snapshot: InventorySnapshot, collectionId: string, slotId: string,
  layouts: readonly InventoryLayoutEvidence[], complete = true): string {
  const place = locateSlot(snapshot, collectionId, s => s.id === slotId, layouts, complete)
  return place ? placeLabel(place) : "Location unavailable"
}

/** Host must call this against its latest scoped evidence before navigating, including after a move. */
export function resolveInventoryLocationIntent(snapshot: InventorySnapshot, intent: InventoryLocationIntent,
  layouts: readonly InventoryLayoutEvidence[], complete = true): InventoryBrowseLocation {
  return resolveInventoryLocation(snapshot, intent.itemId, layouts, complete)
}

function placeLabel(place: SlotPlace) {
  return `${place.collectionName} · ${place.page === null
    ? place.position === null ? "Slot location unavailable" : `Position ${place.position} · layout unknown` : `Page ${place.page} · Slot ${place.slot}`}`
}

export function inventoryLocationLabel(location: InventoryBrowseLocation): string {
  switch (location.kind) {
    case "missing": return "Copy no longer available"
    case "unknown": return "Location unavailable"
    case "unassigned": return "Unassigned"
    case "assigned": return placeLabel(location)
  }
}
