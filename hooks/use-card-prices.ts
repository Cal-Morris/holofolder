"use client"

import { useEffect, useMemo, useState } from "react"

export type SupportedCurrency = "USD" | "EUR" | "GBP"
export type PriceSource = "tcgplayer" | "cardmarket" | "ebay" | "pricecharting" | "pokescope" | "pokepulse" | "eyevo" | "public-page"
export type PriceConfidence = "high" | "medium" | "low" | "unknown"
export type CardLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"
export type BuySignalStatus = "good" | "fair" | "hold" | "rising"

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

export interface CardBuySignal {
  status: BuySignalStatus
  label: string
  reason: string
}

export interface CardPriceLookup {
  cardId: string
  language?: CardLanguage | string | null
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
  fetchedAt: number
}

const CARD_PRICE_CACHE_KEY = "binderdex_card_price_cache_v7"
export const CARD_PRICE_CACHE_STALE_MS = 2 * 60 * 60 * 1000
const CARD_PRICE_REQUEST_BATCH_SIZE = 200
const SUPPORTED_CARD_LANGUAGES: CardLanguage[] = ["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"]

export interface CardPriceFetchBatch {
  force: boolean
  lookups: CardPriceLookup[]
}

export interface CardPriceFetchPlan {
  cachedPrices: Record<string, CardPriceSnapshot>
  fetchBatches: CardPriceFetchBatch[]
}

export function buildCardPriceFetchPlan(
  lookups: Array<string | CardPriceLookup>,
  cache: Record<string, CardPriceSnapshot>,
  options: { isOnline?: boolean; now?: number; batchSize?: number } = {},
): CardPriceFetchPlan {
  const now = options.now ?? Date.now()
  const batchSize = options.batchSize ?? CARD_PRICE_REQUEST_BATCH_SIZE
  const cachedPrices: Record<string, CardPriceSnapshot> = {}
  const missingLookups: CardPriceLookup[] = []
  const staleLookups: CardPriceLookup[] = []

  for (const lookup of normalizeCardPriceLookups(lookups)) {
    const cacheKey = getCardPriceKey(lookup.cardId, lookup.language)
    const cached = cache[cacheKey]

    if (!cached) {
      missingLookups.push(lookup)
      continue
    }

    cachedPrices[cacheKey] = cached
    if (now - cached.fetchedAt >= CARD_PRICE_CACHE_STALE_MS) {
      staleLookups.push(lookup)
    }
  }

  const fetchBatches: CardPriceFetchBatch[] = []
  if (options.isOnline !== false) {
    for (const batch of chunkCardPriceLookups(staleLookups, batchSize)) {
      fetchBatches.push({ force: true, lookups: batch })
    }
    for (const batch of chunkCardPriceLookups(missingLookups, batchSize)) {
      fetchBatches.push({ force: false, lookups: batch })
    }
  }

  return { cachedPrices, fetchBatches }
}

export function normalizeCardLanguage(value: unknown): CardLanguage {
  if (typeof value !== "string") return "en"
  const normalized = value.trim().toLowerCase()
  return SUPPORTED_CARD_LANGUAGES.includes(normalized as CardLanguage) ? normalized as CardLanguage : "en"
}

export function getCardPriceKey(cardId: string, language: unknown = "en") {
  return `${cardId}::${normalizeCardLanguage(language)}`
}

export function normalizeCardPriceLookups(cardLookups: Array<string | CardPriceLookup>) {
  const byKey = new Map<string, CardPriceLookup>()

  for (const lookup of cardLookups) {
    const cardId = typeof lookup === "string" ? lookup : lookup?.cardId
    if (typeof cardId !== "string" || cardId.length === 0) {
      continue
    }

    const language = normalizeCardLanguage(typeof lookup === "string" ? "en" : lookup.language)
    byKey.set(getCardPriceKey(cardId, language), { cardId, language })
  }

  return [...byKey.values()].sort((left, right) => {
    const cardComparison = left.cardId.localeCompare(right.cardId)
    return cardComparison === 0
      ? normalizeCardLanguage(left.language).localeCompare(normalizeCardLanguage(right.language))
      : cardComparison
  })
}

