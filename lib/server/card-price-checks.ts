import { consumePriceCheckProviderLimit } from '@/lib/server/price-check-limits'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import { getClassicCollectionPrinting } from "@/lib/classic-collection-printing"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchEbayListingIndicator, loadPriceCheckSubject } from "@/lib/server/ebay-listings"
import { summarizeSoldComps } from "@/lib/sold-comps"
import { ebayOpenListingsUrl, ebaySoldListingsUrl } from "@/lib/ebay-search-urls"
import { isCardPriceCheck, PRICE_CHECK_FRESH_MS, type CardPriceChecks, type PriceCheckSource } from "@/lib/card-price-checks"
import type { PriceSubject } from "@/lib/price-intelligence"

async function fetchSoldComps(subject: PriceSubject, query: string) {
  const url = new URL("https://www.soldcomps.io/v1/sold")
  url.search = new URLSearchParams({ q: query, site: "EBAY_GB", days: "90" }).toString()
  await consumePriceCheckProviderLimit("soldcomps")
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SOLDCOMPS_API_KEY}` }, cache: "no-store", signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(response.status === 402 ? "Sold comps monthly allowance used up." : "Sold comps are temporarily unavailable.")
  const data: unknown = await response.json()
  if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) throw new Error("Invalid sold comps response.")
  return { ...summarizeSoldComps(subject, (data as { items: unknown[] }).items), checkedAt: new Date().toISOString(), searchUrl: ebaySoldListingsUrl(query) }
}

export async function loadCardPriceChecks(cardId: string, finish: string, refresh: boolean, onlySource?: PriceCheckSource, forceRefresh = false): Promise<CardPriceChecks | null> {
  const db = createAdminClient()
  const sources: PriceCheckSource[] = onlySource ? [onlySource] : ["ebay", "soldcomps"]
  const [lookup, saved] = await Promise.all([
    loadPriceCheckSubject(cardId, finish === "reverse_holo" ? "reverse" : finish === "normal" || finish === "holo" ? finish : null),
    db.from("card_price_checks").select("source,result_json").eq("card_id", cardId).eq("finish", finish).in("source", sources),
  ])
  if (!lookup) return null
  if (saved.error) throw new Error("Saved price checks are unavailable.")
  const result: CardPriceChecks = { ebay: null, soldcomps: null, errors: {} }
  const normalize = (source: PriceCheckSource, value: unknown) => {
    if (!isCardPriceCheck(value) || value.summary.kind !== (source === "ebay" ? "asking" : "sold")) return null
    // Correct catalog-position links as well as older checks without links, without spending credits.
    return value.searchUrl && !getClassicCollectionPrinting(cardId) ? value : { ...value, searchUrl: source === "ebay" ? ebayOpenListingsUrl(lookup.query) : ebaySoldListingsUrl(lookup.query) }
  }
  const read = async (source: PriceCheckSource) => {
    const { data, error } = await db.from("card_price_checks").select("result_json").eq("card_id", cardId).eq("finish", finish).eq("source", source).maybeSingle()
    if (error) throw new Error("Saved price checks are unavailable.")
    return normalize(source, data?.result_json)
  }
  await Promise.all(sources.map(async source => {
    result[source] = normalize(source, saved.data?.find(row => row.source === source)?.result_json)
    if (!refresh || (result[source] && (!forceRefresh || Date.now() - Date.parse(result[source].checkedAt) < PRICE_CHECK_FRESH_MS))) return
    if (source === "ebay" ? !process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET : !process.env.SOLDCOMPS_API_KEY) {
      result.errors[source] = `${source === "ebay" ? "eBay" : "Sold comps"} is not configured.`
      return
    }
    try {
      const { data: claimed, error: claimError } = await db.rpc("claim_card_price_check", { p_card_id: cardId, p_finish: finish, p_source: source })
      if (claimError) throw new Error("Price check could not be reserved.")
      if (!claimed) {
        result[source] = await read(source)
        if (!result[source] || Date.now() - Date.parse(result[source].checkedAt) >= PRICE_CHECK_FRESH_MS) result.errors[source] = "A check is in progress or cooling down. Try again in two minutes."
        return
      }
      const checked = source === "ebay" ? await fetchEbayListingIndicator(lookup.subject, lookup.query) : await fetchSoldComps(lookup.subject, lookup.query)
      const { error } = await db.from("card_price_checks").update({ result_json: checked, checked_at: checked.checkedAt, next_attempt_at: new Date(Date.parse(checked.checkedAt) + PRICE_CHECK_FRESH_MS).toISOString() }).eq("card_id", cardId).eq("finish", finish).eq("source", source)
      if (error) throw new Error("Price check could not be saved. Try again later.")
      result[source] = checked
    } catch (error) {
      if (error instanceof DeveloperAccessError) throw error
      // Upstream helpers expose fixed messages/statuses, never response bodies or credentials.
      result.errors[source] = error instanceof Error ? error.message : "Price check unavailable."
    }
  }))
  return result
}

/** Saved comparisons in one query per download batch, with no catalog lookups or provider requests. */
export async function loadSavedCardPriceChecks(cards: { cardId: string; finish: string }[]) {
  const { data, error } = await createAdminClient().from("card_price_checks").select("card_id,finish,source,result_json")
    .in("card_id", [...new Set(cards.map(card => card.cardId))])
  if (error) throw error
  return cards.map(card => {
    const checks: CardPriceChecks = { ebay: null, soldcomps: null, errors: {} }
    for (const row of data ?? []) {
      if (row.card_id !== card.cardId || row.finish !== card.finish || (row.source !== "ebay" && row.source !== "soldcomps")) continue
      if (isCardPriceCheck(row.result_json) && row.result_json.summary.kind === (row.source === "ebay" ? "asking" : "sold")) checks[row.source as PriceCheckSource] = row.result_json
    }
    return { ...card, ...checks }
  })
}
