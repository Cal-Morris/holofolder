"use client"

import { useEffect, useState } from "react"
import { normalizeFetchedCardPrice, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { isCardLanguage } from "@/lib/domain/cards"
import { getCardPriceKey, type CardPriceLookup } from "@/lib/card-pricing"

/** Existing saved-evidence GET only. Never POST, refresh, provider lookup or paid comparison. */
export async function readSavedInventoryPrices(requests: readonly CardPriceLookup[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CardPriceSnapshot[]> {
  const unique = [...new Map(requests.map(r => [getCardPriceKey(r.cardId, r.language), r])).values()]
  const prices: CardPriceSnapshot[] = []
  for (let offset = 0; offset < unique.length; offset += 25) {
    const batch = unique.slice(offset, offset + 25)
    const response = await fetcher(`/app/api/card-prices?cards=${encodeURIComponent(JSON.stringify(batch))}`, { signal, cache: "no-store" })
    if (!response.ok) throw new Error("saved_inventory_prices_unavailable")
    const payload = await response.json()
    if (!Array.isArray(payload?.prices)) throw new Error("saved_inventory_prices_unavailable")
    const seen = new Set<string>()
    for (const raw of payload.prices) {
      if (!raw || typeof raw.cardId !== "string" || !isCardLanguage(raw.language)
        || !batch.some(r => r.cardId === raw.cardId && r.language === raw.language)) throw new Error("saved_inventory_prices_unavailable")
      const key = getCardPriceKey(raw.cardId, raw.language)
      const price = normalizeFetchedCardPrice(raw)
      if (!price || seen.has(key)) throw new Error("saved_inventory_prices_unavailable")
      seen.add(key); prices.push(price)
    }
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
