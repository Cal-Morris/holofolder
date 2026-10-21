import type {
  CardFinishPrice,
  CardPriceSnapshot,
  PricedCardFinish,
  CardPriceSourceSummary,
  FxRates,
  PriceConfidence,
  SupportedCurrency,
} from "@/lib/card-pricing"
import type { DisplayCurrency, PricingRegion } from "@/lib/pricing-region"

/**
 * Region-grounded pricing.
 *
 * Every card price snapshot carries per-source evidence (`sourcePrices`), each already converted
 * to GBP with the ECB rate of the day. This module re-weights that evidence for the user's
 * pricing region so the headline price comes from the market the user would actually buy in:
 *
 * - UK: Cardmarket (EUR -> GBP) plus UK sold data quoted in GBP (eBay UK sold, PokePulse).
 * - EU: Cardmarket.
 * - US: TCGplayer (and other USD sources).
 * - JP: no Japanese-market source exists in the pipeline yet, so JP always uses foreign evidence.
 *
 * Native sources are averaged. When foreign evidence agrees with them (within 35%), it is blended
 * in at 20% weight; when it disagrees, it is ignored. When only foreign evidence exists, the
 * snapshot's price is kept but its confidence is downgraded one step.
 */

export type PriceMarket = "UK" | "EU" | "US" | "JP"
export type RegionalPriceBasis = "native" | "blended" | "foreign" | "unchanged"

export const REGION_NATIVE_MARKETS: Record<PricingRegion, readonly PriceMarket[]> = {
  UK: ["UK", "EU"],
  EU: ["EU"],
  US: ["US"],
  JP: ["JP"],
}

export const NATIVE_MARKET_WEIGHT = 0.8
export const FOREIGN_AGREEMENT_SPREAD = 0.35

export type RegionalCardPriceSnapshot<T extends CardPriceSnapshot = CardPriceSnapshot> = T & RegionalPriceFields

export interface RegionalPriceFields {
  region: PricingRegion
  priceBasis: RegionalPriceBasis
  /** The anchor source's own price in its own market currency (e.g. Cardmarket in EUR). */
  nativeAmount: number | null
  nativeCurrency: SupportedCurrency | null
}

export interface DisplayFxRates extends FxRates {
  /** JPY -> GBP. Optional because older payloads and cached rates only carry EUR/USD. */
  jpyToGbp?: number | null
}

export interface PriceDisplayContext {
  currency: DisplayCurrency
  fxRates: DisplayFxRates | null
}

export function getSourceMarket(source: Pick<CardPriceSourceSummary, "source" | "originalCurrency">): PriceMarket | null {
  switch (source.source) {
    case "tcgplayer":
    case "pricecharting":
      return "US"
    case "cardmarket":
      return "EU"
    default:
      break
  }

  switch (source.originalCurrency) {
    case "GBP":
      return "UK"
    case "EUR":
      return "EU"
    case "USD":
      return "US"
    default:
      return null
  }
}

export function downgradeConfidence(confidence: PriceConfidence): PriceConfidence {
  switch (confidence) {
    case "high":
      return "medium"
    case "medium":
      return "low"
    default:
      return confidence
  }
}

function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100
}

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function hasMarketAmount(source: CardPriceSourceSummary): source is CardPriceSourceSummary & { marketGbpAmount: number } {
  return typeof source.marketGbpAmount === "number" && Number.isFinite(source.marketGbpAmount) && source.marketGbpAmount > 0
}

function scale(amount: number | null, ratio: number) {
  return typeof amount === "number" && Number.isFinite(amount) ? roundMoney(amount * ratio) : amount
}

function unchanged<T extends CardPriceSnapshot>(snapshot: T, region: PricingRegion, basis: RegionalPriceBasis = "unchanged"): RegionalCardPriceSnapshot<T> {
  return {
    ...snapshot,
    region,
    priceBasis: basis,
    nativeAmount: snapshot.originalAmount ?? snapshot.gbpAmount,
    nativeCurrency: snapshot.originalCurrency ?? (snapshot.gbpAmount != null ? "GBP" : null),
  }
}

