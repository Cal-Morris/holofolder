import { matchesPriceCheckTitle, readPublicListingMetadata, type PriceCheckListing, type EbayListingSummary } from "@/lib/ebay-listings"
import { removeOutliers, type PriceSubject } from "@/lib/price-intelligence"

export interface SoldComp extends PriceCheckListing { soldAt: string }
export type PriceCheckSummary = Omit<EbayListingSummary, "kind"> & { kind: "asking" | "sold" }

export function summarizeSoldComps(subject: PriceSubject, items: unknown[], now = Date.now()) {
  const matches = new Map<string, SoldComp>()
  for (const item of items.slice(0, 200)) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const price = row.sold_price as { value?: unknown; currency?: unknown } | undefined
    if (typeof row.item_id !== "string" || !row.item_id || typeof row.title !== "string"
      || row.best_offer_price_known !== true || typeof row.best_offer_accepted !== "boolean"
      || !Array.isArray(row.flags) || row.flags.length || price?.currency !== "GBP"
      || typeof price.value !== "number" || !Number.isFinite(price.value) || price.value <= 0
      || typeof row.sold_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.sold_at)) continue
    const date = Date.parse(row.sold_at)
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== row.sold_at
      || date > now || now - date > 90 * 86400_000 || !matchesPriceCheckTitle(subject, row.title)) continue
    matches.set(row.item_id, { ...matches.get(row.item_id), amount: price.value, soldAt: row.sold_at, ...readPublicListingMetadata(row.title, row.url, row.condition) })
  }
  // Same robust cut as observation summaries, so one-off premium/condition sales (e.g. a swirl at
  // 6x the raw price) leave the median, range, count and the visible record list together.
  const sales = removeOutliers([...matches.values()].map(sale => ({ sale, gbp: sale.amount }))).map(({ sale }) => sale)
  const amounts = sales.map(sale => sale.amount).sort((a, b) => a - b)
  const middle = Math.floor(amounts.length / 2)
  const summary: PriceCheckSummary = { kind: "sold", currency: "GBP", count: amounts.length,
    median: amounts.length ? Math.round((amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2) * 100) / 100 : null,
    low: amounts[0] ?? null, high: amounts.at(-1) ?? null }
  return { summary, sales }
}
