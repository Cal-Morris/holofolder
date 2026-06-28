import { createAdminClient } from "@/lib/supabase/admin"
import { buildBuySignal, type CardBuySignal, type PriceProvider } from "@/lib/price-intelligence"

export type SupportedCurrency = "USD" | "EUR" | "GBP"
export type PriceSource = PriceProvider
export type CardLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"
export type PriceConfidence = "high" | "medium" | "low" | "unknown"

export interface CardPriceSourceSummary {
  source: PriceSource
  label: string
  variantLabel: string | null
  marketGbpAmount: number | null
  lowGbpAmount: number | null
  originalMarketAmount: number | null
  originalLowAmount: number | null
  originalCurrency: SupportedCurrency
  updatedAt: string | null
}

export interface CardPriceTrendPoint {
  label: string
  source: PriceSource
  gbpAmount: number
  originalAmount: number
  originalCurrency: SupportedCurrency
}

export interface CardPriceLookup {
  cardId: string
  language: CardLanguage
}

export interface CardPriceSnapshot {
  cardId: string
  language: CardLanguage
  gbpAmount: number | null
  marketGbpAmount: number | null
  goodGbpAmount: number | null
  lowGbpAmount: number | null
  highGbpAmount: number | null
  confidence: PriceConfidence
  sourcePrices: CardPriceSourceSummary[]
  trendPoints: CardPriceTrendPoint[]
  buySignal: CardBuySignal | null
  originalAmount: number | null
  originalCurrency: Exclude<SupportedCurrency, "GBP"> | null
  source: PriceSource | null
  variantLabel: string | null
  updatedAt: string | null
  fxDate: string | null
}

interface FxRates {
  date: string
  eurToGbp: number
  usdToGbp: number
}

interface CardPriceRow {
  card_id: string
  language?: string | null
  gbp_amount: number | string | null
  market_gbp_amount?: number | string | null
  good_gbp_amount?: number | string | null
  low_gbp_amount?: number | string | null
  high_gbp_amount?: number | string | null
  confidence?: string | null
  source_prices?: unknown
  trend_points?: unknown
  buy_signal?: unknown
  original_amount: number | string | null
  original_currency: string | null
  source: string | null
  variant_label: string | null
  source_updated_at: string | null
  fx_date: string | null
  fetched_at: string
}

export interface CardPriceRefreshResult {
  prices: CardPriceSnapshot[]
  refreshed: number
  cached: number
  unpriced: number
}

const FETCH_CONCURRENCY = 8
export const CARD_PRICE_CACHE_TTL_MS = 2 * 60 * 60 * 1000
const SUPPORTED_CARD_LANGUAGES: CardLanguage[] = ["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"]
const CARDMARKET_FIRST_LANGUAGES = new Set<CardLanguage>(["fr", "de", "es", "it", "pt-br"])
const TCGPLAYER_VARIANT_PRIORITY = [
  "normal",
  "reverse",
  "holo",
  "holofoil",
  "reverseHolofoil",
  "reverse-holofoil",
  "1st-edition",
  "1st-edition-holofoil",
  "unlimited",
  "unlimited-holofoil",
] as const

const CARDMARKET_FIELD_PRIORITY = [
  "trend",
  "avg30",
  "avg7",
  "avg1",
  "avg",
  "trend-holo",
  "avg30-holo",
  "avg7-holo",
  "avg1-holo",
  "avg-holo",
  "low",
  "low-holo",
] as const

const CARDMARKET_GOOD_FIELD_PRIORITY = [
  "low",
  "low-holo",
] as const

export function normalizeCardLanguage(value: unknown): CardLanguage {
  if (typeof value !== "string") return "en"
  const normalized = value.trim().toLowerCase()
  return SUPPORTED_CARD_LANGUAGES.includes(normalized as CardLanguage) ? normalized as CardLanguage : "en"
}

