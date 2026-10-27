import { buildDealPriceBands, normalizeDealThresholds, type DealThresholds } from "@/lib/deal-check"
import type { CardPriceCheck } from "@/lib/card-price-checks"
import type { CardFinish } from "@/lib/domain/cards"

export const SOLD_GUIDE_MIN_SALES = 10
export const SOLD_GUIDE_MIN_DAYS = 3
export const SOLD_GUIDE_WINDOW_DAYS = 30
export const SOLD_GUIDE_MAX_AGE_DAYS = 7
export const SOLD_GUIDE_MAX_RELATIVE_IQR = 0.5
const DAY = 86400_000
const round = (value: number) => Math.round(value * 100) / 100

function validSales(check: CardPriceCheck | null | undefined, now: number, days: number) {
  if (check?.summary.kind !== "sold" || check.summary.currency !== "GBP") return []
  return (check.sales ?? []).filter(sale => {
    const date = Date.parse(sale.soldAt)
    return Number.isFinite(sale.amount) && sale.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(sale.soldAt)
      && Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === sale.soldAt && date <= now && now - date <= days * DAY
  })
}

function quantile(sorted: number[], fraction: number) {
  const index = (sorted.length - 1) * fraction
  const low = Math.floor(index), high = Math.ceil(index)
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low)
}

export interface BuyingBand { low: number; high: number }
export interface SoldPriceGuide {
  eligible: boolean
  referenceGbp: number | null
  reason: string
  count: number
  days: number
  median: number
  q1: number
  q3: number
  fairBand: BuyingBand
  fairOverlap: BuyingBand | null
  soldBand: BuyingBand
  catalogBand: BuyingBand | null
  overlap: BuyingBand | null
}

export function buildSoldPriceGuide(check: CardPriceCheck | null | undefined, catalogMarket: number | null | undefined, finish: CardFinish | undefined, thresholds?: DealThresholds, now = Date.now()): SoldPriceGuide | null {
  const sales = validSales(check, now, SOLD_GUIDE_WINDOW_DAYS)
  if (!sales.length) return null
  const amounts = sales.map(sale => sale.amount).sort((a, b) => a - b)
  const median = quantile(amounts, 0.5), q1 = quantile(amounts, 0.25), q3 = quantile(amounts, 0.75)
  const { greatPct, fairPct } = normalizeDealThresholds(thresholds)
  const band = (value: number): BuyingBand => ({ low: round(value * (1 - greatPct / 100)), high: round(value * (1 - fairPct / 100)) })
  const soldBand = band(median)
  const catalogBand = typeof catalogMarket === "number" && Number.isFinite(catalogMarket) && catalogMarket > 0 ? band(catalogMarket) : null
  const low = Math.max(soldBand.low, catalogBand?.low ?? soldBand.low), high = Math.min(soldBand.high, catalogBand?.high ?? soldBand.high)
  const overlap = catalogBand && low <= high ? { low, high } : null
  const fairBand = buildDealPriceBands(median, thresholds)!.fair
  const catalogFairBand = catalogBand ? buildDealPriceBands(catalogMarket!, thresholds)!.fair : null
  const fairLow = Math.max(fairBand.low, catalogFairBand?.low ?? fairBand.low), fairHigh = Math.min(fairBand.high, catalogFairBand?.high ?? fairBand.high)
  const fairOverlap = catalogFairBand && fairLow <= fairHigh ? { low: fairLow, high: fairHigh } : null
  const days = new Set(sales.map(sale => sale.soldAt)).size
  const age = now - Date.parse(check!.checkedAt)
  const newest = Math.max(...sales.map(sale => Date.parse(sale.soldAt)))
  const exact = Boolean(finish && finish !== "jumbo")
  const fresh = Number.isFinite(age) && age >= 0 && age <= SOLD_GUIDE_MAX_AGE_DAYS * DAY && now - newest <= SOLD_GUIDE_MAX_AGE_DAYS * DAY
  const enough = sales.length >= SOLD_GUIDE_MIN_SALES && days >= SOLD_GUIDE_MIN_DAYS && median >= 1
  const concentrated = (q3 - q1) / median <= SOLD_GUIDE_MAX_RELATIVE_IQR
  const agrees = !catalogBand || Boolean(overlap)
  const eligible = exact && fresh && enough && concentrated && agrees
  const reason = !exact ? "Choose a supported printing before sold evidence can change the guide."
    : !fresh ? "Sold evidence is too old to change the guide."
    : !enough ? "Need at least 10 recent sales across 3 dates, with a median of £1 or more."
    : !concentrated ? "Sold prices vary too widely to change the guide."
    : !agrees ? "The sold and catalogue buying ranges do not overlap. Keeping the catalogue guide."
    : !catalogBand ? "Using recent sold evidence because no catalogue price is available."
    : "Recent sold evidence agrees with the catalogue buying range."
  return { eligible, referenceGbp: eligible ? round(median) : null, reason, count: sales.length, days, median: round(median), q1: round(q1), q3: round(q3), soldBand, catalogBand, overlap, fairBand, fairOverlap }
}

export function buildSoldPriceChart(check: CardPriceCheck | null | undefined, now = Date.now()) {
  const sales = validSales(check, now, 90).map(sale => ({ ...sale, time: Date.parse(sale.soldAt) })).sort((a, b) => a.time - b.time)
  const groups = new Map<number, number[]>()
  for (const sale of sales) groups.set(sale.time, [...(groups.get(sale.time) ?? []), sale.amount])
  const daily: { time: number; median: number | null; count: number; range: [number, number] | null; whisker: [number, number] | null }[] = []
  if (sales.length) for (let time = sales[0].time; time <= sales.at(-1)!.time; time += DAY) {
    const values = groups.get(time)?.sort((a, b) => a - b)
    const median = values?.length ? round(quantile(values, 0.5)) : null
    daily.push({ time, median, count: values?.length ?? 0, range: values?.length ? [round(quantile(values, 0.25)), round(quantile(values, 0.75))] : null, whisker: values?.length && median != null ? [median - values[0], values.at(-1)! - median] : null })
  }
  return { sales, daily }
}
