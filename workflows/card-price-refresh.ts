import { sleep } from "workflow"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  refreshCardPriceLookups,
  type CardPriceLookup,
} from "@/lib/card-pricing"
import { DEFAULT_REFRESH_INTERVAL, normalizeRefreshInterval, type RefreshInterval } from "@/lib/price-refresh-interval"
import { selectTrackedPriceLookups } from "@/lib/server/tracked-price-selection"

interface CardPriceWorkflowResult {
  totalCards: number
  refreshed: number
  cached: number
  unpriced: number
  passes: number
}

/** Counts only: a step's return value is persisted as workflow data, so prices[] must never leave the step. */
interface CardPriceBatchCounts {
  refreshed: number
  cached: number
  unpriced: number
}

interface CardPriceWorkflowInput {
  ownerUserId?: string | null
  repeatCount?: number | null
  interval?: string | null
}

const PRICE_REFRESH_BATCH_SIZE = 100
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
  console.log(`[holofolder] Starting card price refresh${ownerUserId ? ` for owner ${ownerUserId}` : " for all tracked cards"}`)
  const lookups = await loadTrackedCardPriceLookups(ownerUserId)
  const batches = chunkCardPriceLookups(lookups, PRICE_REFRESH_BATCH_SIZE)
  console.log(`[holofolder] Refreshing ${lookups.length} card price lookups in ${batches.length} batches`)
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
    `[holofolder] Finished card price refresh: ${refreshed} refreshed, ${cached} cached, ${unpriced} unpriced`,
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

  console.log(`[holofolder] Loading tracked cards${ownerUserId ? ` for owner ${ownerUserId}` : ""}`)
  const admin = createAdminClient()
  return selectTrackedPriceLookups(admin, ownerUserId)
}

async function refreshCardPriceBatch(lookups: CardPriceLookup[]): Promise<CardPriceBatchCounts> {
  "use step"

  console.log(`[holofolder] Refreshing card price batch with ${lookups.length} lookups`)
  const { refreshed, cached, unpriced } = await refreshCardPriceLookups(lookups, { force: true })
  console.log(
    `[holofolder] Finished card price batch: ${refreshed} refreshed, ${cached} cached, ${unpriced} unpriced`,
  )
  return { refreshed, cached, unpriced }
}

function chunkCardPriceLookups(lookups: CardPriceLookup[], batchSize: number) {
  const batches: CardPriceLookup[][] = []

  for (let index = 0; index < lookups.length; index += batchSize) {
    batches.push(lookups.slice(index, index + batchSize))
  }

  return batches
}
