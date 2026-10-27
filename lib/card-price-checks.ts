import type { PriceCheckSummary, SoldComp } from "@/lib/sold-comps"

export const PRICE_CHECK_FRESH_MS = 12 * 60 * 60 * 1000
export interface CardPriceCheck {
  summary: PriceCheckSummary
  checkedAt: string
  searchUrl?: string
  sales?: SoldComp[]
}
export type PriceCheckSource = "ebay" | "soldcomps"
export interface CardPriceChecks {
  ebay: CardPriceCheck | null
  soldcomps: CardPriceCheck | null
  errors: Partial<Record<PriceCheckSource, string>>
}

export function isCardPriceCheck(value: unknown): value is CardPriceCheck {
  if (!value || typeof value !== "object") return false
  const row = value as CardPriceCheck
  const s = row.summary
  if (!s || !["asking", "sold"].includes(s.kind) || s.currency !== "GBP" || !Number.isInteger(s.count) || s.count < 0 || s.count > 200
    || typeof row.checkedAt !== "string" || !Number.isFinite(Date.parse(row.checkedAt))
    || ![s.low, s.median, s.high].every(n => n === null || (typeof n === "number" && Number.isFinite(n) && n > 0))) return false
  if (s.count === 0 ? s.low !== null || s.median !== null || s.high !== null : s.low === null || s.median === null || s.high === null || s.low > s.median || s.median > s.high) return false
  if (row.searchUrl !== undefined && (typeof row.searchUrl !== "string" || !row.searchUrl.startsWith("https://www.ebay.co.uk/sch/"))) return false
  return row.sales === undefined || (Array.isArray(row.sales) && row.sales.length <= 200 && row.sales.every(sale => typeof sale?.amount === "number" && Number.isFinite(sale.amount) && sale.amount > 0 && typeof sale.soldAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sale.soldAt)))
}