export function useCardPrices(cardLookups: Array<string | CardPriceLookup>, enabled: boolean) {
  const [pricesByCardId, setPricesByCardId] = useState<Record<string, CardPriceSnapshot>>({})
  const [isLoading, setIsLoading] = useState(false)

  const stableLookups = useMemo(
    () => normalizeCardPriceLookups(cardLookups),
    [cardLookups],
  )

  const requestKey = stableLookups.map((lookup) => getCardPriceKey(lookup.cardId, lookup.language)).join(",")

  useEffect(() => {
    if (!enabled || stableLookups.length === 0) {
      return
    }

    const cache = readPriceCache()
    const plan = buildCardPriceFetchPlan(stableLookups, cache, {
      isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
    })

    setPricesByCardId((current) => ({ ...current, ...plan.cachedPrices }))

    if (plan.fetchBatches.length === 0) {
      return
    }

    let cancelled = false
    setIsLoading(true)

    void Promise.all(plan.fetchBatches.map((batch) => fetch("/api/card-prices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cards: batch.lookups, force: batch.force }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Price API returned ${response.status}`)
        }

        const payload = await response.json()
        return Array.isArray(payload?.prices) ? payload.prices : []
      })))
      .then((priceBatches) => {
        const mergedCache = readPriceCache()
        const updates: Record<string, CardPriceSnapshot> = {}

        for (const fetchedPrices of priceBatches) {
          for (const price of fetchedPrices) {
            if (!price || typeof price.cardId !== "string") {
              continue
            }

            const snapshot: CardPriceSnapshot = {
              cardId: price.cardId,
              language: normalizeCardLanguage(price.language),
              gbpAmount: typeof price.gbpAmount === "number" && Number.isFinite(price.gbpAmount) ? price.gbpAmount : null,
              marketGbpAmount: typeof price.marketGbpAmount === "number" && Number.isFinite(price.marketGbpAmount)
                ? price.marketGbpAmount
                : typeof price.gbpAmount === "number" && Number.isFinite(price.gbpAmount)
                  ? price.gbpAmount
                  : null,
              goodGbpAmount: typeof price.goodGbpAmount === "number" && Number.isFinite(price.goodGbpAmount) ? price.goodGbpAmount : null,
              lowGbpAmount: typeof price.lowGbpAmount === "number" && Number.isFinite(price.lowGbpAmount) ? price.lowGbpAmount : null,
              highGbpAmount: typeof price.highGbpAmount === "number" && Number.isFinite(price.highGbpAmount) ? price.highGbpAmount : null,
              confidence: normalizePriceConfidence(price.confidence),
              sourcePrices: normalizeSourcePrices(price.sourcePrices),
              trendPoints: normalizeTrendPoints(price.trendPoints),
              buySignal: normalizeBuySignal(price.buySignal),
              originalAmount: typeof price.originalAmount === "number" && Number.isFinite(price.originalAmount) ? price.originalAmount : null,
              originalCurrency: price.originalCurrency === "USD" || price.originalCurrency === "EUR" ? price.originalCurrency : null,
              source: normalizePriceSource(price.source),
              variantLabel: typeof price.variantLabel === "string" ? price.variantLabel : null,
              updatedAt: typeof price.updatedAt === "string" ? price.updatedAt : null,
              fxDate: typeof price.fxDate === "string" ? price.fxDate : null,
              fetchedAt: Date.now(),
            }
            const cacheKey = getCardPriceKey(snapshot.cardId, snapshot.language)

            updates[cacheKey] = snapshot
            mergedCache[cacheKey] = snapshot
          }
        }

        writePriceCache(mergedCache)

        if (!cancelled) {
          setPricesByCardId((current) => ({ ...current, ...updates }))
        }
      })
      .catch((error) => {
        console.error("[binderdex] Failed to fetch card prices:", error)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [enabled, requestKey, stableLookups])

  return {
    pricesByCardId,
    isLoading,
  }
}

function readPriceCache(): Record<string, CardPriceSnapshot> {
  try {
    const raw = localStorage.getItem(CARD_PRICE_CACHE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}

    const normalized: Record<string, CardPriceSnapshot> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || typeof (value as { cardId?: unknown }).cardId !== "string") {
        continue
      }

      const snapshot = value as CardPriceSnapshot
      normalized[key] = {
        ...snapshot,
        marketGbpAmount: typeof snapshot.marketGbpAmount === "number" && Number.isFinite(snapshot.marketGbpAmount)
          ? snapshot.marketGbpAmount
          : snapshot.gbpAmount,
        goodGbpAmount: typeof snapshot.goodGbpAmount === "number" && Number.isFinite(snapshot.goodGbpAmount)
          ? snapshot.goodGbpAmount
          : null,
        lowGbpAmount: typeof snapshot.lowGbpAmount === "number" && Number.isFinite(snapshot.lowGbpAmount)
          ? snapshot.lowGbpAmount
          : null,
        highGbpAmount: typeof snapshot.highGbpAmount === "number" && Number.isFinite(snapshot.highGbpAmount)
          ? snapshot.highGbpAmount
          : null,
        confidence: normalizePriceConfidence(snapshot.confidence),
        sourcePrices: normalizeSourcePrices(snapshot.sourcePrices),
        trendPoints: normalizeTrendPoints(snapshot.trendPoints),
        buySignal: normalizeBuySignal(snapshot.buySignal),
      }
    }
    return normalized
  } catch {
    return {}
  }
}

function normalizePriceConfidence(value: unknown): PriceConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "unknown"
}

function normalizeSourcePrices(value: unknown): CardPriceSourceSummary[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
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
      marketGbpAmount: readFiniteNumber(record.marketGbpAmount),
      lowGbpAmount: readFiniteNumber(record.lowGbpAmount),
      originalMarketAmount: readFiniteNumber(record.originalMarketAmount),
      originalLowAmount: readFiniteNumber(record.originalLowAmount),
      originalCurrency,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    }]
  })
}

function normalizeTrendPoints(value: unknown): CardPriceTrendPoint[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const record = item as Record<string, unknown>
    const source = normalizePriceSource(record.source)
    const originalCurrency = record.originalCurrency === "USD" || record.originalCurrency === "EUR" || record.originalCurrency === "GBP"
      ? record.originalCurrency
      : null
    const gbpAmount = readFiniteNumber(record.gbpAmount)
    const originalAmount = readFiniteNumber(record.originalAmount)

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

function getBuySignalStatusLabel(status: BuySignalStatus) {
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

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function chunkCardPriceLookups(lookups: CardPriceLookup[], batchSize: number) {
  if (lookups.length === 0) return []

  const chunks: CardPriceLookup[][] = []
  for (let index = 0; index < lookups.length; index += batchSize) {
    chunks.push(lookups.slice(index, index + batchSize))
  }
  return chunks
}

function writePriceCache(cache: Record<string, CardPriceSnapshot>) {
  try {
    localStorage.setItem(CARD_PRICE_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // ignore cache writes
  }
}
