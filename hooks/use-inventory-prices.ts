"use client"

import { useEffect, useState } from "react"
import { normalizeFetchedCardPrice, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { isCardLanguage } from "@/lib/domain/cards"
import { SAVED_PRICES_WITHOUT_HISTORY_MAX_CARDS, getCardPriceKey, type CardPriceLookup } from "@/lib/card-pricing"
import { mapWithConcurrency } from "@/lib/card-db-sync-concurrency"

/** Groups of saved-price GETs in flight at once. */
export const SAVED_INVENTORY_PRICE_CONCURRENCY = 4

/** Existing saved-evidence GET only. Never POST, refresh, provider lookup or paid comparison. History is left
 * out (no consumer of these prices reads it). A failed or malformed group leaves only its own cards unpriced (#570). */
export async function readSavedInventoryPrices(requests: readonly CardPriceLookup[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CardPriceSnapshot[]> {
  const unique = [...new Map(requests.map(r => [getCardPriceKey(r.cardId, r.language), r])).values()]
  const size = SAVED_PRICES_WITHOUT_HISTORY_MAX_CARDS
  const batches = Array.from({ length: Math.ceil(unique.length / size) }, (_, i) => unique.slice(i * size, (i + 1) * size))
  const groups = await mapWithConcurrency(batches, SAVED_INVENTORY_PRICE_CONCURRENCY, async batch => {
    if (signal.aborted) return []
    try { return await readSavedPriceGroup(batch, signal, fetcher) } catch (error) {
      if (signal.aborted) return []
      console.error("[holofolder] Failed to read a saved price group:", error)
      return []
    }
  })
  signal.throwIfAborted()
  return groups.flat()
}

async function readSavedPriceGroup(batch: readonly CardPriceLookup[], signal: AbortSignal, fetcher: typeof fetch) {
  const response = await fetcher(`/app/api/card-prices?cards=${encodeURIComponent(JSON.stringify(batch))}&history=0`, { signal, cache: "no-store" })
  if (!response.ok) throw new Error("saved_inventory_prices_unavailable")
  const payload = await response.json()
  if (!Array.isArray(payload?.prices)) throw new Error("saved_inventory_prices_unavailable")
  const requested = new Set(batch.map(r => getCardPriceKey(r.cardId, r.language)))
  const seen = new Set<string>()
  const prices: CardPriceSnapshot[] = []
  for (const raw of payload.prices) {
    if (!raw || typeof raw.cardId !== "string" || !isCardLanguage(raw.language)
      || !requested.has(getCardPriceKey(raw.cardId, raw.language))) throw new Error("saved_inventory_prices_unavailable")
    const key = getCardPriceKey(raw.cardId, raw.language)
    // The general normalizer supports old quotes with default metadata. Native evidence must not.
    const price = normalizeFetchedCardPrice({ ...raw, finishPrices: Array.isArray(raw.finishPrices) ? raw.finishPrices.filter((quote: unknown) =>
      quote && typeof quote === "object" && "cardId" in quote && quote.cardId === raw.cardId && "language" in quote && quote.language === raw.language) : [] })
    if (!price || seen.has(key)) throw new Error("saved_inventory_prices_unavailable")
    seen.add(key); prices.push(price)
  }
  return prices
}

/** No private snapshot persistence. Loaded public quotes remain usable in this mounted offline view. */
export function useInventoryPrices(requests: readonly CardPriceLookup[]) {
  const key = JSON.stringify(requests)
  const [saved, setSaved] = useState<{ key: string; prices: CardPriceSnapshot[] }>({ key: "", prices: [] })
  useEffect(() => {
    const controller = new AbortController()
    const parsed: CardPriceLookup[] = JSON.parse(key)
    void readSavedInventoryPrices(parsed, controller.signal).then(prices => {
      if (!controller.signal.aborted) setSaved({ key, prices })
    }).catch(() => { /* Unavailable saved evidence stays unknown. */ })
    return () => controller.abort()
  }, [key])
  return saved.key === key ? saved.prices : []
}
