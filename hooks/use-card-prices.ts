"use client"

import { useEffect, useMemo, useState } from "react"
import { normalizeDisplayFxRates, type DisplayFxRates } from "@/lib/regional-price"
import { normalizePriceHistory } from "@/lib/card-price-history"
import { mapWithConcurrency } from "@/lib/card-db-sync-concurrency"
import { getOfflineStore, type OfflineKeyValueStore } from "@/lib/offline-store/kv"

import {
  CARD_PRICE_MISSING_CACHE_TTL_MS,
  getCardPriceKey,
  normalizeFinishPrices,
  normalizeBuySignal,
  normalizeCardLanguage,
  normalizePriceConfidence,
  normalizePriceSource,
  normalizeSourcePrices,
  normalizeTrendPoints,
  type CardLanguage,
  type CardPriceSnapshot as ServerCardPriceSnapshot,
} from "@/lib/card-pricing"

// lib/card-pricing.ts is the single source of pricing types and normalizers; re-exported here
// so existing client imports keep working.
export type {
  BuySignalStatus,
  CardBuySignal,
  CardLanguage,
  CardPriceSourceSummary,
  CardPriceTrendPoint,
  PriceConfidence,
  PriceSource,
  SupportedCurrency,
} from "@/lib/card-pricing"
export {
  getBuySignalStatusLabel,
  getCardPriceKey,
  getPriceSourceLabel,
  normalizeBuySignal,
  normalizeCardLanguage,
  normalizePriceConfidence,
  normalizePriceSource,
  normalizeSourcePrices,
  normalizeTrendPoints,
} from "@/lib/card-pricing"

export interface CardPriceLookup {
  cardId: string
  language?: CardLanguage | string | null
}

/** Client copy of a server snapshot, stamped with when this browser fetched it. */
export interface CardPriceSnapshot extends ServerCardPriceSnapshot {
  fetchedAt: number
}

