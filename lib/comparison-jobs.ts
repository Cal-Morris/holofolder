import { isPriceCheckCardId } from "@/lib/card-catalog"
import { priceCheckFinish } from "@/lib/card-price-check-cache"
import type { CheckCompsProgress } from "@/lib/check-comps"

export interface ComparisonTarget { cardId: string; language: "en"; finish: string }
export interface ComparisonJob {
  id: string
  status: "queued" | "running" | "completed" | "cancelled" | "failed"
  progress: CheckCompsProgress
}
export interface ComparisonResult {
  result: "fresh" | "checked" | "failed"
  stopped: CheckCompsProgress["stopped"]
  retryable?: boolean
}
export function normalizeComparisonTargets(value: unknown): ComparisonTarget[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 10_000) return null
  const targets = new Map<string, ComparisonTarget>()
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || typeof raw.cardId !== "string" || !isPriceCheckCardId(raw.cardId) || (raw.language ?? "en") !== "en"
      || raw.finish === "jumbo" || (raw.finish != null && typeof raw.finish !== "string")) return null
    const finish = priceCheckFinish(raw.finish)
    targets.set(`${raw.cardId}:${finish}`, { cardId: raw.cardId, language: "en", finish })
  }
  return [...targets.values()]
}
export function countComparisonResult(progress: CheckCompsProgress, next: ComparisonResult): CheckCompsProgress {
  return { ...progress, done: progress.done + 1, [next.result]: progress[next.result] + 1, stopped: { ...progress.stopped, ...next.stopped } }
}
export const isComparisonJobActive = (job: ComparisonJob) => job.status === "queued" || job.status === "running"

export function normalizeComparisonJob(value: unknown): ComparisonJob | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || !/^[0-9a-f-]{36}$/.test(raw.id)
    || !["queued", "running", "completed", "cancelled", "failed"].includes(String(raw.status))
    || !raw.progress || typeof raw.progress !== "object") return null
  const progress = raw.progress as Record<string, unknown>
  if (!["done", "total", "fresh", "checked", "failed"].every(key => typeof progress[key] === "number" && Number.isInteger(progress[key]) && progress[key] >= 0 && progress[key] <= 10_000)) return null
  if (!progress.stopped || typeof progress.stopped !== "object" || Array.isArray(progress.stopped)
    || !Object.entries(progress.stopped).every(([source, message]) => ["ebay", "soldcomps"].includes(source) && typeof message === "string" && message.length <= 500)) return null
  const result = progress as unknown as CheckCompsProgress
  if (result.done !== result.checked + result.fresh + result.failed || result.done > result.total) return null
  return { id: raw.id, status: raw.status as ComparisonJob["status"], progress: result }
}
