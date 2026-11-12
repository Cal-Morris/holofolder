const BUSY = new Set(['inactive-or-unavailable-session', 'fresh-scoped-read-required']);
const CHANGED = new Set([
  'picker-scope-changed',
  'inactive-queue-scope',
  'slot-conflict',
  'placement-conflict',
  'inventory-conflict',
  'collection-conflict',
  'layout-conflict',
  'item-conflict',
  'wanted-conflict',
  'destination-occupied',
  'idempotency-conflict',
]);

/** What a failed local save tells the person: the actual cause in plain words, never a blanket storage blame. */
export function slotDraftFailureMessage(cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : '';
  // IndexedDB failures arrive as DOMExceptions (QuotaExceededError and friends) or the store's own "IndexedDB …" errors.
  if (cause instanceof DOMException && cause.name === 'QuotaExceededError')
    return 'Could not save on this device. Free some storage, then try again. Save not confirmed.';
  if (reason.startsWith('IndexedDB') || reason === 'queue_storage_unavailable')
    return 'Could not save on this device. Try again. Save not confirmed.';
  // Things that genuinely hold new edits back say what they are; none of them clears by waiting.
  if (reason === 'queue-reconciliation-required')
    return "An earlier change couldn't be saved and needs your decision. Choose what to do in your binder, then add this again. Save not confirmed.";
  if (reason === 'recovery-pending')
    return 'Some changes on this device need reviewing first. Review them in your binder, then try again. Save not confirmed.';
  if (reason === 'creation-pending')
    return 'Your new binder is still being created. Try again once it opens. Save not confirmed.';
  if (reason === 'collection-deletion-pending')
    return 'This binder is being deleted, so it cannot be changed. Save not confirmed.';
  if (BUSY.has(reason)) return 'Your collection is still syncing. Try again in a moment. Save not confirmed.';
  if (CHANGED.has(reason)) return 'This pocket changed. Close it and try again. Save not confirmed.';
  if (reason === 'target-mismatch')
    return "This card doesn't match this pocket's target. Pick a matching card. Save not confirmed.";
  if (reason === 'occupied-target')
    return "That target doesn't match the card in this pocket. Move the card to Unassigned first. Save not confirmed.";
  if (reason === 'raw-copy-required')
    return "A graded card can't be removed here. You can take it out of the pocket instead. Nothing was changed.";
  if (reason === 'catalog-unavailable')
    return 'This card could not be confirmed. Try again when online. Save not confirmed.';
  return 'Could not save this card. Try again. Save not confirmed.';
}

/** Why a layout change could not be prepared, in the person's terms. Nothing was saved in any of these cases. */
export function layoutFailureMessage(cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : '';
  if (reason === 'layout-capacity') return 'This binder is at its 4,096-pocket limit, so nothing was added.';
  if (reason === 'selected-anchor') return "Tap a pocket that isn't selected.";
  if (reason === 'selection-limit') return 'You can change up to 256 pockets at once. Select fewer and try again.';
  if (reason === 'selection-required') return 'Select at least one pocket first.';
  return 'These pockets changed. Update the selection and try again.';
}