const CARD_PRICE_CACHE_KEY = "binderdex_card_price_cache_v7"
export const CARD_PRICE_CACHE_STALE_MS = 2 * 60 * 60 * 1000
const CARD_PRICE_REQUEST_BATCH_SIZE = 25

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
    const ttl = cached.marketGbpAmount == null ? CARD_PRICE_MISSING_CACHE_TTL_MS : CARD_PRICE_CACHE_STALE_MS
    if (now - cached.fetchedAt >= ttl || cached.finishPrices === undefined || cached.historyPoints === undefined) {
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
  const [fxRates, setFxRates] = useState<DisplayFxRates | null>(null)

  // Keyed by content, not array identity: callers often rebuild the same lookups each render (e.g. while
  // a search is loading), and a new array per render would re-run the effect below in a loop.
  const requestKey = normalizeCardPriceLookups(cardLookups).map((lookup) => getCardPriceKey(lookup.cardId, lookup.language)).join(",")
  const stableLookups = useMemo(
    () => (requestKey ? requestKey.split(",").map((key) => {
      const separator = key.lastIndexOf("::")
      return { cardId: key.slice(0, separator), language: key.slice(separator + 2) } as CardPriceLookup
    }) : []),
    [requestKey],
  )

  useEffect(() => {
    if (!enabled || stableLookups.length === 0) {
      return
    }

    const cache = readPriceCache()
    const plan = buildCardPriceFetchPlan(stableLookups, cache, {
      isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
    })

    let cancelled = false
    setPricesByCardId((current) => ({ ...current, ...plan.cachedPrices }))
    void loadPriceEvidence(stableLookups).then(evidence => {
      if (cancelled) return
      setPricesByCardId(current => {
        const merged = { ...current }
        for (const price of evidence) {
          const key = getCardPriceKey(price.cardId, price.language)
          if (!merged[key] || price.fetchedAt >= merged[key].fetchedAt) merged[key] = price
        }
        return merged
      })
    }).catch(() => undefined)

    if (plan.fetchBatches.length === 0) {
      return () => { cancelled = true }
    }

    setIsLoading(true)

    void mapWithConcurrency(plan.fetchBatches, 2, (batch) => cancelled ? Promise.resolve([]) : fetch("/api/card-prices", {
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
        const fx = normalizeDisplayFxRates(payload?.fx)
        if (fx && !cancelled) {
          setFxRates((current) => (current?.date === fx.date && current.jpyToGbp === fx.jpyToGbp ? current : fx))
        }
        return Array.isArray(payload?.prices) ? payload.prices : []
      }))
      .then((priceBatches) => {
        const mergedCache = readPriceCache()
        const updates: Record<string, CardPriceSnapshot> = {}

        for (const fetchedPrices of priceBatches) {
          for (const price of fetchedPrices) {
            if (!price || typeof price.cardId !== "string") {
              continue
            }

            const snapshot = normalizeFetchedCardPrice(price)
            if (!snapshot) continue
            const cacheKey = getCardPriceKey(snapshot.cardId, snapshot.language)

            updates[cacheKey] = snapshot
            mergedCache[cacheKey] = snapshot
          }
        }

        writePriceCache(mergedCache)
        void persistPriceEvidence(Object.values(updates)).catch(() => undefined)

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
  }, [enabled, stableLookups])

  return {
    pricesByCardId,
    isLoading,
    /** Latest ECB rates from the price API, for converting into the user's display currency. */
    fxRates,
  }
}

function normalizeFetchedCardPrice(value: unknown): CardPriceSnapshot | null {
  if (!value || typeof value !== "object" || typeof (value as { cardId?: unknown }).cardId !== "string") return null
  const price = value as Partial<CardPriceSnapshot> & { cardId: string }
  const snapshot: CardPriceSnapshot = {
    historyPoints: normalizePriceHistory(price.historyPoints),
    finishPrices: normalizeFinishPrices(price.finishPrices),
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
  return snapshot
}

/** Unlike background cache writes, a card-show download must report storage failure. */
export async function saveCardPricesForOffline(prices: unknown[], store = getOfflineStore()) {
  const cache = readPriceCache()
  const updates: CardPriceSnapshot[] = []
  for (const value of prices) {
    const price = normalizeFetchedCardPrice(value)
    if (price) {
      cache[getCardPriceKey(price.cardId, price.language)] = price
      updates.push(price)
    }
  }
  await persistPriceEvidence(updates, store)
  localStorage.setItem(CARD_PRICE_CACHE_KEY, compactPriceCache(cache))
}

async function persistPriceEvidence(prices: CardPriceSnapshot[], store = getOfflineStore()) {
  if (!store) throw new Error("Offline price storage is unavailable on this device")
  await mapWithConcurrency(prices, 4, price => store.set(`price-evidence:${getCardPriceKey(price.cardId, price.language)}`, price))
}

async function loadPriceEvidence(lookups: CardPriceLookup[], store: OfflineKeyValueStore | null = getOfflineStore()) {
  if (!store) return []
  const results = await mapWithConcurrency(lookups, 8, async lookup => {
    const saved = await store.get<CardPriceSnapshot>(`price-evidence:${getCardPriceKey(lookup.cardId, lookup.language)}`)
    if (!saved || saved.cardId !== lookup.cardId || saved.language !== lookup.language || !Number.isFinite(saved.fetchedAt)) return null
    const price = normalizeFetchedCardPrice(saved)
    return price ? { ...price, fetchedAt: saved.fetchedAt } : null
  })
  return results.filter((price): price is CardPriceSnapshot => price !== null)
}

// Keep full history in IndexedDB; localStorage's small quota is reserved for quick current quotes.
function compactPriceCache(cache: Record<string, CardPriceSnapshot>) {
  return JSON.stringify(Object.fromEntries(Object.entries(cache).map(([key, price]) => [key, { ...price,
    historyPoints: price.historyPoints === undefined ? undefined : [],
  }])))
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
        historyPoints: snapshot.historyPoints === undefined ? undefined : normalizePriceHistory(snapshot.historyPoints),
        finishPrices: snapshot.finishPrices === undefined ? undefined : normalizeFinishPrices(snapshot.finishPrices),
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
    localStorage.setItem(CARD_PRICE_CACHE_KEY, compactPriceCache(cache))
  } catch {
    // ignore cache writes
  }
}
