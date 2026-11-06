// Type-only at module level: this file is also the single source of pricing types and
// normalizers for the client (hooks/use-card-prices.ts), so it must not pull the service-role
// Supabase client into the browser bundle. The admin client is loaded lazily on the server.
import type { CardFinish } from "@/lib/domain/cards"
import { readCatalogMetadata, selectCatalogPricing } from "@/lib/card-catalog"
import { normalizePriceHistory, type CardPriceHistoryPoint } from "@/lib/card-price-history"
import type { createAdminClient } from "@/lib/supabase/admin"
import { buildBuySignal, type CardBuySignal, type PriceProvider } from "@/lib/price-intelligence"

export type { CardBuySignal }
import { applyPriceStaleness, carryForwardMissingPrice } from "@/lib/price-freshness"

export type SupportedCurrency = "USD" | "EUR" | "GBP"
export type PriceSource = PriceProvider
export type CardLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"
export type PriceConfidence = "high" | "medium" | "low" | "unknown"
export type BuySignalStatus = CardBuySignal["status"]

export interface CardPriceSourceSummary {
  productId?: string
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

export type PricedCardFinish = Extract<CardFinish, "normal" | "holo" | "reverse_holo">

// Finish quote rows for the standard printing of each finish (lower-cased variant keys, as TCGplayer and
// the Cardmarket base row name them). 1st Edition and other special printings are deliberately absent.
const STANDARD_FINISH_VARIANT_KEYS = new Set([
  "normal", "unlimited", "holo", "holofoil", "unlimited-holofoil",
  "reverse", "reverse_holo", "reverseholofoil", "reverse-holofoil", "reverse-holo",
])

/** True for a finish quote row that prices the standard printing (not 1st Edition or another special row). */
export function isStandardFinishVariantKey(variantKey: string) {
  return STANDARD_FINISH_VARIANT_KEYS.has(variantKey.toLowerCase())
}

export interface CardFinishPrice extends Omit<CardPriceSnapshot, "finishPrices" | "historyPoints"> {
  finish: PricedCardFinish
  variantKey: string
}

export interface CardPriceSnapshot {
  historyPoints?: CardPriceHistoryPoint[]
  finishPrices?: CardFinishPrice[]
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

export interface FxRates {
  date: string
  eurToGbp: number
  usdToGbp: number
  /** JPY -> GBP, used only for display; absent when the feed omits JPY. */
  jpyToGbp?: number | null
}

interface CardPriceRow {
  history_points?: unknown
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
  finish_prices?: unknown
}

interface CardExternalIdsRow {
  id: string
  local_id?: string | null
  name_en?: string | null
  rarity?: string | null
  external_ids_json: unknown
  tcg_card_external_sources?: Array<{ source: string; source_card_id: string }>
  tcg_sets?: {
    name_en?: string | null
  } | null
}

export interface TcgplayerProductDetails {
  productId?: number | string
  productName?: string
  rarityName?: string
  marketPrice?: number
  lowestPriceWithShipping?: number
  lowestPrice?: number
  setCode?: string
  setName?: string
  customAttributes?: Record<string, unknown>
}

interface PokePulseSearchItem {
  id?: number
  slug?: string
  productId?: string
  name?: string
  setName?: string
  number?: string
  rarity?: string
  material?: string
  promoInfo?: string | null
  currentPrice?: number | null
  trend7d?: number | null
  updated_at?: string | null
}

interface PokePulseMarketData {
  marketAmount: number | null
  lastSoldAmount: number | null
  averageAmount: number | null
  salesVolume: number | null
  trendPoints: CardPriceTrendPoint[]
}

interface CardPriceMetadata {
  id: string
  localId: string | null
  name: string | null
  rarity: string | null
  setName: string | null
  externalIds: unknown
}

export interface CardPriceRefreshResult {
  prices: CardPriceSnapshot[]
  refreshed: number
  cached: number
  unpriced: number
}

const FETCH_CONCURRENCY = 8
export const CARD_PRICE_CACHE_TTL_MS = 2 * 60 * 60 * 1000
export const CARD_PRICE_MISSING_CACHE_TTL_MS = 5 * 60 * 1000
export const SUPPORTED_CARD_LANGUAGES: CardLanguage[] = ["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"]
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

const TCGPLAYER_SEARCH_ENDPOINT = "https://mp-search-api.tcgplayer.com/v1/search/request"
const POKEPULSE_SEARCH_ENDPOINT = "https://pokepulse.io/api/v2/search/all"
const POKEPULSE_MARKET_DATA_ENDPOINT = "https://pokepulse.io/api/internal/market-data"
const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
const POKEPULSE_MARKET_DATA_METRICS = [
  "market_price",
  "last_sold_price",
  "average_price",
  "sales_volume",
  "price_trends",
  "cm_price",
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

/** Saved server evidence only. Never refreshes a provider; batches stay below PostgREST's row cap. */
export async function loadSavedCardPrices(lookups: CardPriceLookup[]): Promise<CardPriceSnapshot[]> {
  const requested = normalizeCardPriceLookups(lookups)
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const db = createAdminClient()
  const result: CardPriceSnapshot[] = []
  for (let offset = 0; offset < requested.length; offset += 25) {
    const batch = requested.slice(offset, offset + 25)
    const keys = new Set(batch.map(card => getCardPriceKey(card.cardId, card.language)))
    const { data, error } = await db.from("card_prices").select("*")
      .in("card_id", [...new Set(batch.map(card => card.cardId))])
      .in("language", [...new Set(batch.map(card => card.language))])
    if (error) throw new Error("Saved prices are unavailable")
    for (const row of (data ?? []) as CardPriceRow[]) {
      if (keys.has(getCardPriceKey(row.card_id, row.language))) result.push(rowToSnapshot(row))
    }
  }
  return result
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
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const supabase = createAdminClient()
  const freshByLookupKey = new Map<string, CardPriceSnapshot>()
  const previousByLookupKey = new Map<string, { snapshot: CardPriceSnapshot; fetchedAt: string | null }>()

  // Always read existing rows: they serve the cache when not forced, and are the
  // last-known-good fallback when a (forced) refresh comes back empty.
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
    const snapshot = rowToSnapshot(row)
    const lookupKey = getCardPriceKey(snapshot.cardId, snapshot.language)
    previousByLookupKey.set(lookupKey, { snapshot, fetchedAt: row.fetched_at ?? null })

    const fetchedAtMs = Date.parse(row.fetched_at)
    const ttl = snapshot.marketGbpAmount == null ? CARD_PRICE_MISSING_CACHE_TTL_MS : CARD_PRICE_CACHE_TTL_MS
    if (!options.force && Number.isFinite(fetchedAtMs) && now - fetchedAtMs < ttl && Array.isArray(row.finish_prices)) {
      freshByLookupKey.set(lookupKey, snapshot)
    }
  }

  const missingLookups = uniqueLookups.filter(
    (lookup) => !freshByLookupKey.has(getCardPriceKey(lookup.cardId, lookup.language)),
  )

  let refreshedSnapshots: CardPriceSnapshot[] = []
  if (missingLookups.length > 0) {
    const metadataByCardId = await loadCardPriceMetadata(supabase, [...new Set(missingLookups.map((lookup) => lookup.cardId))])
    const fxRates = await fetchEcbFxRates().catch((error) => {
      console.error("[binderdex] Failed to load ECB FX rates for card prices:", error)
      return null
    })
    const fetchedSnapshots = fxRates
      ? await mapWithConcurrency(
          missingLookups,
          FETCH_CONCURRENCY,
          (lookup) => fetchCardPriceSnapshot(
            lookup.cardId,
            lookup.language,
            fxRates,
            metadataByCardId.get(lookup.cardId),
          ),
        )
      : missingLookups.map((lookup) => emptySnapshot(lookup.cardId, lookup.language))

    refreshedSnapshots = fetchedSnapshots.map((snapshot) => applyPriceStaleness(
      carryForwardMissingPrice(
        withPriceHistory(snapshot, previousByLookupKey.get(getCardPriceKey(snapshot.cardId, snapshot.language))?.snapshot.historyPoints ?? []),
        previousByLookupKey.get(getCardPriceKey(snapshot.cardId, snapshot.language)),
        now,
      ),
      now,
    ))

    const rowsToUpsert = refreshedSnapshots.map((snapshot) => snapshotToRow(snapshot))
    let { error: upsertError } = await supabase
      .from("card_prices")
      .upsert(rowsToUpsert, { onConflict: "card_id,language" })

    // Keep the existing price cache writable before migration 026 is applied.
    if (upsertError?.code === "PGRST204" && upsertError.message.includes("finish_prices")) {
      const legacyRows = rowsToUpsert.map(({ finish_prices: _finishPrices, ...row }) => row)
      const result = await supabase.from("card_prices").upsert(legacyRows, { onConflict: "card_id,language" })
      upsertError = result.error
    }
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

async function loadCardPriceMetadata(
  supabase: ReturnType<typeof createAdminClient>,
  cardIds: string[],
) {
  const metadataByCardId = new Map<string, CardPriceMetadata>()
  if (cardIds.length === 0) return metadataByCardId

  const { data, error } = await supabase
    .from("tcg_cards")
    .select("id, local_id, name_en, rarity, external_ids_json, tcg_sets(name_en), tcg_card_external_sources(source,source_card_id)")
    .in("id", cardIds)

  if (error) {
    console.error("[binderdex] Failed to read card metadata for price fallback:", error)
    return metadataByCardId
  }

  for (const row of (data ?? []) as CardExternalIdsRow[]) {
    const externalIds = readRecord(row.external_ids_json) ?? {}
    const catalog = readCatalogMetadata(externalIds)
    const reviewedProduct = row.tcg_card_external_sources?.find(source => source.source === "tcgcsv-pricing" && /^[1-9]\d*$/.test(source.source_card_id))?.source_card_id
    metadataByCardId.set(row.id, {
      id: row.id,
      localId: row.local_id ?? null,
      name: row.name_en ?? null,
      rarity: row.rarity ?? null,
      setName: row.tcg_sets?.name_en ?? null,
      externalIds: reviewedProduct && !catalog.productId && !catalog.variantId
        ? { ...externalIds, catalog: { ...catalog, productId: reviewedProduct } } : externalIds,
    })
  }

  return metadataByCardId
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

  return withPriceHistory({
    finishPrices: normalizeFinishPrices(row.finish_prices),
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
  }, normalizePriceHistory(row.history_points))
}

function withPriceHistory(snapshot: CardPriceSnapshot, historyPoints: CardPriceHistoryPoint[]): CardPriceSnapshot {
  return { ...snapshot, historyPoints }
}

export function snapshotToRow(snapshot: CardPriceSnapshot) {
  return {
    finish_prices: snapshot.finishPrices ?? [],
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

export function normalizePriceConfidence(value: unknown): PriceConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "unknown"
}

export function normalizeSourcePrices(value: unknown): CardPriceSourceSummary[] {
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
      ...(normalizeProductId(record.productId) ? { productId: normalizeProductId(record.productId)! } : {}),
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

export function normalizeTrendPoints(value: unknown): CardPriceTrendPoint[] {
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

export function normalizeBuySignal(value: unknown): CardBuySignal | null {
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

export function normalizePriceSource(value: unknown): PriceSource | null {
  return value === "tcgplayer"
    || value === "cardmarket"
    || value === "ebay"
    || value === "pricecharting"
    || value === "pokescope"
    || value === "pokepulse"
    || value === "eyevo"
    || value === "public-page"
    ? value
    : null
}

export function getPriceSourceLabel(source: PriceSource) {
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
    case "pokepulse":
      return "PokePulse"
    case "eyevo":
      return "Eyevo"
    case "public-page":
      return "Public page"
  }
}

export function getBuySignalStatusLabel(status: BuySignalStatus) {
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

export async function fetchCardPriceSnapshot(
  cardId: string,
  language: CardLanguage,
  fxRates: FxRates,
  metadata?: CardPriceMetadata,
): Promise<CardPriceSnapshot> {
  let tcgdexPayload: Record<string, unknown> | null = null
  const catalog = readCatalogMetadata(metadata?.externalIds)
  const upstreamIds = catalog.tcgdexCardId
    ? [catalog.tcgdexCardId]
    : [...new Set([cardId, ...(catalog.aliasIds ?? [])])]

  for (const upstreamId of upstreamIds) {
    try {
      const response = await fetch(`https://api.tcgdex.net/v2/${encodeURIComponent(language)}/cards/${encodeURIComponent(upstreamId)}`, {
        headers: {
          Accept: "application/json",
        },
        next: { revalidate: 60 * 60 * 12 },
      })

      if (response.ok) {
        tcgdexPayload = readRecord(await response.json())
        const exact = language !== "en" && catalog.variantId ? null : selectCatalogPricing(tcgdexPayload, catalog)
        const snapshot = buildCardPriceSnapshotFromPricing(cardId, language, exact?.pricing, fxRates, readRecord(exact?.variants))
        if (snapshot.marketGbpAmount != null) return snapshot
      }
    } catch (error) {
      console.error(`[binderdex] Failed to fetch price for ${upstreamId} (${language}):`, error)
    }
  }

  // These product IDs identify English printings, not localized versions of the same artwork.
  if (language !== "en") return emptySnapshot(cardId, language)

  const exactProductSnapshot = await fetchTcgplayerProductPriceFallback(cardId, language, fxRates, metadata?.externalIds)
  if (exactProductSnapshot.marketGbpAmount != null) {
    return exactProductSnapshot
  }
  if (catalog.productId || catalog.variantId) return emptySnapshot(cardId, language)

  return await fetchTcgplayerSearchPriceFallback(cardId, language, fxRates, {
    cardId,
    name: readString(tcgdexPayload?.name) ?? metadata?.name ?? null,
    localId: readString(tcgdexPayload?.localId) ?? metadata?.localId ?? null,
    setName: readString(readRecord(tcgdexPayload?.set)?.name) ?? metadata?.setName ?? null,
    rarity: readString(tcgdexPayload?.rarity) ?? metadata?.rarity ?? null,
  })
}

export function buildCardPriceSnapshotFromPricing(
  cardId: string,
  language: CardLanguage,
  pricing: unknown,
  fxRates: FxRates,
  variants?: Record<string, unknown> | null,
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
    finishPrices: buildFinishPrices(cardId, language, pricingMap, fxRates, variants),
    buySignal: buildBuySignal(snapshot),
  }
}

async function fetchTcgplayerProductPriceFallback(
  cardId: string,
  language: CardLanguage,
  fxRates: FxRates,
  externalIds?: unknown,
) {
  const productIds = pickTcgplayerProductIdsFromExternalIds(externalIds)
  if (productIds.length === 0) {
    return emptySnapshot(cardId, language)
  }

  const productSnapshots = (
    await mapWithConcurrency(productIds, Math.min(3, productIds.length), async (productId) => {
      const details = await fetchTcgplayerProductDetails(productId).catch((error) => {
        console.error(`[binderdex] Failed to fetch TCGplayer product ${productId} for ${cardId}:`, error)
        return null
      })
      return details ? buildTcgplayerProductPriceSnapshot(cardId, language, details, fxRates) : null
    })
  ).filter((snapshot): snapshot is CardPriceSnapshot => Boolean(snapshot))

  const preferred = productSnapshots.find((snapshot) => snapshot.marketGbpAmount != null)
  if (!preferred) {
    return emptySnapshot(cardId, language)
  }

  return {
    ...combineSourceEvidence(preferred, productSnapshots),
    buySignal: buildBuySignal(preferred),
  }
}

async function fetchTcgplayerSearchPriceFallback(
  cardId: string,
  language: CardLanguage,
  fxRates: FxRates,
  card: {
    cardId: string
    name: string | null
    localId: string | null
    setName: string | null
    rarity: string | null
  },
) {
  if (language !== "en" || !card.name || !card.localId) {
    return emptySnapshot(cardId, language)
  }

  const query = buildTcgplayerSearchQuery(card)
  if (!query) {
    return emptySnapshot(cardId, language)
  }

  const products = await fetchTcgplayerSearchProducts(query).catch((error) => {
    console.error(`[binderdex] Failed to search TCGplayer for ${cardId}:`, error)
    return []
  })
  const matchedProduct = pickTcgplayerSearchProduct(card, products)
  const tcgplayerSnapshot = matchedProduct
    ? buildTcgplayerProductPriceSnapshot(cardId, language, matchedProduct, fxRates)
    : null
  const pokepulseSnapshot = await fetchPokePulseSearchPriceFallback(cardId, language, card)
  const preferredSnapshot = pokepulseSnapshot ?? tcgplayerSnapshot
  const snapshots = [pokepulseSnapshot, tcgplayerSnapshot].filter((snapshot): snapshot is CardPriceSnapshot => Boolean(snapshot))

  if (!preferredSnapshot) {
    return emptySnapshot(cardId, language)
  }

  const snapshot = combineSourceEvidence(preferredSnapshot, snapshots)

  const lowConfidenceSnapshot: CardPriceSnapshot = {
    ...snapshot,
    confidence: "low" as const,
    buySignal: null,
  }

  return {
    ...lowConfidenceSnapshot,
    buySignal: buildBuySignal(lowConfidenceSnapshot),
  }
}

function buildTcgplayerSearchQuery(card: { name: string | null; localId: string | null; setName: string | null }) {
  const parts = [
    card.localId,
    card.name,
    card.setName,
    "Pokemon",
  ].flatMap((part) => {
    const trimmed = part?.trim()
    return trimmed ? [trimmed] : []
  })

  return parts.join(" ").trim()
}

async function fetchTcgplayerSearchProducts(query: string): Promise<TcgplayerProductDetails[]> {
  const searchParams = new URLSearchParams({
    q: query,
    isList: "false",
    mpfev: "3445",
  })
  const response = await fetch(`${TCGPLAYER_SEARCH_ENDPOINT}?${searchParams}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "BinderDexPriceResearch/1.0 (+https://binder.cal.gg)",
    },
    body: JSON.stringify({
      filters: {
        term: {
          productLineName: ["pokemon"],
        },
      },
      from: 0,
      size: 12,
    }),
    next: { revalidate: 60 * 60 * 12 },
  })

  if (!response.ok) {
    return []
  }

  const payload = await response.json().catch(() => null)
  const firstResult = Array.isArray(payload?.results) ? payload.results[0] : null
  return Array.isArray(firstResult?.results) ? firstResult.results : []
}

export function pickTcgplayerSearchProduct(
  card: { name: string | null; localId: string | null; setName: string | null; rarity: string | null },
  products: TcgplayerProductDetails[],
) {
  const expectedNumber = normalizePriceMatchText(card.localId)
  const expectedName = normalizePriceMatchText(card.name)
  const expectedSetName = normalizePriceMatchText(card.setName)

  if (!expectedNumber || !expectedName) {
    return null
  }

  const scoredProducts = products.flatMap((product) => {
    const productNumber = normalizePriceMatchText(product.customAttributes?.number)
    const productName = normalizePriceMatchText(product.productName)
    const setName = normalizePriceMatchText(product.setName)
    const hasMarket = readPriceAmount(product.marketPrice) != null

    if (!hasMarket || productNumber !== expectedNumber || !productName.includes(expectedName)) {
      return []
    }

    if (setName.includes("jumbo")) {
      return []
    }

    let score = 10
    if (expectedSetName && setName === expectedSetName) score += 8
    if (expectedSetName && productName.includes(expectedSetName)) score += 6
    if (productName.includes("promo")) score += 4
    if (setName.includes("miscellaneous")) score += 1

    return [{ product, score }]
  })

  scoredProducts.sort((left, right) => right.score - left.score)
  return scoredProducts[0]?.product ?? null
}

async function fetchPokePulseSearchPriceFallback(
  cardId: string,
  language: CardLanguage,
  card: { name: string | null; localId: string | null; setName: string | null; rarity: string | null },
) {
  if (language !== "en" || !card.name || !card.localId) {
    return null
  }

  const query = buildTcgplayerSearchQuery(card)
  const searchParams = new URLSearchParams({ q: query })
  const response = await fetch(`${POKEPULSE_SEARCH_ENDPOINT}?${searchParams}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
    next: { revalidate: 60 * 60 * 12 },
  }).catch((error) => {
    console.error(`[binderdex] Failed to search PokePulse for ${cardId}:`, error)
    return null
  })

  if (!response?.ok) {
    return null
  }

  const payload = await response.json().catch(() => null)
  const items = Array.isArray(payload?.items) ? payload.items as PokePulseSearchItem[] : []
  const matchedItem = pickPokePulseSearchItem(card, items)
  if (!matchedItem) {
    return null
  }

  const marketData = await fetchPokePulseMarketData(matchedItem.productId).catch((error) => {
    console.error(`[binderdex] Failed to load PokePulse market data for ${cardId}:`, error)
    return null
  })

  return buildPokePulseSearchPriceSnapshot(cardId, language, matchedItem, marketData)
}

export function pickPokePulseSearchItem(
  card: { name: string | null; localId: string | null; setName: string | null; rarity: string | null },
  items: PokePulseSearchItem[],
) {
  const expectedNumber = normalizePriceMatchText(card.localId)
  const expectedName = normalizePriceMatchText(card.name)
  const expectedSetName = normalizePriceMatchText(card.setName)

  if (!expectedNumber || !expectedName) {
    return null
  }

  const scoredItems = items.flatMap((item) => {
    const itemNumber = normalizePriceMatchText(item.number)
    const itemName = normalizePriceMatchText(item.name)
    const itemSetName = normalizePriceMatchText(item.setName)
    const itemMaterial = normalizePriceMatchText(item.material)
    const price = readPriceAmount(item.currentPrice)

    if (price == null || itemNumber !== expectedNumber || itemName !== expectedName) {
      return []
    }

    if (itemMaterial.includes("jumbo")) {
      return []
    }

    let score = 10
    if (expectedSetName && itemSetName === expectedSetName) score += 8
    if (expectedSetName && itemSetName.includes("promo") && expectedSetName.includes("promo")) score += 4
    if (itemMaterial.includes("holo")) score += 2

    return [{ item, score }]
  })

  scoredItems.sort((left, right) => right.score - left.score)
  return scoredItems[0]?.item ?? null
}

export function buildPokePulseSearchPriceSnapshot(
  cardId: string,
  language: CardLanguage,
  item: PokePulseSearchItem,
  marketData: PokePulseMarketData | null = null,
): CardPriceSnapshot | null {
  const marketAmount = marketData?.marketAmount ?? readPriceAmount(item.currentPrice)
  if (marketAmount == null) {
    return null
  }

  const marketGbpAmount = roundPrice(marketAmount)
  const goodGbpAmount = roundPrice(marketAmount * 0.85)
  const { rangeLow, rangeHigh } = buildPriceRange(
    marketAmount,
    Math.min(
      goodGbpAmount,
      marketData?.lastSoldAmount ?? goodGbpAmount,
      marketData?.averageAmount ?? goodGbpAmount,
    ),
    Math.max(
      marketAmount,
      marketData?.lastSoldAmount ?? marketAmount,
      marketData?.averageAmount ?? marketAmount,
    ),
    0.2,
  )
  const variantLabel = item.material || item.rarity || "PokePulse"
  const previousPrice = typeof item.trend7d === "number" && Number.isFinite(item.trend7d)
    ? roundPrice(marketAmount - item.trend7d)
    : null
  const trendPoints = marketData?.trendPoints.length
    ? marketData.trendPoints
    : [
        ...(marketData?.averageAmount != null
          ? [{
              label: "Average",
              source: "pokepulse" as const,
              gbpAmount: roundPrice(marketData.averageAmount),
              originalAmount: roundPrice(marketData.averageAmount),
              originalCurrency: "GBP" as const,
            }]
          : []),
        ...(marketData?.lastSoldAmount != null
          ? [{
              label: "Last sold",
              source: "pokepulse" as const,
              gbpAmount: roundPrice(marketData.lastSoldAmount),
              originalAmount: roundPrice(marketData.lastSoldAmount),
              originalCurrency: "GBP" as const,
            }]
          : []),
        ...(previousPrice != null
          ? [{
              label: "7d",
              source: "pokepulse" as const,
              gbpAmount: previousPrice,
              originalAmount: previousPrice,
              originalCurrency: "GBP" as const,
            }]
          : []),
        {
          label: "Now",
          source: "pokepulse" as const,
          gbpAmount: marketGbpAmount,
          originalAmount: marketAmount,
          originalCurrency: "GBP" as const,
        },
      ]
  const confidence: PriceConfidence = marketData
    ? marketData.trendPoints.length > 0 || marketData.lastSoldAmount != null || (marketData.salesVolume ?? 0) > 0
      ? "medium"
      : "low"
    : "low"

  return {
    cardId,
    language,
    gbpAmount: marketGbpAmount,
    marketGbpAmount,
    goodGbpAmount,
    lowGbpAmount: roundPrice(rangeLow),
    highGbpAmount: roundPrice(rangeHigh),
    confidence,
    sourcePrices: [{
      source: "pokepulse",
      label: marketData ? "PokePulse market data" : "PokePulse search",
      variantLabel,
      marketGbpAmount,
      lowGbpAmount: goodGbpAmount,
      originalMarketAmount: marketAmount,
      originalLowAmount: marketData?.lastSoldAmount ?? goodGbpAmount,
      originalCurrency: "GBP",
      updatedAt: item.updated_at ?? null,
    }],
    trendPoints,
    buySignal: null,
    originalAmount: marketAmount,
    originalCurrency: null,
    source: "pokepulse",
    variantLabel,
    updatedAt: item.updated_at ?? null,
    fxDate: null,
  }
}

async function fetchPokePulseMarketData(productId: string | null | undefined): Promise<PokePulseMarketData | null> {
  const trimmedProductId = productId?.trim()
  if (!trimmedProductId) {
    return null
  }

  const cookie = process.env.POKEPULSE_COOKIE?.trim()
  const csrfToken = process.env.POKEPULSE_CSRF_TOKEN?.trim()
  if (!cookie || !csrfToken) {
    return null
  }

  const response = await fetch(POKEPULSE_MARKET_DATA_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://pokepulse.io",
      Referer: "https://pokepulse.io/",
      "User-Agent": BROWSER_USER_AGENT,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({
      productIds: [trimmedProductId],
      metrics: POKEPULSE_MARKET_DATA_METRICS,
    }),
    next: { revalidate: 60 * 60 * 2 },
  })

  if (!response.ok) {
    return null
  }

  const payload = await response.json().catch(() => null)
  const record = pickPokePulseMarketDataRecord(payload, trimmedProductId)
  return record ? normalizePokePulseMarketData(record) : null
}

export function pickPokePulseMarketDataRecord(payload: unknown, productId: string) {
  const root = readRecord(payload)
  const candidates = [
    root,
    readRecord(root?.data),
    readRecord(root?.marketData),
    readRecord(root?.products),
    readRecord(root?.results),
  ]

  for (const candidate of candidates) {
    const directRecord = readRecord(candidate?.[productId])
    if (directRecord) return directRecord
  }

  for (const candidate of candidates) {
    for (const value of Object.values(candidate ?? {})) {
      const record = readRecord(value)
      if (record && readString(record.productId) === productId) return record
    }
  }

  const arrays = [
    Array.isArray(root?.data) ? root?.data : null,
    Array.isArray(root?.marketData) ? root?.marketData : null,
    Array.isArray(root?.products) ? root?.products : null,
    Array.isArray(root?.results) ? root?.results : null,
  ]

  for (const array of arrays) {
    const record = array?.map((item) => readRecord(item)).find((item) => readString(item?.productId) === productId)
    if (record) return record
  }

  return null
}

export function normalizePokePulseMarketData(record: Record<string, unknown>): PokePulseMarketData {
  const salesVolume = readMetricAmount(record, ["sales_volume", "salesVolume", "volume"])
  return {
    marketAmount: readPriceAmount(readMetricAmount(record, ["market_price", "marketPrice", "currentPrice", "cm_price", "cmPrice"])),
    lastSoldAmount: readPriceAmount(readMetricAmount(record, ["last_sold_price", "lastSoldPrice", "lastSold", "last_sale_price"])),
    averageAmount: readPriceAmount(readMetricAmount(record, ["average_price", "averagePrice", "avgPrice", "avg"])),
    salesVolume: salesVolume != null && salesVolume >= 0 ? salesVolume : null,
    trendPoints: readPokePulseMarketTrendPoints(record).slice(-12),
  }
}

function readMetricAmount(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    const directAmount = readFiniteNumber(value)
    if (directAmount != null) return directAmount

    const nested = readRecord(value)
    if (nested) {
      const nestedAmount = readFiniteNumber(nested.value)
        ?? readFiniteNumber(nested.amount)
        ?? readFiniteNumber(nested.price)
        ?? readFiniteNumber(nested.current)
      if (nestedAmount != null) return nestedAmount
    }
  }

  return null
}

function readPokePulseMarketTrendPoints(record: Record<string, unknown>): CardPriceTrendPoint[] {
  const value = record.price_trends ?? record.priceTrends ?? record.priceHistory ?? record.history
  const nestedPoints = readRecord(value)?.points
  const points: unknown[] = Array.isArray(value)
    ? value
    : Array.isArray(nestedPoints)
      ? nestedPoints
      : []

  return points.flatMap((point) => {
    const pointRecord = readRecord(point)
    if (!pointRecord) return []

    const amount = readPriceAmount(pointRecord.price)
      ?? readPriceAmount(pointRecord.value)
      ?? readPriceAmount(pointRecord.amount)
      ?? readPriceAmount(pointRecord.market_price)
      ?? readPriceAmount(pointRecord.marketPrice)
    if (amount == null) return []

    const label = readString(pointRecord.date)
      ?? readString(pointRecord.soldAt)
      ?? readString(pointRecord.timestamp)
      ?? readString(pointRecord.label)
      ?? "History"

    return [{
      label,
      source: "pokepulse" as const,
      gbpAmount: roundPrice(amount),
      originalAmount: roundPrice(amount),
      originalCurrency: "GBP" as const,
    }]
  })
}

async function fetchTcgplayerProductDetails(productId: string): Promise<TcgplayerProductDetails | null> {
  const response = await fetch(
    `https://mp-search-api.tcgplayer.com/v1/product/${encodeURIComponent(productId)}/details?mpfev=3445`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "BinderDexPriceResearch/1.0 (+https://binder.cal.gg)",
      },
      next: { revalidate: 60 * 60 * 12 },
    },
  )

  if (!response.ok) {
    return null
  }

  const payload = await response.json()
  return payload && typeof payload === "object" ? payload as TcgplayerProductDetails : null
}

export function pickTcgplayerProductIdsFromExternalIds(value: unknown) {
  const exactProduct = readCatalogMetadata(value).productId
  if (exactProduct) return [exactProduct]
  const ids = new Set<string>()
  const externalIds = readRecord(value)
  const tcgdex = readRecord(externalIds?.tcgdex)
  const directThirdParty = readRecord(tcgdex?.thirdParty)
  const directId = normalizeProductId(directThirdParty?.tcgplayer)

  if (directId) {
    ids.add(directId)
  }

  if (Array.isArray(tcgdex?.variantThirdParty)) {
    for (const candidate of tcgdex.variantThirdParty) {
      const productId = normalizeProductId(readRecord(candidate)?.tcgplayer)
      if (productId) {
        ids.add(productId)
      }
    }
  }

  return [...ids]
}

export function buildTcgplayerProductPriceSnapshot(
  cardId: string,
  language: CardLanguage,
  product: TcgplayerProductDetails,
  fxRates: FxRates,
): CardPriceSnapshot | null {
  const marketAmount = readPriceAmount(product.marketPrice)
  const lowAmount = readPriceAmount(product.lowestPriceWithShipping) ?? readPriceAmount(product.lowestPrice)

  if (marketAmount == null) {
    return null
  }

  const productId = normalizeProductId(product.productId)
  const lowOrMarketAmount = lowAmount ?? marketAmount
  const marketGbpAmount = roundPrice(marketAmount * fxRates.usdToGbp)
  const lowGbpAmount = roundPrice(lowOrMarketAmount * fxRates.usdToGbp)
  const { rangeLow, rangeHigh } = buildPriceRange(marketAmount, lowOrMarketAmount, null)
  const variantLabel = typeof product.rarityName === "string" && product.rarityName.length > 0
    ? product.rarityName
    : typeof product.productName === "string" && product.productName.length > 0
      ? product.productName
      : productId ? `Product ${productId}` : "Product"

  return {
    cardId,
    language,
    gbpAmount: marketGbpAmount,
    marketGbpAmount,
    goodGbpAmount: lowGbpAmount,
    lowGbpAmount: roundPrice(rangeLow * fxRates.usdToGbp),
    highGbpAmount: roundPrice(rangeHigh * fxRates.usdToGbp),
    confidence: "medium",
    sourcePrices: [{
      source: "tcgplayer",
      ...(productId ? { productId } : {}),
      label: productId ? `TCGplayer #${productId}` : "TCGplayer",
      variantLabel,
      marketGbpAmount,
      lowGbpAmount,
      originalMarketAmount: marketAmount,
      originalLowAmount: lowAmount,
      originalCurrency: "USD",
      updatedAt: null,
    }],
    trendPoints: [],
    buySignal: null,
    originalAmount: marketAmount,
    originalCurrency: "USD",
    source: "tcgplayer",
    variantLabel,
    updatedAt: null,
    fxDate: fxRates.date,
  }
}

function normalizeProductId(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value)
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim()
  }