export function getCardPriceKey(cardId: string, language: unknown = "en") {
  return `${cardId}::${normalizeCardLanguage(language)}`
}

export function normalizeCardPriceLookups(values: unknown[]): CardPriceLookup[] {
  const byKey = new Map<string, CardPriceLookup>()

  for (const value of values) {
    const cardId = typeof value === "string"
      ? value.trim()
      : value && typeof value === "object" && typeof (value as { cardId?: unknown }).cardId === "string"
        ? ((value as { cardId: string }).cardId).trim()
        : ""

    if (!cardId) {
      continue
    }

    const language = normalizeCardLanguage(
      typeof value === "string" ? "en" : (value as { language?: unknown }).language,
    )
    byKey.set(getCardPriceKey(cardId, language), { cardId, language })
  }

  return [...byKey.values()]
}

export async function refreshCardPriceLookups(
  lookups: CardPriceLookup[],
  options: { force?: boolean } = {},
): Promise<CardPriceRefreshResult> {
  const uniqueLookups = normalizeCardPriceLookups(lookups)

  if (uniqueLookups.length === 0) {
    return { prices: [], refreshed: 0, cached: 0, unpriced: 0 }
  }

  const cardIds = [...new Set(uniqueLookups.map((lookup) => lookup.cardId))]
  const languages = [...new Set(uniqueLookups.map((lookup) => lookup.language))]
  const supabase = createAdminClient()
  const freshByLookupKey = new Map<string, CardPriceSnapshot>()

  if (!options.force) {
    const { data: cachedRows, error: cacheError } = await supabase
      .from("card_prices")
      .select("*")
      .in("card_id", cardIds)
      .in("language", languages)

    if (cacheError) {
      console.error("[binderdex] Failed to read card_prices cache:", cacheError)
    }

    const now = Date.now()
    for (const row of (cachedRows ?? []) as CardPriceRow[]) {
      const fetchedAtMs = Date.parse(row.fetched_at)
      if (Number.isFinite(fetchedAtMs) && now - fetchedAtMs < CARD_PRICE_CACHE_TTL_MS) {
        const snapshot = rowToSnapshot(row)
        freshByLookupKey.set(getCardPriceKey(snapshot.cardId, snapshot.language), snapshot)
      }
    }
  }

  const missingLookups = uniqueLookups.filter(
    (lookup) => !freshByLookupKey.has(getCardPriceKey(lookup.cardId, lookup.language)),
  )

  let refreshedSnapshots: CardPriceSnapshot[] = []
  if (missingLookups.length > 0) {
    const fxRates = await fetchEcbFxRates().catch((error) => {
      console.error("[binderdex] Failed to load ECB FX rates for card prices:", error)
      return null
    })
    refreshedSnapshots = fxRates
      ? await mapWithConcurrency(
          missingLookups,
          FETCH_CONCURRENCY,
          (lookup) => fetchCardPriceSnapshot(lookup.cardId, lookup.language, fxRates),
        )
      : missingLookups.map((lookup) => emptySnapshot(lookup.cardId, lookup.language))

    const rowsToUpsert = refreshedSnapshots.map((snapshot) => snapshotToRow(snapshot))
    const { error: upsertError } = await supabase
      .from("card_prices")
      .upsert(rowsToUpsert, { onConflict: "card_id,language" })

    if (upsertError) {
      console.error("[binderdex] Failed to upsert card_prices rows:", upsertError)
    }
  }

  const prices = uniqueLookups.map((lookup) => {
    const lookupKey = getCardPriceKey(lookup.cardId, lookup.language)
    const fresh = freshByLookupKey.get(lookupKey)
    if (fresh) return fresh
    return refreshedSnapshots.find((snapshot) => getCardPriceKey(snapshot.cardId, snapshot.language) === lookupKey)
      ?? emptySnapshot(lookup.cardId, lookup.language)
  })

  return {
    prices,
    refreshed: refreshedSnapshots.length,
    cached: freshByLookupKey.size,
    unpriced: prices.filter((snapshot) => snapshot.gbpAmount == null).length,
  }
}

