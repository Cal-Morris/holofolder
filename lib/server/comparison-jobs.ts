import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { isPriceCheckFresh } from "@/lib/card-price-check-cache"
import { PRICE_CHECK_SOURCES } from "@/lib/card-price-check-cache"
import { loadCardPriceChecks, loadSavedCardPriceChecks } from "@/lib/server/card-price-checks"
import type { CheckCompsProgress } from "@/lib/check-comps"
import type { ComparisonJob, ComparisonTarget, ComparisonResult } from "@/lib/comparison-jobs"

export interface StoredComparisonJob extends ComparisonJob {
  owner_user_id: string
  initiated_by?: string | null
  targets: ComparisonTarget[]
  run_id: string | null
  created_at: string
}
export const publicComparisonJob = (job: StoredComparisonJob): ComparisonJob => ({ id: job.id, status: job.status, progress: job.progress })
export const comparisonScopeKey = (targets: ComparisonTarget[]) => createHash("sha256").update(JSON.stringify(targets.map(target => `${target.cardId}:${target.finish}`).sort())).digest("hex")
export const initialComparisonProgress = (total: number): CheckCompsProgress => ({ done: 0, total, fresh: 0, checked: 0, failed: 0, stopped: {} })

export async function readComparisonJob(id: string, ownerId?: string) {
  let query = createAdminClient().from("comparison_jobs").select("*").eq("id", id)
  if (ownerId) query = query.eq("owner_user_id", ownerId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data as StoredComparisonJob | null
}

export async function comparisonJobActive(id: string) {
  const { data, error } = await createAdminClient().from("comparison_jobs").select("status").eq("id", id).maybeSingle()
  if (error) throw error
  return data?.status === "queued" || data?.status === "running"
}

/** Read shared timestamps in bounded batches, without loading listing bodies or calling a provider. */
export async function estimateComparisonSpend(targets: ComparisonTarget[]) {
  const fresh = new Set<string>()
  const ids = [...new Set(targets.map(target => target.cardId))]
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await createAdminClient().from("card_price_checks")
      .select("card_id,finish,checked_at").eq("source", "soldcomps").in("card_id", ids.slice(i, i + 100))
    if (error) throw error
    for (const row of data ?? []) if (isPriceCheckFresh({ checkedAt: row.checked_at })) fresh.add(`${row.card_id}:${row.finish}`)
  }
  return targets.filter(target => !fresh.has(`${target.cardId}:${target.finish}`)).length
}

/** A step's result contains only counters/errors; full evidence stays in card_price_checks. */
export async function checkComparisonTarget(target: ComparisonTarget, stopped: CheckCompsProgress["stopped"], jobId?: string): Promise<ComparisonResult> {
  const [saved] = await loadSavedCardPriceChecks([target])
  const nextStopped: CheckCompsProgress["stopped"] = {}
  let allFresh = true
  let failed = false
  let retryable = false
  for (const source of PRICE_CHECK_SOURCES) {
    if (jobId && !await comparisonJobActive(jobId)) return { result: "failed", stopped: {} }
    if (isPriceCheckFresh(saved[source])) continue
    allFresh = false
    if (stopped[source]) { failed = true; continue }
    const result = await loadCardPriceChecks(target.cardId, target.finish, true, source)
    const error = result?.errors[source]
    if (error && /allowance used up|not configured/i.test(error)) nextStopped[source] = error
    if (!isPriceCheckFresh(result?.[source])) {
      failed = true
      if (error && !/allowance used up|not configured/i.test(error)) retryable = true
    }
  }
  return { result: failed ? "failed" : allFresh ? "fresh" : "checked", stopped: nextStopped, ...(retryable ? { retryable: true } : {}) }
}