/** Re-weights a snapshot's source evidence for `region`. Pure; never invents a price. */
export function regionalizeCardPrice<T extends CardPriceSnapshot>(snapshot: T, region: PricingRegion): RegionalCardPriceSnapshot<T> {
  const usable = snapshot.sourcePrices.filter(hasMarketAmount)
  if (snapshot.gbpAmount == null || usable.length === 0) {
    return unchanged(snapshot, region)
  }

  const nativeMarkets = REGION_NATIVE_MARKETS[region]
  const native = usable.filter((source) => {
    const market = getSourceMarket(source)
    return market != null && nativeMarkets.includes(market)
  })
  const foreign = usable.filter((source) => !native.includes(source))

  if (native.length === 0) {
    return {
      ...unchanged(snapshot, region, "foreign"),
      confidence: downgradeConfidence(snapshot.confidence),
    }
  }

  const nativeGbp = mean(native.map((source) => source.marketGbpAmount))
  const foreignGbp = foreign.length > 0 ? mean(foreign.map((source) => source.marketGbpAmount)) : null
  const foreignAgrees = foreignGbp != null
    && Math.abs(foreignGbp - nativeGbp) / Math.min(foreignGbp, nativeGbp) <= FOREIGN_AGREEMENT_SPREAD
  const regionalGbp = roundMoney(foreignAgrees
    ? nativeGbp * NATIVE_MARKET_WEIGHT + (foreignGbp as number) * (1 - NATIVE_MARKET_WEIGHT)
    : nativeGbp)

  // Anchor on the native source nearest the regional price, preferring the region's own currency.
  const anchor = [...native].sort((left, right) => {
    const leftOrder = getSourceMarket(left) === nativeMarkets[0] ? 0 : 1
    const rightOrder = getSourceMarket(right) === nativeMarkets[0] ? 0 : 1
    return leftOrder - rightOrder
      || Math.abs(left.marketGbpAmount - regionalGbp) - Math.abs(right.marketGbpAmount - regionalGbp)
  })[0]
  const ratio = regionalGbp / snapshot.gbpAmount
  const lowGbpAmount = scale(snapshot.lowGbpAmount, 1)
  const highGbpAmount = scale(snapshot.highGbpAmount, 1)

  return {
    ...snapshot,
    gbpAmount: regionalGbp,
    marketGbpAmount: regionalGbp,
    goodGbpAmount: scale(snapshot.goodGbpAmount, ratio),
    lowGbpAmount: lowGbpAmount == null ? null : Math.min(lowGbpAmount, regionalGbp),
    highGbpAmount: highGbpAmount == null ? null : Math.max(highGbpAmount, regionalGbp),
    source: anchor.source,
    variantLabel: anchor.variantLabel ?? snapshot.variantLabel,
    originalAmount: anchor.originalCurrency === "GBP" ? null : anchor.originalMarketAmount,
    originalCurrency: anchor.originalCurrency === "GBP" ? null : anchor.originalCurrency,
    updatedAt: anchor.updatedAt ?? snapshot.updatedAt,
    region,
    priceBasis: foreignAgrees ? "blended" : "native",
    nativeAmount: anchor.originalMarketAmount ?? anchor.marketGbpAmount,
    nativeCurrency: anchor.originalCurrency,
  }
}

export function regionalizeCardPrices<T extends CardPriceSnapshot>(
  pricesByKey: Record<string, T>,
  region: PricingRegion,
): Record<string, RegionalCardPriceSnapshot<T>> {
  const result: Record<string, RegionalCardPriceSnapshot<T>> = {}
  for (const [key, snapshot] of Object.entries(pricesByKey)) {
    result[key] = regionalizeCardPrice(snapshot, region)
  }
  return result
}

const STANDARD_FINISH_VARIANT_KEYS = new Set([
  "normal", "unlimited", "holo", "holofoil", "unlimited-holofoil", "reverse", "reverse_holo", "reverseholofoil", "reverse-holofoil", "reverse-holo",
])

/**
 * The region-weighted price of each finish a snapshot quotes (normal, holo, reverse holo). Only standard
 * printings count (not 1st Edition or other special variant rows); the snapshot's own source wins ties.
 */
export function getRegionalFinishPrices(
  snapshot: CardPriceSnapshot | undefined,
  region: PricingRegion,
): Partial<Record<PricedCardFinish, RegionalCardPriceSnapshot>> {
  const result: Partial<Record<PricedCardFinish, RegionalCardPriceSnapshot>> = {}
  const byFinish = new Map<PricedCardFinish, CardFinishPrice[]>()
  for (const price of snapshot?.finishPrices ?? []) {
    if (!STANDARD_FINISH_VARIANT_KEYS.has(price.variantKey.toLowerCase())) continue
    byFinish.set(price.finish, [...(byFinish.get(price.finish) ?? []), price])
  }
  for (const [finish, prices] of byFinish) {
    const chosen = prices.find((price) => price.source === snapshot?.source) ?? prices[0]
    const regional = regionalizeCardPrice(chosen as CardPriceSnapshot, region)
    if (typeof regional.gbpAmount === "number" && regional.gbpAmount > 0) result[finish] = regional
  }
  return result
}

