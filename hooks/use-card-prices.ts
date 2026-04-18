"use client"

import { useEffect, useMemo, useState } from "react"

export type SupportedCurrency = "USD" | "EUR" | "GBP"
export type PriceSource = "tcgplayer" | "cardmarket"

export interface CardPriceSnapshot {
  cardId: string
  gbpAmount: number | null
  originalAmount: number | null
  originalCurrency: Exclude<SupportedCurrency, "GBP"> | null
  source: PriceSource | null
  variantLabel: string | null
  updatedAt: string | null
  fxDate: string | null
  fetchedAt: number
}

const CARD_PRICE_CACHE_KEY = "binderdex_card_price_cache_v2"
const CARD_PRICE_CACHE_TTL_MS = 12 * 60 * 60 * 1000

export function useCardPrices(cardIds: string[], enabled: boolean) {
  const [pricesByCardId, setPricesByCardId] = useState<Record<string, CardPriceSnapshot>>({})
  const [isLoading, setIsLoading] = useState(false)

  const stableCardIds = useMemo(
    () =>
      [...new Set(cardIds.filter((value) => typeof value === "string" && value.length > 0))]
        .sort((left, right) => left.localeCompare(right)),
    [cardIds],
  )

  const requestKey = stableCardIds.join(",")

  useEffect(() => {
    if (!enabled || stableCardIds.length === 0) {
      return
    }

    const cache = readPriceCache()
    const nextState: Record<string, CardPriceSnapshot> = {}
    const missingCardIds: string[] = []

    for (const cardId of stableCardIds) {
      const cached = cache[cardId]

      if (cached && Date.now() - cached.fetchedAt < CARD_PRICE_CACHE_TTL_MS) {
        nextState[cardId] = cached
      } else {
        missingCardIds.push(cardId)
      }
    }

    setPricesByCardId((current) => ({ ...current, ...nextState }))

    if (missingCardIds.length === 0) {
      return
    }

    let cancelled = false
    setIsLoading(true)

    void fetch("/api/card-prices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cardIds: missingCardIds }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Price API returned ${response.status}`)
        }

        const payload = await response.json()
        const fetchedPrices = Array.isArray(payload?.prices) ? payload.prices : []
        const mergedCache = readPriceCache()
        const updates: Record<string, CardPriceSnapshot> = {}

        for (const price of fetchedPrices) {
          if (!price || typeof price.cardId !== "string") {
            continue
          }

          const snapshot: CardPriceSnapshot = {
            cardId: price.cardId,
            gbpAmount: typeof price.gbpAmount === "number" && Number.isFinite(price.gbpAmount) ? price.gbpAmount : null,
            originalAmount: typeof price.originalAmount === "number" && Number.isFinite(price.originalAmount) ? price.originalAmount : null,
            originalCurrency: price.originalCurrency === "USD" || price.originalCurrency === "EUR" ? price.originalCurrency : null,
            source: price.source === "tcgplayer" || price.source === "cardmarket" ? price.source : null,
            variantLabel: typeof price.variantLabel === "string" ? price.variantLabel : null,
            updatedAt: typeof price.updatedAt === "string" ? price.updatedAt : null,
            fxDate: typeof price.fxDate === "string" ? price.fxDate : null,
            fetchedAt: Date.now(),
          }

          updates[snapshot.cardId] = snapshot
          mergedCache[snapshot.cardId] = snapshot
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
  }, [enabled, requestKey, stableCardIds])

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
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writePriceCache(cache: Record<string, CardPriceSnapshot>) {
  try {
    localStorage.setItem(CARD_PRICE_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // ignore cache writes
  }
}
