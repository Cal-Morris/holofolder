/**
 * Copy for the one compact connection chip at the top of the screen (main app and Show mode
 * share the wording): offline with/without queued edits, and queued edits syncing online.
 */
export type ConnectionSyncStatus = "idle" | "syncing" | "waiting"

const changes = (count: number) => `${count} change${count === 1 ? "" : "s"}`

/** Offline label. `pendingCount` only counts when signed in (signed-out edits never sync). */
export function offlineChipLabel(pendingCount: number): string {
  return pendingCount > 0 ? `Offline · ${changes(pendingCount)} to sync` : "Offline · using saved cards and prices"
}

/** Online label while queued edits are being sent; `waiting` means a send failed and is retrying. */
export function syncingChipLabel(pendingCount: number, status: ConnectionSyncStatus = "syncing"): string {
  return `${changes(pendingCount)} syncing${status === "waiting" ? " · retrying" : ""}`
}