function rowToSnapshot(row: CardPriceRow): CardPriceSnapshot {
  const gbpAmount = toFiniteNumber(row.gbp_amount)
  const marketGbpAmount = toFiniteNumber(row.market_gbp_amount) ?? gbpAmount
  const goodGbpAmount = toFiniteNumber(row.good_gbp_amount)
  const lowGbpAmount = toFiniteNumber(row.low_gbp_amount)
  const highGbpAmount = toFiniteNumber(row.high_gbp_amount)
  const fallbackRangeLow = goodGbpAmount != null && marketGbpAmount != null
    ? Math.min(goodGbpAmount, marketGbpAmount)
    : goodGbpAmount ?? marketGbpAmount
  const fallbackRangeHigh = goodGbpAmount != null && marketGbpAmount != null
    ? Math.max(goodGbpAmount, marketGbpAmount)
    : marketGbpAmount ?? goodGbpAmount

  return {
    cardId: row.card_id,
    language: normalizeCardLanguage(row.language),
    gbpAmount,
    marketGbpAmount,
    goodGbpAmount,
    lowGbpAmount: lowGbpAmount ?? fallbackRangeLow ?? null,
    highGbpAmount: highGbpAmount ?? fallbackRangeHigh ?? null,
    confidence: normalizePriceConfidence(row.confidence),
    sourcePrices: normalizeSourcePrices(row.source_prices),
    trendPoints: normalizeTrendPoints(row.trend_points),
    buySignal: normalizeBuySignal(row.buy_signal),
    originalAmount: toFiniteNumber(row.original_amount),
    originalCurrency: row.original_currency === "USD" || row.original_currency === "EUR" ? row.original_currency : null,
    source: normalizePriceSource(row.source),
    variantLabel: row.variant_label,
    updatedAt: row.source_updated_at,
    fxDate: row.fx_date,
  }
}

function snapshotToRow(snapshot: CardPriceSnapshot) {
  return {
    card_id: snapshot.cardId,
    language: snapshot.language,
    gbp_amount: snapshot.gbpAmount,
    market_gbp_amount: snapshot.marketGbpAmount,
    good_gbp_amount: snapshot.goodGbpAmount,
    low_gbp_amount: snapshot.lowGbpAmount,
    high_gbp_amount: snapshot.highGbpAmount,
    confidence: snapshot.confidence,
    source_prices: snapshot.sourcePrices,
    trend_points: snapshot.trendPoints,
    buy_signal: snapshot.buySignal,
    original_amount: snapshot.originalAmount,
    original_currency: snapshot.originalCurrency,
    source: snapshot.source,
    variant_label: snapshot.variantLabel,
    source_updated_at: snapshot.updatedAt,
    fx_date: snapshot.fxDate,
    fetched_at: new Date().toISOString(),
  }
}

function toFiniteNumber(value: number | string | null | undefined) {
  if (value == null) return null
  const num = typeof value === "number" ? value : Number.parseFloat(value)
  return Number.isFinite(num) ? num : null
}

function normalizePriceConfidence(value: unknown): PriceConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "unknown"
}

function normalizeSourcePrices(value: unknown): CardPriceSourceSummary[] {
  const values = parseJsonArray(value)

  return values.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const record = item as Record<string, unknown>
    const source = normalizePriceSource(record.source)
    const originalCurrency = record.originalCurrency === "USD" || record.originalCurrency === "EUR" || record.originalCurrency === "GBP"
      ? record.originalCurrency
      : null

    if (!source || !originalCurrency) return []

    return [{
      source,
      label: typeof record.label === "string" ? record.label : getPriceSourceLabel(source),
      variantLabel: typeof record.variantLabel === "string" ? record.variantLabel : null,
      marketGbpAmount: toFiniteNumber(record.marketGbpAmount as number | string | null | undefined),
      lowGbpAmount: toFiniteNumber(record.lowGbpAmount as number | string | null | undefined),
      originalMarketAmount: toFiniteNumber(record.originalMarketAmount as number | string | null | undefined),
      originalLowAmount: toFiniteNumber(record.originalLowAmount as number | string | null | undefined),
      originalCurrency,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    }]
  })
}

