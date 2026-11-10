import { buildSoldPriceGuide, type BuyingBand } from "@/lib/sold-price-guide"
import { buildDealPriceBands, normalizeDealThresholds, type DealThresholds } from "@/lib/deal-check"
import { isCardPriceCheck, type CardPriceCheck } from "@/lib/card-price-checks"
import type { CardFinish } from "@/lib/domain/cards"
import { nativeCatalogueQuote, type NativeBundleEvidence } from "@/lib/native-price-evidence"
import { priceCheckFinish } from "@/lib/card-price-check-cache"

interface BundlePriceEvidence {
  card?: { id: string; language?: string }
  nativeEvidence?: NativeBundleEvidence
  marketPrice: number | null
  currency: string
  finish: CardFinish
  catalogMarketGbp?: number | null
  gbpPerUnit?: number | null
  soldCheck?: CardPriceCheck
}
const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
const round = (value: number) => Math.round(value * 100) / 100

export function buildBundlePriceGuide(entries: readonly BundlePriceEvidence[], currency: string, thresholds?: DealThresholds, now = Date.now(), allowSold = true, native = false) {
  const { greatPct, fairPct } = normalizeDealThresholds(thresholds)
  const items = entries.map(entry => {
    const quote = entry.card && nativeCatalogueQuote(entry.card, entry.finish, entry.nativeEvidence?.catalogue, now)
    const exactCatalogue = !native || Boolean(quote && quote.gbpAmount === entry.catalogMarketGbp)
    const exactSold = entry.card?.language === "en" && priceCheckFinish(entry.finish) !== "any" && entry.nativeEvidence?.soldExact === true
    const rate = entry.currency === "GBP" ? 1 : entry.gbpPerUnit
    const sold = allowSold && (!native || exactSold) && entry.soldCheck && isCardPriceCheck(entry.soldCheck) ? entry.soldCheck : null
    const guide = buildSoldPriceGuide(sold, exactCatalogue ? entry.catalogMarketGbp : null, entry.finish, thresholds, now)
    const convertible = entry.currency === currency && positive(rate)
    const catalogue = exactCatalogue && positive(entry.catalogMarketGbp) && convertible ? round(entry.catalogMarketGbp / rate) : null
    const qualified = guide?.referenceGbp != null && convertible ? round(guide.referenceGbp / rate) : null
    const legacy = !native && (allowSold || !entry.soldCheck) && entry.catalogMarketGbp === undefined && entry.currency === currency && positive(entry.marketPrice) ? entry.marketPrice : null
    const marketPrice = qualified ?? catalogue ?? legacy
    return { marketPrice, catalogPrice: catalogue, source: qualified != null ? "sold" : catalogue != null ? "catalogue" : legacy != null ? "saved" : "unknown" }
  })
  const marketTotal = round(items.reduce((sum, item) => sum + (item.marketPrice ?? 0), 0))
  const complete = entries.length > 0 && items.every(item => item.marketPrice != null)
  const band = marketTotal > 0 ? { low: round(marketTotal * (1 - greatPct / 100)), high: round(marketTotal * (1 - fairPct / 100)) } : null
  const catalogTotal = items.every(item => item.catalogPrice != null) ? round(items.reduce((sum, item) => sum + (item.catalogPrice ?? 0), 0)) : null
  const expected = buildDealPriceBands(marketTotal, thresholds)?.fair
  const catalogExpected = catalogTotal != null ? buildDealPriceBands(catalogTotal, thresholds)?.fair : null
  const overlap: BuyingBand | null = complete && expected && catalogExpected && items.some(item => item.source === "sold") && Math.max(expected.low, catalogExpected.low) <= Math.min(expected.high, catalogExpected.high)
    ? { low: Math.max(expected.low, catalogExpected.low), high: Math.min(expected.high, catalogExpected.high) } : null
  return { items, marketTotal, complete, band, overlap }
}
