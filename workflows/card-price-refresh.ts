import { sleep } from "workflow"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  normalizeCardLanguage,
  refreshCardPriceLookups,
  type CardPriceLookup,
  type CardPriceRefreshResult,
} from "@/lib/card-pricing"
import { DEFAULT_REFRESH_INTERVAL, normalizeRefreshInterval, type RefreshInterval } from "@/lib/price-refresh-interval"

interface CollectionPriceRow {
  card_id: string | null
  card_language?: string | null
  wanted_cards?: unknown
}

interface CardPriceWorkflowResult {
  totalCards: number
  refreshed: number
  cached: number
  unpriced: number
  passes: number
}

interface CardPriceWorkflowInput {
  ownerUserId?: string | null
  repeatCount?: number | null
  interval?: string | null
}

const PRICE_REFRESH_BATCH_SIZE = 25
const MAX_REFRESH_PASSES = 12

export async function refreshCardPricesWorkflow(input: string | null | CardPriceWorkflowInput = null): Promise<CardPriceWorkflowResult> {
  "use workflow"

  const options = normalizeCardPriceWorkflowInput(input)
  let totalCards = 0
  let refreshed = 0
  let cached = 0
  let unpriced = 0

  for (let pass = 0; pass < options.repeatCount; pass += 1) {
    const result = await refreshTrackedCardPrices(options.ownerUserId)
    totalCards = result.totalCards
    refreshed += result.refreshed
    cached += result.cached
    unpriced = result.unpriced

    if (pass < options.repeatCount - 1) {
      await sleep(options.interval)
    }
  }

  return {
    totalCards,
    refreshed,
    cached,
    unpriced,
    passes: options.repeatCount,
  }
}

function normalizeCardPriceWorkflowInput(input: string | null | CardPriceWorkflowInput): {
  ownerUserId: string | null
  repeatCount: number
  interval: RefreshInterval
} {
  if (typeof input === "string") {
    return {
      ownerUserId: input,
      repeatCount: 1,
      interval: DEFAULT_REFRESH_INTERVAL,
    }
  }

  const repeatCount = input?.repeatCount && Number.isFinite(input.repeatCount)
    ? Math.min(Math.max(Math.floor(input.repeatCount), 1), MAX_REFRESH_PASSES)
    : 1

  return {
    ownerUserId: input?.ownerUserId ?? null,
    repeatCount,
    interval: normalizeRefreshInterval(input?.interval),
  }
}

async function refreshTrackedCardPrices(ownerUserId: string | null): Promise<CardPriceWorkflowResult> {
  console.log(`[binderdex] Starting card price refresh${ownerUserId ? ` for owner ${ownerUserId}` : " for all tracked cards"}`)
  const lookups = await loadTrackedCardPriceLookups(ownerUserId)
  const batches = chunkCardPriceLookups(lookups, PRICE_REFRESH_BATCH_SIZE)
  console.log(`[binderdex] Refreshing ${lookups.length} card price lookups in ${batches.length} batches`)
  let refreshed = 0
  let cached = 0
  let unpriced = 0

  for (const batch of batches) {
    const result = await refreshCardPriceBatch(batch)
    refreshed += result.refreshed
    cached += result.cached
    unpriced += result.unpriced
  }

  console.log(
    `[binderdex] Finished card price refresh: ${refreshed} refreshed, ${cached} cached, ${unpriced} unpriced`,
  )

  return {
    totalCards: lookups.length,
    refreshed,
    cached,
    unpriced,
    passes: 1,
  }
}

async function loadTrackedCardPriceLookups(ownerUserId: string | null): Promise<CardPriceLookup[]> {
  "use step"

  console.log(`[binderdex] Loading tracked cards${ownerUserId ? ` for owner ${ownerUserId}` : ""}`)
  const admin = createAdminClient()
  let query = admin
    .from("pokemon_collection")
    .select("card_id, card_language, wanted_cards")

  if (ownerUserId) {
    query = query.eq("user_id", ownerUserId)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  const byKey = new Map<string, CardPriceLookup>()
  for (const row of (data ?? []) as CollectionPriceRow[]) {
    if (row.card_id) {
      const language = normalizeCardLanguage(row.card_language)
      byKey.set(`${row.card_id}::${language}`, {
        cardId: row.card_id,
        language,
      })
    }

    if (Array.isArray(row.wanted_cards)) {
      for (const wantedCard of row.wanted_cards) {
        if (!wantedCard || typeof wantedCard !== "object") continue
        const candidate = wantedCard as { card_id?: unknown; card_language?: unknown }
        if (typeof candidate.card_id !== "string") continue
        const wantedLanguage = normalizeCardLanguage(candidate.card_language)
        byKey.set(`${candidate.card_id}::${wantedLanguage}`, {
          cardId: candidate.card_id,
          language: wantedLanguage,
        })
      }
    }
  }

  return [...byKey.values()]
}

async function refreshCardPriceBatch(lookups: CardPriceLookup[]): Promise<CardPriceRefreshResult> {
  "use step"

  console.log(`[binderdex] Refreshing card price batch with ${lookups.length} lookups`)
  const result = await refreshCardPriceLookups(lookups, { force: true })
  console.log(
    `[binderdex] Finished card price batch: ${result.refreshed} refreshed, ${result.cached} cached, ${result.unpriced} unpriced`,
  )
  return result
}

function chunkCardPriceLookups(lookups: CardPriceLookup[], batchSize: number) {
  const batches: CardPriceLookup[][] = []

  for (let index = 0; index < lookups.length; index += batchSize) {
    batches.push(lookups.slice(index, index + batchSize))
  }

  return batches
}
