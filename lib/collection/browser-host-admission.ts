import { canShowInventoryHarness } from "@/lib/inventory-harness-gate"

/** No enabled production path exists. #379 requires a reviewed admission change,
 * supported APIs and deployed compatibility/conversion proof before this can change. */
export function browserHostAdmission(localHarness: boolean, enabled: string | undefined, hosted: boolean, host: string | null) {
  return localHarness && canShowInventoryHarness(enabled, hosted, host)
    ? { admitted: true as const, evidence: "synthetic-local-only" as const }
    : { admitted: false as const, reason: "rollout-379-incomplete" as const }
}
