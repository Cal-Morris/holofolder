import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

type SupportedCurrency = "USD" | "EUR" | "GBP"
type PriceSource = "tcgplayer" | "cardmarket"

interface CardPriceSnapshot {
  cardId: string
  gbpAmount: number | null
  originalAmount: number | null
  originalCurrency: Exclude<SupportedCurrency, "GBP"> | null
  source: PriceSource | null
  variantLabel: string | null
  updatedAt: string | null
  fxDate: string | null
}

const MAX_CARD_IDS = 200
const FETCH_CONCURRENCY = 8
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const TCGPLAYER_VARIANT_PRIORITY = [
  "normal",
  "holofoil",
  "reverse-holofoil",
  "1st-edition",
  "1st-edition-holofoil",
  "unlimited",
  "unlimited-holofoil",
] as const

const CARDMARKET_FIELD_PRIORITY = [
  "trend",
  "avg",
  "trend-holo",
  "avg-holo",
  "low",
  "low-holo",
] as const

interface FxRates {
  date: string
  eurToGbp: number
  usdToGbp: number
}

interface CardPriceRow {
  card_id: string
  gbp_amount: number | string | null
  original_amount: number | string | null
  original_currency: string | null
  source: string | null
  variant_label: string | null
  source_updated_at: string | null
  fx_date: string | null
  fetched_at: string
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => null)
    const requestedCardIds: unknown[] = Array.isArray(payload?.cardIds) ? payload.cardIds : []
    const cardIds = [...new Set(
      requestedCardIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    )].slice(0, MAX_CARD_IDS)

    if (cardIds.length === 0) {
      return NextResponse.json({ prices: [] })
    }

    const supabase = createAdminClient()
    const { data: cachedRows, error: cacheError } = await supabase
      .from("card_prices")
      .select("*")
      .in("card_id", cardIds)

    if (cacheError) {
      console.error("[binderdex] Failed to read card_prices cache:", cacheError)
    }

    const now = Date.now()
    const freshByCardId = new Map<string, CardPriceSnapshot>()

    for (const row of (cachedRows ?? []) as CardPriceRow[]) {
      const fetchedAtMs = Date.parse(row.fetched_at)
      if (Number.isFinite(fetchedAtMs) && now - fetchedAtMs < CACHE_TTL_MS) {
        freshByCardId.set(row.card_id, rowToSnapshot(row))
      }
    }

    const missingCardIds = cardIds.filter((cardId) => !freshByCardId.has(cardId))

    let refreshedSnapshots: CardPriceSnapshot[] = []
    if (missingCardIds.length > 0) {
      const fxRates = await fetchEcbFxRates()
      refreshedSnapshots = await mapWithConcurrency(
        missingCardIds,
        FETCH_CONCURRENCY,
        (cardId) => fetchCardPriceSnapshot(cardId, fxRates),
      )

      const rowsToUpsert = refreshedSnapshots.map((snapshot) => snapshotToRow(snapshot))
      const { error: upsertError } = await supabase
        .from("card_prices")
        .upsert(rowsToUpsert, { onConflict: "card_id" })

      if (upsertError) {
        console.error("[binderdex] Failed to upsert card_prices rows:", upsertError)
      }
    }

    const prices = cardIds.map((cardId) => {
      const fresh = freshByCardId.get(cardId)
      if (fresh) return fresh
      const refreshed = refreshedSnapshots.find((snapshot) => snapshot.cardId === cardId)
      return refreshed ?? emptySnapshot(cardId)
    })

    return NextResponse.json({ prices })
  } catch (error) {
    console.error("[binderdex] Failed to load card prices:", error)
    return NextResponse.json({ error: "Failed to load card prices." }, { status: 500 })
  }
}

function rowToSnapshot(row: CardPriceRow): CardPriceSnapshot {
  return {
    cardId: row.card_id,
    gbpAmount: toFiniteNumber(row.gbp_amount),
    originalAmount: toFiniteNumber(row.original_amount),
    originalCurrency: row.original_currency === "USD" || row.original_currency === "EUR" ? row.original_currency : null,
    source: row.source === "tcgplayer" || row.source === "cardmarket" ? row.source : null,
    variantLabel: row.variant_label,
    updatedAt: row.source_updated_at,
    fxDate: row.fx_date,
  }
}

function snapshotToRow(snapshot: CardPriceSnapshot) {
  return {
    card_id: snapshot.cardId,
    gbp_amount: snapshot.gbpAmount,
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

async function fetchCardPriceSnapshot(cardId: string, fxRates: FxRates): Promise<CardPriceSnapshot> {
  try {
    const response = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`, {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 60 * 60 * 12 },
    })

    if (!response.ok) {
      return emptySnapshot(cardId)
    }

    const payload = await response.json()
    return (
      pickTcgplayerPrice(cardId, payload?.pricing?.tcgplayer, fxRates) ||
      pickCardmarketPrice(cardId, payload?.pricing?.cardmarket, fxRates) ||
      emptySnapshot(cardId)
    )
  } catch (error) {
    console.error(`[binderdex] Failed to fetch price for ${cardId}:`, error)
    return emptySnapshot(cardId)
  }
}

function pickTcgplayerPrice(
  cardId: string,
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

    const amount =
      readFiniteNumber((variant as Record<string, unknown>).marketPrice) ??
      readFiniteNumber((variant as Record<string, unknown>).midPrice) ??
      readFiniteNumber((variant as Record<string, unknown>).lowPrice)

    if (amount == null) {
      continue
    }

    return {
      cardId,
      gbpAmount: roundPrice(amount * fxRates.usdToGbp),
      originalAmount: amount,
      originalCurrency: "USD",
      source: "tcgplayer",
      variantLabel: humanizeVariantLabel(variantKey),
      updatedAt: readTimestamp(tcgplayer.updated),
      fxDate: fxRates.date,
    }
  }

  return null
}

function pickCardmarketPrice(
  cardId: string,
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

    return {
      cardId,
      gbpAmount: roundPrice(amount * fxRates.eurToGbp),
      originalAmount: amount,
      originalCurrency: "EUR",
      source: "cardmarket",
      variantLabel: humanizeVariantLabel(fieldKey),
      updatedAt: readTimestamp(cardmarket.updated),
      fxDate: fxRates.date,
    }
  }

  return null
}

function emptySnapshot(cardId: string): CardPriceSnapshot {
  return {
    cardId,
    gbpAmount: null,
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