function normalizeTrendPoints(value: unknown): CardPriceTrendPoint[] {
  const values = parseJsonArray(value)

  return values.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const record = item as Record<string, unknown>
    const source = normalizePriceSource(record.source)
    const originalCurrency = record.originalCurrency === "USD" || record.originalCurrency === "EUR" || record.originalCurrency === "GBP"
      ? record.originalCurrency
      : null
    const gbpAmount = toFiniteNumber(record.gbpAmount as number | string | null | undefined)
    const originalAmount = toFiniteNumber(record.originalAmount as number | string | null | undefined)

    if (!source || !originalCurrency || gbpAmount == null || originalAmount == null) return []

    return [{
      label: typeof record.label === "string" ? record.label : "",
      source,
      gbpAmount,
      originalAmount,
      originalCurrency,
    }]
  })
}

function normalizeBuySignal(value: unknown): CardBuySignal | null {
  if (!value || typeof value !== "object") return null

  const record = value as Record<string, unknown>
  const status = record.status
  if (status !== "good" && status !== "fair" && status !== "hold" && status !== "rising") {
    return null
  }

  return {
    status,
    label: typeof record.label === "string" ? record.label : getBuySignalStatusLabel(status),
    reason: typeof record.reason === "string" ? record.reason : "",
  }
}

function normalizePriceSource(value: unknown): PriceSource | null {
  return value === "tcgplayer"
    || value === "cardmarket"
    || value === "ebay"
    || value === "pricecharting"
    || value === "pokescope"
    || value === "eyevo"
    || value === "public-page"
    ? value
    : null
}

function getPriceSourceLabel(source: PriceSource) {
  switch (source) {
    case "tcgplayer":
      return "TCGplayer"
    case "cardmarket":
      return "Cardmarket"
    case "ebay":
      return "eBay"
    case "pricecharting":
      return "PriceCharting"
    case "pokescope":
      return "PokeScope"
    case "eyevo":
      return "Eyevo"
    case "public-page":
      return "Public page"
  }
}

function getBuySignalStatusLabel(status: CardBuySignal["status"]) {
  switch (status) {
    case "good":
      return "Good time"
    case "fair":
      return "Fair"
    case "rising":
      return "Rising"
    case "hold":
      return "Hold"
  }
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value
  if (typeof value !== "string" || value.length === 0) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function buildPriceRange(marketAmount: number, lowAmount: number | null, highAmount: number | null, fallbackSpread = 0.15) {
  const inferredLow = lowAmount ?? marketAmount * (1 - fallbackSpread)
  const inferredHigh = highAmount ?? marketAmount * (1 + fallbackSpread)
  const rangeLow = Math.min(inferredLow, marketAmount, inferredHigh)
  const rangeHigh = Math.max(inferredLow, marketAmount, inferredHigh)

  return { rangeLow, rangeHigh }
}

function priceConfidence({
  hasMarket,
  hasLow,
  hasHigh,
  usedFallbackMarket,
}: {
  hasMarket: boolean
  hasLow: boolean
  hasHigh: boolean
  usedFallbackMarket?: boolean
}): PriceConfidence {
  if (!hasMarket) return usedFallbackMarket ? "low" : "unknown"
  if (usedFallbackMarket) return "low"
  if (hasLow && hasHigh) return "high"
  if (hasLow) return "high"
  return "medium"
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length)
  let index = 0

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await worker(items[currentIndex])
    }
  })

  await Promise.all(runners)
  return results
}

