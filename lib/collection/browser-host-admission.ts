import { canShowInventoryHarness } from "@/lib/inventory-harness-gate"
import { isInventoryReadScope, type InventoryReadScope } from "@/lib/collection/inventory-read-transport"

/** checkedScope comes only from useBrowserCollectionScope's checked claims/membership lifetime.
 * This opens the host, not editing: only its authenticated complete HTTP read can do that.
 * A synthetic harness never selects authenticated endpoints, even with a checked test scope. */
export function browserHostAdmission(localHarness: boolean, enabled: string | undefined, hosted: boolean, host: string | null, checkedScope?: InventoryReadScope | null) {
  if (localHarness) return canShowInventoryHarness(enabled, hosted, host)
    ? { admitted: true as const, evidence: "synthetic-local-only" as const }
    : { admitted: false as const, reason: "local-harness-unavailable" as const }
  return isInventoryReadScope(checkedScope)
    ? { admitted: true as const, evidence: "authenticated-session" as const }
    : { admitted: false as const, reason: "checked-session-required" as const }
}
