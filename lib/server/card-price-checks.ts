import { createAdminClient } from "@/lib/supabase/admin"
import { fetchEbayListingIndicator, loadPriceCheckSubject } from "@/lib/server/ebay-listings"
import { summarizeSoldComps } from "@/lib/sold-comps"
import { isCardPriceCheck, PRICE_CHECK_FRESH_MS, type CardPriceChecks, type PriceCheckSource } from "@/lib/card-price-checks"
import type { PriceSubject } from "@/lib/price-intelligence"

async function fetchSoldComps(subject: PriceSubject, query: string) {
  const url = new URL("https://www.soldcomps.io/v1/sold")
  url.search = new URLSearchParams({ q: query, site: "EBAY_GB", days: "90" }).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SOLDCOMPS_API_KEY}` }, cache: "no-store", signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(response.status === 402 ? "Sold comps monthly allowance used up." : "Sold comps are temporarily unavailable.")
  const data: unknown = await response.json()
  if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) throw new Error("Invalid sold comps response.")
  return { ...summarizeSoldComps(subject, (data as { items: unknown[] }).items), checkedAt: new Date().toISOString() }
}

export async function loadCardPriceChecks(cardId: string, finish: string, refresh: boolean, onlySource?: PriceCheckSource): Promise<CardPriceChecks | null> {
  const lookup = await loadPriceCheckSubject(cardId, finish === "reverse_holo" ? "reverse" : finish === "normal" || finish === "holo" ? finish : null)
  if (!lookup) return null
  const db = createAdminClient()
  const result: CardPriceChecks = { ebay: null, soldcomps: null, errors: {} }
  const read = async (source: PriceCheckSource) => {
    const { data, error } = await db.from("card_price_checks").select("result_json").eq("card_id", cardId).eq("finish", finish).eq("source", source).maybeSingle()
    if (error) throw new Error("Saved price checks are unavailable.")
    const value = data?.result_json
    return isCardPriceCheck(value) && value.summary.kind === (source === "ebay" ? "asking" : "sold") ? value : null
  }
  const sources: PriceCheckSource[] = onlySource ? [onlySource] : ["ebay", "soldcomps"]
  await Promise.all(sources.map(async source => {
    result[source] = await read(source)
    if (!refresh || (result[source] && Date.now() - Date.parse(result[source].checkedAt) < PRICE_CHECK_FRESH_MS)) return
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
      // Upstream helpers expose fixed messages/statuses, never response bodies or credentials.
      result.errors[source] = error instanceof Error ? error.message : "Price check unavailable."
    }
  }))
  return result
}