async function fetchCardPriceSnapshot(cardId: string, language: CardLanguage, fxRates: FxRates): Promise<CardPriceSnapshot> {
  try {
    const response = await fetch(`https://api.tcgdex.net/v2/${encodeURIComponent(language)}/cards/${encodeURIComponent(cardId)}`, {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 60 * 60 * 12 },
    })

    if (!response.ok) {
      return emptySnapshot(cardId, language)
    }

    const payload = await response.json()
    return buildCardPriceSnapshotFromPricing(cardId, language, payload?.pricing, fxRates)
  } catch (error) {
    console.error(`[binderdex] Failed to fetch price for ${cardId} (${language}):`, error)
    return emptySnapshot(cardId, language)
  }
}

export function buildCardPriceSnapshotFromPricing(
  cardId: string,
  language: CardLanguage,
  pricing: unknown,
  fxRates: FxRates,
): CardPriceSnapshot {
  const pricingMap = pricing && typeof pricing === "object" ? pricing as Record<string, unknown> : {}
  const tcgplayerPrice = pickTcgplayerPrice(cardId, language, readRecord(pricingMap.tcgplayer), fxRates)
  const cardmarketPrice = pickCardmarketPrice(cardId, language, readRecord(pricingMap.cardmarket), fxRates)
  const preferredPrice = CARDMARKET_FIRST_LANGUAGES.has(language)
    ? cardmarketPrice || tcgplayerPrice
    : tcgplayerPrice || cardmarketPrice

  const snapshot = preferredPrice
    ? combineSourceEvidence(preferredPrice, [tcgplayerPrice, cardmarketPrice])
    : emptySnapshot(cardId, language)

  return {
    ...snapshot,
    buySignal: buildBuySignal(snapshot),
  }
}

function readRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function pickTcgplayerPrice(
  cardId: string,
  language: CardLanguage,
  tcgplayer: Record<string, unknown> | null | undefined,
  fxRates: FxRates,
): CardPriceSnapshot | null {
  if (!tcgplayer || typeof tcgplayer !== "object") {
    return null
  }

  for (const variantKey of TCGPLAYER_VARIANT_PRIORITY) {
    const variant = tcgplayer[variantKey]
    if (!variant || typeof variant !== "object") {
      continue
    }

    const variantRecord = variant as Record<string, unknown>
    const providerMarketAmount = readFiniteNumber(variantRecord.marketPrice)
    const midAmount = readFiniteNumber(variantRecord.midPrice)
    const lowAmount = readFiniteNumber(variantRecord.lowPrice)
    const marketAmount = providerMarketAmount ?? midAmount ?? lowAmount

    if (marketAmount == null) {
      continue
    }

    const marketGbpAmount = roundPrice(marketAmount * fxRates.usdToGbp)
    const lowGbpAmount = roundPrice((lowAmount ?? marketAmount) * fxRates.usdToGbp)
    const { rangeLow, rangeHigh } = buildPriceRange(marketAmount, lowAmount, null)
    const variantLabel = humanizeVariantLabel(variantKey)
    const updatedAt = readTimestamp(tcgplayer.updated)

    return {
      cardId,
      language,
      gbpAmount: marketGbpAmount,
      marketGbpAmount,
      goodGbpAmount: roundPrice((lowAmount ?? marketAmount * 0.8) * fxRates.usdToGbp),
      lowGbpAmount: roundPrice(rangeLow * fxRates.usdToGbp),
      highGbpAmount: roundPrice(rangeHigh * fxRates.usdToGbp),
      confidence: priceConfidence({
        hasMarket: providerMarketAmount != null || midAmount != null,
        hasLow: lowAmount != null,
        hasHigh: false,
        usedFallbackMarket: providerMarketAmount == null && midAmount == null,
      }),
      sourcePrices: [{
        source: "tcgplayer",
        label: "TCGplayer",
        variantLabel,
        marketGbpAmount,
        lowGbpAmount,
        originalMarketAmount: marketAmount,
        originalLowAmount: lowAmount,
        originalCurrency: "USD",
        updatedAt,
      }],
      trendPoints: [],
      buySignal: null,
      originalAmount: marketAmount,
      originalCurrency: "USD",
      source: "tcgplayer",
      variantLabel,
      updatedAt,
      fxDate: fxRates.date,
    }
  }

  return null
}

