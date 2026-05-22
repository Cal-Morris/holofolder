"use client"

import { useEffect, useMemo, useState } from "react"

export type SupportedCurrency = "USD" | "EUR" | "GBP"
export type PriceSource = "tcgplayer" | "cardmarket"
export type CardLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"

export interface CardPriceLookup {
  cardId: string
  language?: CardLanguage | string | null
}

export interface CardPriceSnapshot {
  cardId: string
  language: CardLanguage
  gbpAmount: number | null
  originalAmount: number | null
  originalCurrency: Exclude<SupportedCurrency, "GBP"> | null
  source: PriceSource | null
  variantLabel: string | null
  updatedAt: string | null
  fxDate: string | null
  fetchedAt: number
}

const CARD_PRICE_CACHE_KEY = "binderdex_card_price_cache_v3"
const CARD_PRICE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const SUPPORTED_CARD_LANGUAGES: CardLanguage[] = ["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"]

export function normalizeCardLanguage(value: unknown): CardLanguage {
  if (typeof value !== "string") return "en"
  const normalized = value.trim().toLowerCase()
  return SUPPORTED_CARD_LANGUAGES.includes(normalized as CardLanguage) ? normalized as CardLanguage : "en"
}

export function getCardPriceKey(cardId: string, language: unknown = "en") {
  return `${cardId}::${normalizeCardLanguage(language)}`
}

export function useCardPrices(cardLookups: Array<string | CardPriceLookup>, enabled: boolean) {
  const [pricesByCardId, setPricesByCardId] = useState<Record<string, CardPriceSnapshot>>({})
  const [isLoading, setIsLoading] = useState(false)

  const stableLookups = useMemo(
    () => {
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
    },
    [cardLookups],
  )

  const requestKey = stableLookups.map((lookup) => getCardPriceKey(lookup.cardId, lookup.language)).join(",")

  useEffect(() => {
    if (!enabled || stableLookups.length === 0) {
      return
    }

    const cache = readPriceCache()
    const nextState: Record<string, CardPriceSnapshot> = {}
    const missingLookups: CardPriceLookup[] = []

    for (const lookup of stableLookups) {
      const cacheKey = getCardPriceKey(lookup.cardId, lookup.language)
      const cached = cache[cacheKey]

      if (cached && Date.now() - cached.fetchedAt < CARD_PRICE_CACHE_TTL_MS) {
        nextState[cacheKey] = cached
      } else {
        missingLookups.push(lookup)
      }
    }

    setPricesByCardId((current) => ({ ...current, ...nextState }))

    if (missingLookups.length === 0) {
      return
    }

    let cancelled = false
    setIsLoading(true)

    void fetch("/api/card-prices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cards: missingLookups }),
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
            language: normalizeCardLanguage(price.language),
            gbpAmount: typeof price.gbpAmount === "number" && Number.isFinite(price.gbpAmount) ? price.gbpAmount : null,
            originalAmount: typeof price.originalAmount === "number" && Number.isFinite(price.originalAmount) ? price.originalAmount : null,
            originalCurrency: price.originalCurrency === "USD" || price.originalCurrency === "EUR" ? price.originalCurrency : null,
            source: price.source === "tcgplayer" || price.source === "cardmarket" ? price.source : null,
            variantLabel: typeof price.variantLabel === "string" ? price.variantLabel : null,
            updatedAt: typeof price.updatedAt === "string" ? price.updatedAt : null,
            fxDate: typeof price.fxDate === "string" ? price.fxDate : null,
            fetchedAt: Date.now(),
          }
          const cacheKey = getCardPriceKey(snapshot.cardId, snapshot.language)

          updates[cacheKey] = snapshot
          mergedCache[cacheKey] = snapshot
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
