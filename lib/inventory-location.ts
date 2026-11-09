import type { InventorySnapshot } from "@/lib/domain/inventory"
import type { InventoryBrowseLocation, InventoryLayoutEvidence, InventoryLocationIntent } from "@/lib/domain/inventory-browse"

/** Read the current full order each time. Positions/pages are presentation, never navigation identity. */
export function resolveInventoryLocation(snapshot: InventorySnapshot, itemId: string,
  layouts: readonly InventoryLayoutEvidence[], complete = true): InventoryBrowseLocation {
  if (!snapshot.items.some(item => item.id === itemId)) return { kind: "missing" }
  const placement = snapshot.placements.find(p => p.inventoryItemId === itemId)
  if (!placement) return { kind: complete ? "unassigned" : "unknown" }
  const collection = snapshot.collections.find(c => c.id === placement.collectionId)
  const binder = snapshot.binders.find(b => b.collectionId === placement.collectionId)
  const index = binder?.slots.findIndex(s => s.id === placement.slotId && s.inventoryItemId === itemId) ?? -1
  if (!collection || index < 0 || !binder) return { kind: "unknown" }
  const matches = layouts.filter(l => l.collectionId === collection.id && l.layoutRevision === binder.layoutRevision)
  const layout = matches.length === 1 ? matches[0] : undefined
  const known = complete && layout && [layout.rows, layout.cols].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 8)
  const capacity = known ? layout.rows * layout.cols : null
  const slot = capacity ? index % capacity + 1 : null
  return { kind: "assigned", intent: { collectionId: collection.id, slotId: placement.slotId, itemId },
    collectionName: collection.name, position: complete ? index + 1 : null, page: capacity ? Math.floor(index / capacity) + 1 : null,
    slot, row: slot && known ? Math.floor((slot - 1) / layout.cols) + 1 : null,
    column: slot && known ? (slot - 1) % layout.cols + 1 : null }
}

/** Host must call this against its latest scoped evidence before navigating, including after a move. */
export function resolveInventoryLocationIntent(snapshot: InventorySnapshot, intent: InventoryLocationIntent,
  layouts: readonly InventoryLayoutEvidence[], complete = true): InventoryBrowseLocation {
  return resolveInventoryLocation(snapshot, intent.itemId, layouts, complete)
}

export function inventoryLocationLabel(location: InventoryBrowseLocation): string {
  switch (location.kind) {
    case "missing": return "Copy no longer available"
    case "unknown": return "Location unavailable"
    case "unassigned": return "Unassigned"
    case "assigned": return `${location.collectionName} · ${location.page === null
      ? location.position === null ? "Slot location unavailable" : `Position ${location.position} · layout unknown` : `Page ${location.page} · Slot ${location.slot}`}`
  }
}