function pickCardmarketPrice(
  cardId: string,
  language: CardLanguage,
  cardmarket: Record<string, unknown> | null | undefined,
  fxRates: FxRates,
): CardPriceSnapshot | null {
  if (!cardmarket || typeof cardmarket !== "object") {
    return null
  }

  for (const fieldKey of CARDMARKET_FIELD_PRIORITY) {
    const amount = readFiniteNumber(cardmarket[fieldKey])

    if (amount == null) {
      continue
    }

    const cardmarketLowAmount = pickCardmarketGoodAmount(cardmarket, fieldKey)
    const goodAmount = cardmarketLowAmount ?? amount * 0.8
    const { rangeLow, rangeHigh } = buildPriceRange(amount, cardmarketLowAmount, null)
    const marketGbpAmount = roundPrice(amount * fxRates.eurToGbp)
    const lowGbpAmount = roundPrice((cardmarketLowAmount ?? amount) * fxRates.eurToGbp)
    const variantLabel = humanizeVariantLabel(fieldKey)
    const updatedAt = readTimestamp(cardmarket.updated)

    return {
      cardId,
      language,
      gbpAmount: marketGbpAmount,
      marketGbpAmount,
      goodGbpAmount: roundPrice(goodAmount * fxRates.eurToGbp),
      lowGbpAmount: roundPrice(rangeLow * fxRates.eurToGbp),
      highGbpAmount: roundPrice(rangeHigh * fxRates.eurToGbp),
      confidence: priceConfidence({
        hasMarket: !fieldKey.startsWith("low"),
        hasLow: cardmarketLowAmount != null,
        hasHigh: false,
        usedFallbackMarket: fieldKey.startsWith("low"),
      }),
      sourcePrices: [{
        source: "cardmarket",
        label: "Cardmarket",
        variantLabel,
        marketGbpAmount,
        lowGbpAmount,
        originalMarketAmount: amount,
        originalLowAmount: cardmarketLowAmount,
        originalCurrency: "EUR",
        updatedAt,
      }],
      trendPoints: buildCardmarketTrendPoints(cardmarket, fieldKey, fxRates),
      buySignal: null,
      originalAmount: amount,
      originalCurrency: "EUR",
      source: "cardmarket",
      variantLabel,
      updatedAt,
      fxDate: fxRates.date,
    }
  }

  return null
}

function buildCardmarketTrendPoints(cardmarket: Record<string, unknown>, fieldKey: string, fxRates: FxRates): CardPriceTrendPoint[] {
  const suffix = fieldKey.endsWith("-holo") ? "-holo" : ""

  return [
    ["30d", `avg30${suffix}`],
    ["7d", `avg7${suffix}`],
    ["1d", `avg1${suffix}`],
    ["Trend", fieldKey],
  ].flatMap(([label, key]) => {
    const originalAmount = readFiniteNumber(cardmarket[key])
    if (originalAmount == null) return []

    return [{
      label,
      source: "cardmarket" as const,
      gbpAmount: roundPrice(originalAmount * fxRates.eurToGbp),
      originalAmount,
      originalCurrency: "EUR" as const,
    }]
  })
}

