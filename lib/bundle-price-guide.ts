import { buildSoldPriceGuide, type BuyingBand } from "@/lib/sold-price-guide"
import { normalizeDealThresholds, type DealThresholds } from "@/lib/deal-check"
import { isCardPriceCheck, type CardPriceCheck } from "@/lib/card-price-checks"
import type { CardFinish } from "@/lib/domain/cards"

interface BundlePriceEvidence {
  marketPrice: number | null
  currency: string
  finish: CardFinish
  catalogMarketGbp?: number | null
  gbpPerUnit?: number | null
  soldCheck?: CardPriceCheck
}
const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
const round = (value: number) => Math.round(value * 100) / 100

export function buildBundlePriceGuide(entries: readonly BundlePriceEvidence[], currency: string, thresholds?: DealThresholds, now = Date.now()) {
  const { greatPct, fairPct } = normalizeDealThresholds(thresholds)
  const items = entries.map(entry => {
    const rate = entry.currency === "GBP" ? 1 : entry.gbpPerUnit
    const sold = entry.soldCheck && isCardPriceCheck(entry.soldCheck) ? entry.soldCheck : null
    const guide = buildSoldPriceGuide(sold, entry.catalogMarketGbp, entry.finish, thresholds, now)
    const convertible = entry.currency === currency && positive(rate)
    const catalogue = positive(entry.catalogMarketGbp) && convertible ? round(entry.catalogMarketGbp / rate) : null
    const qualified = guide?.referenceGbp != null && convertible ? round(guide.referenceGbp / rate) : null
    const legacy = entry.catalogMarketGbp === undefined && entry.currency === currency && positive(entry.marketPrice) ? entry.marketPrice : null
    const marketPrice = qualified ?? catalogue ?? legacy
    return { marketPrice, catalogPrice: catalogue, source: qualified != null ? "sold" : catalogue != null ? "catalogue" : legacy != null ? "saved" : "unknown" }
  })
  const marketTotal = round(items.reduce((sum, item) => sum + (item.marketPrice ?? 0), 0))
  const complete = entries.length > 0 && items.every(item => item.marketPrice != null)
  const band = marketTotal > 0 ? { low: round(marketTotal * (1 - greatPct / 100)), high: round(marketTotal * (1 - fairPct / 100)) } : null
  const catalogTotal = items.every(item => item.catalogPrice != null) ? round(items.reduce((sum, item) => sum + (item.catalogPrice ?? 0), 0)) : null
  const catalogBand = catalogTotal != null && catalogTotal > 0 ? { low: round(catalogTotal * (1 - greatPct / 100)), high: round(catalogTotal * (1 - fairPct / 100)) } : null
  const overlap: BuyingBand | null = complete && band && catalogBand && items.some(item => item.source === "sold") && Math.max(band.low, catalogBand.low) <= Math.min(band.high, catalogBand.high)
    ? { low: Math.max(band.low, catalogBand.low), high: Math.min(band.high, catalogBand.high) } : null
  return { items, marketTotal, complete, band, overlap }
}
