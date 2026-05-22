import { createAdminClient } from "@/lib/supabase/admin"
import {
  normalizeCardLanguage,
  refreshCardPriceLookups,
  type CardPriceLookup,
  type CardPriceRefreshResult,
} from "@/lib/card-pricing"

interface CollectionPriceRow {
  card_id: string | null
  card_language?: string | null
}

interface CardPriceWorkflowResult {
  totalCards: number
  refreshed: number
  cached: number
  unpriced: number
}

const PRICE_REFRESH_BATCH_SIZE = 25

export async function refreshCardPricesWorkflow(ownerUserId: string): Promise<CardPriceWorkflowResult> {
  "use workflow"

  const lookups = await loadTrackedCardPriceLookups(ownerUserId)
  const batches = chunkCardPriceLookups(lookups, PRICE_REFRESH_BATCH_SIZE)
  let refreshed = 0
  let cached = 0
  let unpriced = 0

  for (const batch of batches) {
    const result = await refreshCardPriceBatch(batch)
    refreshed += result.refreshed
    cached += result.cached
    unpriced += result.unpriced
  }

  return {
    totalCards: lookups.length,
    refreshed,
    cached,
    unpriced,
  }
}

async function loadTrackedCardPriceLookups(ownerUserId: string): Promise<CardPriceLookup[]> {
  "use step"

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("pokemon_collection")
    .select("card_id, card_language")
    .eq("user_id", ownerUserId)
    .not("card_id", "is", null)

  if (error) {
    throw error
  }

  const byKey = new Map<string, CardPriceLookup>()
  for (const row of (data ?? []) as CollectionPriceRow[]) {
    if (!row.card_id) {
      continue
    }

    const language = normalizeCardLanguage(row.card_language)
    byKey.set(`${row.card_id}::${language}`, {
      cardId: row.card_id,
      language,
    })
  }

  return [...byKey.values()]
}

async function refreshCardPriceBatch(lookups: CardPriceLookup[]): Promise<CardPriceRefreshResult> {
  "use step"

  return refreshCardPriceLookups(lookups, { force: true })
}

function chunkCardPriceLookups(lookups: CardPriceLookup[], batchSize: number) {
  const batches: CardPriceLookup[][] = []

  for (let index = 0; index < lookups.length; index += batchSize) {
    batches.push(lookups.slice(index, index + batchSize))
  }

  return batches
}
