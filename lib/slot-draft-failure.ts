const BUSY = new Set(["inactive-or-unavailable-session", "fresh-scoped-read-required", "queue-reconciliation-required", "recovery-pending", "creation-pending", "collection-deletion-pending"])
const CHANGED = new Set(["picker-scope-changed", "inactive-queue-scope", "slot-conflict", "placement-conflict", "inventory-conflict", "collection-conflict",
  "layout-conflict", "item-conflict", "wanted-conflict", "destination-occupied", "idempotency-conflict"])

/** What a failed local save tells the person: the actual cause in plain words, never a blanket storage blame. */
export function slotDraftFailureMessage(cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : ""
  // IndexedDB failures arrive as DOMExceptions (QuotaExceededError and friends) or the store's own "IndexedDB …" errors.
  if (cause instanceof DOMException || reason.startsWith("IndexedDB") || reason === "queue_storage_unavailable")
    return "Could not save on this device. Free some storage, then try again. Nothing is saved yet."
  if (BUSY.has(reason)) return "Your collection is still syncing. Try again in a moment. Nothing is saved yet."
  if (CHANGED.has(reason)) return "This pocket changed. Close it and try again. Nothing is saved yet."
  if (reason === "catalog-unavailable") return "This card could not be confirmed. Try again when online. Nothing is saved yet."
  return "Could not save this card. Try again. Nothing is saved yet."
}
