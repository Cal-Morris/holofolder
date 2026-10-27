import { cacheLife } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { readCatalogMetadata } from "@/lib/card-catalog"
import { summarizeEbayListings } from "@/lib/ebay-listings"
import { getEbayAppToken } from "@/lib/server/ebay-auth"
import type { PriceSubjectVariant } from "@/lib/price-intelligence"

export async function loadEbayListingIndicator(cardId: string, variant: PriceSubjectVariant | null) {
  "use cache: remote"
  cacheLife({ stale: 3600, revalidate: 3600, expire: 86400 })
  const { data: card, error } = await createAdminClient().from("tcg_cards")
    .select("id,name_en,local_id,set_id,external_ids_json,tcg_sets(name_en)").eq("id", cardId).maybeSingle()
  if (error) throw new Error("Card lookup unavailable")
  if (!card?.name_en || !card.local_id || readCatalogMetadata(card.external_ids_json).variantId) return null
  const set = (Array.isArray(card.tcg_sets) ? card.tcg_sets[0] : card.tcg_sets) as { name_en?: string } | null
  if (!set?.name_en) return null
  const query = `${card.name_en} ${card.local_id} ${set.name_en}`.slice(0, 100)
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search")
  url.search = new URLSearchParams({ q: query, limit: "50", filter: "buyingOptions:{FIXED_PRICE},itemLocationCountry:GB" }).toString()
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getEbayAppToken()}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB" },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`eBay listing search unavailable (${response.status})`)
  const data: { itemSummaries?: unknown } = await response.json()
  if (!data || (data.itemSummaries !== undefined && !Array.isArray(data.itemSummaries))) throw new Error("Invalid eBay search response")
  const summary = summarizeEbayListings({ cardId, name: card.name_en, localId: card.local_id, setId: card.set_id, setName: set.name_en, language: "en", variant }, Array.isArray(data.itemSummaries) ? data.itemSummaries : [])
  // Retain only anonymous aggregates, never listing, seller or account records.
  return { summary, checkedAt: new Date().toISOString(), searchUrl: `https://www.ebay.co.uk/sch/i.html?${new URLSearchParams({ _nkw: query, LH_BIN: "1", LH_PrefLoc: "1" })}` }
}