function combineSourceEvidence(
  preferredPrice: CardPriceSnapshot,
  candidates: Array<CardPriceSnapshot | null>,
): CardPriceSnapshot {
  const sourcePrices = candidates.flatMap((candidate) => candidate?.sourcePrices ?? [])
  const trendPoints = candidates.flatMap((candidate) => candidate?.trendPoints ?? [])
  const rangeLows = candidates.flatMap((candidate) => typeof candidate?.lowGbpAmount === "number" ? [candidate.lowGbpAmount] : [])
  const rangeHighs = candidates.flatMap((candidate) => typeof candidate?.highGbpAmount === "number" ? [candidate.highGbpAmount] : [])
  const sourceMarkets = sourcePrices.flatMap((source) => typeof source.marketGbpAmount === "number" ? [source.marketGbpAmount] : [])

  return {
    ...preferredPrice,
    lowGbpAmount: rangeLows.length > 0 ? roundPrice(Math.min(...rangeLows)) : preferredPrice.lowGbpAmount,
    highGbpAmount: rangeHighs.length > 0 ? roundPrice(Math.max(...rangeHighs)) : preferredPrice.highGbpAmount,
    confidence: reconcileSourceConfidence(preferredPrice.confidence, sourceMarkets),
    sourcePrices,
    trendPoints,
    buySignal: null,
  }
}

function reconcileSourceConfidence(current: PriceConfidence, sourceMarkets: number[]): PriceConfidence {
  if (sourceMarkets.length < 2) return current

  const lowest = Math.min(...sourceMarkets)
  const highest = Math.max(...sourceMarkets)
  if (lowest <= 0) return "low"

  const spread = (highest - lowest) / lowest
  if (spread > 0.35) return "low"
  if (spread > 0.2 && current === "high") return "medium"
  return current
}

function pickCardmarketGoodAmount(cardmarket: Record<string, unknown>, marketFieldKey: string) {
  if (marketFieldKey.endsWith("-holo")) {
    return readFiniteNumber(cardmarket["low-holo"]) ?? readFiniteNumber(cardmarket.low)
  }

  for (const fieldKey of CARDMARKET_GOOD_FIELD_PRIORITY) {
    const amount = readFiniteNumber(cardmarket[fieldKey])
    if (amount != null) {
      return amount
    }
  }

  return null
}

function emptySnapshot(cardId: string, language: CardLanguage): CardPriceSnapshot {
  return {
    cardId,
    language,
    gbpAmount: null,
    marketGbpAmount: null,
    goodGbpAmount: null,
    lowGbpAmount: null,
    highGbpAmount: null,
    confidence: "unknown",
    sourcePrices: [],
    trendPoints: [],
    buySignal: null,
    originalAmount: null,
    originalCurrency: null,
    source: null,
    variantLabel: null,
    updatedAt: null,
    fxDate: null,
  }
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readTimestamp(value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }

  return null
}

function humanizeVariantLabel(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("1st", "1st")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

async function fetchEcbFxRates(): Promise<FxRates> {
  const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    next: { revalidate: 60 * 60 * 12 },
  })

  if (!response.ok) {
    throw new Error(`ECB FX feed returned ${response.status}`)
  }

  const xml = await response.text()
  const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)
  const usdMatch = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/)
  const gbpMatch = xml.match(/currency=['"]GBP['"]\s+rate=['"]([0-9.]+)['"]/)

  const date = dateMatch?.[1]
  const eurToUsd = usdMatch?.[1] ? Number.parseFloat(usdMatch[1]) : NaN
  const eurToGbp = gbpMatch?.[1] ? Number.parseFloat(gbpMatch[1]) : NaN

  if (!date || !Number.isFinite(eurToUsd) || !Number.isFinite(eurToGbp) || eurToUsd <= 0 || eurToGbp <= 0) {
    throw new Error("ECB FX feed did not include usable USD/GBP rates")
  }

  return {
    date,
    eurToGbp,
    usdToGbp: eurToGbp / eurToUsd,
  }
}

function roundPrice(amount: number) {
  return Math.round(amount * 100) / 100
}