/** GBP value of one unit of `currency`, from fresh rates or, failing that, rates implied by a snapshot. */
export function getGbpPerUnit(currency: SupportedCurrency | DisplayCurrency, fxRates: DisplayFxRates | null, snapshot?: CardPriceSnapshot): number | null {
  if (currency === "GBP") return 1
  const fromRates = currency === "EUR"
    ? fxRates?.eurToGbp
    : currency === "USD"
      ? fxRates?.usdToGbp
      : fxRates?.jpyToGbp
  if (typeof fromRates === "number" && Number.isFinite(fromRates) && fromRates > 0) {
    return fromRates
  }

  for (const source of snapshot?.sourcePrices ?? []) {
    if (
      source.originalCurrency === currency
      && typeof source.marketGbpAmount === "number"
      && typeof source.originalMarketAmount === "number"
      && source.originalMarketAmount > 0
      && source.marketGbpAmount > 0
    ) {
      return source.marketGbpAmount / source.originalMarketAmount
    }
  }

  return null
}

export function formatMoney(amount: number, currency: SupportedCurrency | DisplayCurrency) {
  return new Intl.NumberFormat(currency === "GBP" ? "en-GB" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : amount >= 100 ? 0 : 2,
    minimumFractionDigits: currency === "JPY" ? 0 : undefined,
  }).format(amount)
}

/** Converts a GBP amount for display; falls back to GBP when no rate is known. */
export function convertGbpForDisplay(
  gbpAmount: number,
  context: PriceDisplayContext,
  snapshot?: CardPriceSnapshot,
): { amount: number; currency: SupportedCurrency | DisplayCurrency } {
  const gbpPerUnit = getGbpPerUnit(context.currency, context.fxRates, snapshot)
  if (gbpPerUnit == null) {
    return { amount: gbpAmount, currency: "GBP" }
  }

  const amount = gbpAmount / gbpPerUnit
  return { amount: context.currency === "JPY" ? Math.round(amount) : roundMoney(amount), currency: context.currency }
}

export function formatDisplayAmount(gbpAmount: number | null | undefined, context: PriceDisplayContext, snapshot?: CardPriceSnapshot) {
  if (typeof gbpAmount !== "number" || !Number.isFinite(gbpAmount)) {
    return null
  }

  const converted = convertGbpForDisplay(gbpAmount, context, snapshot)
  return formatMoney(converted.amount, converted.currency)
}

/** Headline prices use the selected currency; source details retain original amounts. */
export function formatRegionalPriceLabel(
  price: CardPriceSnapshot | RegionalCardPriceSnapshot | undefined,
  context: PriceDisplayContext,
) {
  return formatDisplayAmount(price?.gbpAmount, context, price)
}

export function formatDisplayRange(
  lowGbpAmount: number | null | undefined,
  highGbpAmount: number | null | undefined,
  context: PriceDisplayContext,
  snapshot?: CardPriceSnapshot,
) {
  const low = formatDisplayAmount(lowGbpAmount, context, snapshot)
  const high = formatDisplayAmount(highGbpAmount, context, snapshot)

  if (low && high) {
    return low === high ? low : `${low}-${high}`
  }

  return low || high
}

export function formatDisplayTotals(
  gbpTotal: number,
  _originalTotals: Partial<Record<SupportedCurrency, number>>,
  context: PriceDisplayContext,
) {
  if (gbpTotal <= 0) {
    return ""
  }

  return formatDisplayAmount(gbpTotal, context) ?? ""
}

function positiveRate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

/** Validates FX rates received from the API (or local cache). */
export function normalizeDisplayFxRates(value: unknown): DisplayFxRates | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const eurToGbp = positiveRate(record.eurToGbp)
  const usdToGbp = positiveRate(record.usdToGbp)
  if (typeof record.date !== "string" || eurToGbp == null || usdToGbp == null) return null
  return { date: record.date, eurToGbp, usdToGbp, jpyToGbp: positiveRate(record.jpyToGbp) }
}