  return null
}

function normalizePriceMatchText(value: unknown) {
  return typeof value === "string"
    ? value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : ""
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function readRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function pickTcgplayerPrice(
  cardId: string,
  language: CardLanguage,
  tcgplayer: Record<string, unknown> | null | undefined,
  fxRates: FxRates,
  variantKeys: readonly string[] = TCGPLAYER_VARIANT_PRIORITY,
): CardPriceSnapshot | null {
  if (!tcgplayer || typeof tcgplayer !== "object") {
    return null
  }

  for (const variantKey of variantKeys) {
    const variant = tcgplayer[variantKey]
    if (!variant || typeof variant !== "object") {
      continue
    }

    const variantRecord = variant as Record<string, unknown>
    const providerMarketAmount = readPriceAmount(variantRecord.marketPrice)
    const midAmount = readPriceAmount(variantRecord.midPrice)
    const lowAmount = readPriceAmount(variantRecord.lowPrice)
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
        ...(normalizeProductId(variantRecord.productId) ? { productId: normalizeProductId(variantRecord.productId)! } : {}),
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
  fieldKeys: readonly string[] = CARDMARKET_FIELD_PRIORITY,
): CardPriceSnapshot | null {
  if (!cardmarket || typeof cardmarket !== "object") {
    return null
  }

  for (const fieldKey of fieldKeys) {
    const amount = readPriceAmount(cardmarket[fieldKey])

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
    const originalAmount = readPriceAmount(cardmarket[key])
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
    return readPriceAmount(cardmarket["low-holo"]) ?? readPriceAmount(cardmarket.low)
  }

  for (const fieldKey of CARDMARKET_GOOD_FIELD_PRIORITY) {
    const amount = readPriceAmount(cardmarket[fieldKey])
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

/**
 * Provider price fields: a usable price is a finite number strictly above zero.
 * Providers use 0 / negative / NaN for "no listings"; treating those as real prices
 * produced £0.00 markets and dragged ranges and good-buy targets to zero.
 */
export function readPriceAmount(value: unknown) {
  const amount = readFiniteNumber(value)
  return amount != null && amount > 0 ? amount : null
}

/** Plausible bounds for ECB reference rates; anything outside is treated as a broken feed. */
const FX_SANITY_BOUNDS = {
  eurToGbp: { min: 0.5, max: 1.5 },
  eurToUsd: { min: 0.6, max: 2 },
} as const

/** Parses the ECB daily reference-rate XML into EUR->GBP and USD->GBP rates, rejecting implausible feeds. */
export function parseEcbFxRates(xml: string): FxRates {
  const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)
  const usdMatch = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/)
  const gbpMatch = xml.match(/currency=['"]GBP['"]\s+rate=['"]([0-9.]+)['"]/)
  const jpyMatch = xml.match(/currency=['"]JPY['"]\s+rate=['"]([0-9.]+)['"]/)

  const date = dateMatch?.[1]
  const eurToUsd = usdMatch?.[1] ? Number.parseFloat(usdMatch[1]) : NaN
  const eurToGbp = gbpMatch?.[1] ? Number.parseFloat(gbpMatch[1]) : NaN

  if (!date || !Number.isFinite(eurToUsd) || !Number.isFinite(eurToGbp) || eurToUsd <= 0 || eurToGbp <= 0) {
    throw new Error("ECB FX feed did not include usable USD/GBP rates")
  }

  if (
    eurToGbp < FX_SANITY_BOUNDS.eurToGbp.min || eurToGbp > FX_SANITY_BOUNDS.eurToGbp.max
    || eurToUsd < FX_SANITY_BOUNDS.eurToUsd.min || eurToUsd > FX_SANITY_BOUNDS.eurToUsd.max
  ) {
    throw new Error(`ECB FX feed rates out of bounds (EUR/GBP ${eurToGbp}, EUR/USD ${eurToUsd})`)
  }

  const eurToJpy = jpyMatch?.[1] ? Number.parseFloat(jpyMatch[1]) : NaN
  // JPY is display-only, so an implausible JPY rate is dropped rather than failing the feed.
  const jpyToGbp = Number.isFinite(eurToJpy) && eurToJpy >= 50 && eurToJpy <= 400 ? eurToGbp / eurToJpy : null

  return {
    date,
    eurToGbp,
    usdToGbp: eurToGbp / eurToUsd,
    jpyToGbp,
  }
}

/** Today's ECB rates for client-side currency display, or null when the feed is unavailable. */
export async function loadDisplayFxRates(): Promise<FxRates | null> {
  return fetchEcbFxRates().catch((error) => {
    console.error("[binderdex] Failed to load ECB FX rates for display:", error)
    return null
  })
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

  return parseEcbFxRates(await response.text())
}

function roundPrice(amount: number) {
  return Math.round(amount * 100) / 100
}

export function normalizeFinishPrices(value: unknown): CardFinishPrice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const price = readRecord(raw)
    if (!price || typeof price.cardId !== "string" || typeof price.variantKey !== "string"
      || !["normal", "holo", "reverse_holo"].includes(String(price.finish))) return []
    const snapshot = emptySnapshot(price.cardId, normalizeCardLanguage(price.language))
    return [{
      ...snapshot,
      finish: price.finish as PricedCardFinish,
      variantKey: price.variantKey,
      gbpAmount: readPriceAmount(price.gbpAmount),
      marketGbpAmount: readPriceAmount(price.marketGbpAmount),
      goodGbpAmount: readPriceAmount(price.goodGbpAmount),
      lowGbpAmount: readPriceAmount(price.lowGbpAmount),
      highGbpAmount: readPriceAmount(price.highGbpAmount),
      confidence: normalizePriceConfidence(price.confidence),
      sourcePrices: normalizeSourcePrices(price.sourcePrices),
      trendPoints: normalizeTrendPoints(price.trendPoints),
      source: normalizePriceSource(price.source),
      variantLabel: readString(price.variantLabel),
      updatedAt: readString(price.updatedAt),
      fxDate: readString(price.fxDate),
      originalAmount: readPriceAmount(price.originalAmount),
      originalCurrency: price.originalCurrency === "USD" || price.originalCurrency === "EUR" ? price.originalCurrency : null,
    }]
  })
}

function buildFinishPrices(
  cardId: string,
  language: CardLanguage,
  pricing: Record<string, unknown>,
  fxRates: FxRates,
  variants?: Record<string, unknown> | null,
): CardFinishPrice[] {
  // Cardmarket's base row can be assigned only when metadata identifies one base finish.
  // shortcut: ambiguous foil rows are excluded, include them when the provider identifies exact finishes.
  const baseFinish = variants?.normal === true && variants?.holo === false ? "normal"
    : variants?.holo === true && variants?.normal === false ? "holo" : null
  const cardmarket = baseFinish ? pickCardmarketPrice(cardId, language, Object.fromEntries(Object.entries(readRecord(pricing.cardmarket) ?? {}).filter(([key]) => !key.includes("holo"))), fxRates,
    ["trend", "avg30", "avg7", "avg1", "avg", "low"]) : null
  const prices: CardFinishPrice[] = []
  for (const variantKey of TCGPLAYER_VARIANT_PRIORITY) {
    const tcgplayer = pickTcgplayerPrice(cardId, language, readRecord(pricing.tcgplayer), fxRates, [variantKey])
    if (!tcgplayer) continue
    const finish: PricedCardFinish = variantKey.toLowerCase().includes("reverse") ? "reverse_holo"
      : variantKey.includes("holo") ? "holo" : "normal"
    const isStandard = ["normal", "unlimited", "holo", "holofoil", "unlimited-holofoil"].includes(variantKey)
    const sameFinishMarket = isStandard && finish === baseFinish ? cardmarket : null
    const preferred = CARDMARKET_FIRST_LANGUAGES.has(language) ? sameFinishMarket ?? tcgplayer : tcgplayer
    const combined = combineSourceEvidence(preferred, [tcgplayer, sameFinishMarket])
    const timestamps = [tcgplayer.updatedAt, sameFinishMarket?.updatedAt].filter((date): date is string => typeof date === "string" && Number.isFinite(Date.parse(date)))
    prices.push({ ...combined, finish, variantKey,
      updatedAt: Number.isFinite(Date.parse(preferred.updatedAt ?? ""))
        ? timestamps.sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null : null,
      trendPoints: sameFinishMarket?.updatedAt ? combined.trendPoints : [],
    })
  }
  if (cardmarket && baseFinish && !prices.some((price) => price.finish === baseFinish && ["normal", "unlimited", "holo", "holofoil", "unlimited-holofoil"].includes(price.variantKey))) {
    prices.push({ ...cardmarket, finish: baseFinish, variantKey: baseFinish, variantLabel: baseFinish === "normal" ? "Non-holo" : "Holo" })
  }
  return prices
}
