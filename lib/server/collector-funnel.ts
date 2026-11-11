import "server-only"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { sanitizeAttribution, type FunnelAttribution, type FunnelEventName } from "@/lib/collector-funnel"

export function collectorFunnelEnabled() { return process.env.VERCEL_ENV === "production" && process.env.HOLOFOLDER_FUNNEL_ENABLED === "true" }

/** Runs after a successful primary action; missing schema or telemetry failures are deliberately harmless. */
export function scheduleCollectorTracking(action: () => Promise<unknown>) {
  if (!collectorFunnelEnabled()) return
  try { after(async () => { try { await action() } catch { /* Best-effort telemetry is never a business-action dependency. */ } }) } catch { /* No request lifecycle, nothing to schedule. */ }
}

export async function observeCollectorAccount(accountId: string, owner: boolean, occurredAt: string, attribution?: FunnelAttribution) {
  if (!collectorFunnelEnabled()) return false
  try {
    const source = sanitizeAttribution(attribution)
    const { error } = await createAdminClient().rpc("observe_collector_account", { account: accountId, observed_at: occurredAt, as_owner: owner, acquisition_source: source.source, acquisition_medium: source.medium, acquisition_campaign: source.campaign }).abortSignal(AbortSignal.timeout(2000))
    return !error
  } catch { return false }
}

export async function recordCollectorEvent(input: { actorId: string; ownerId: string; name: FunnelEventName; key: string; at: string; origin?: "manual" | "import"; subscriptionId?: string; periodStart?: string; periodEnd?: string }) {
  if (!collectorFunnelEnabled()) return false
  try {
    const { error } = await createAdminClient().from("collector_events").upsert({ actor_id: input.actorId, owner_id: input.ownerId, name: input.name, event_key: input.key, occurred_at: input.at, origin: input.origin ?? null, subscription_id: input.subscriptionId ?? null, period_start: input.periodStart ?? null, period_end: input.periodEnd ?? null }, { onConflict: "owner_id,event_key", ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(2000))
    return !error
  } catch { return false }
}
