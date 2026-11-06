import { cacheLife } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { readCatalogMetadata } from "@/lib/card-catalog"
import { summarizeEbayListingEvidence } from "@/lib/ebay-listings"
import { getEbayAppToken } from "@/lib/server/ebay-auth"
import { ebayOpenListingsUrl } from "@/lib/ebay-search-urls"
import type { PriceSubject, PriceSubjectVariant } from "@/lib/price-intelligence"

export async function loadEbayListingIndicator(cardId: string, variant: PriceSubjectVariant | null) {
  "use cache: remote"
  cacheLife({ stale: 3600, revalidate: 3600, expire: 86400 })
  const lookup = await loadPriceCheckSubject(cardId, variant)
  return lookup ? fetchEbayListingIndicator(lookup.subject, lookup.query) : null
}

export async function loadPriceCheckSubject(cardId: string, variant: PriceSubjectVariant | null) {
  const { data: card, error } = await createAdminClient().from("tcg_cards")
    .select("id,name_en,local_id,set_id,external_ids_json,raw_json,tcg_sets(name_en,official_card_count)").eq("id", cardId).maybeSingle()
  if (error) throw new Error("Card lookup unavailable")
  if (!card?.name_en || !card.local_id) return null
  const catalog = readCatalogMetadata(card.external_ids_json)
  let name = card.name_en
  let localId = card.local_id
  let printing: PriceSubject["printing"]
  let unambiguousPrintingFinish: PriceSubject["unambiguousPrintingFinish"]
  if (catalog.variantId) {
    const evidence = card.raw_json?.supplementalSources?.tcgdexVariant
    const labels = { "pokemon-center": "Pokémon Center", staff: "Staff", "pre-release": "Prerelease" } as const
    const stamp = Array.isArray(evidence?.stamp) && evidence.stamp.length === 1 ? evidence.stamp[0] : undefined
    if (typeof stamp !== "string" || evidence.size === "jumbo" || !Object.hasOwn(labels, stamp) || !catalog.localId || !catalog.productId
      || String(evidence.thirdParty?.tcgplayer) !== catalog.productId
      || (evidence.variantId ?? catalog.productId) !== catalog.variantId) return null
    printing = stamp as NonNullable<PriceSubject["printing"]>
    const label = labels[printing]
    const suffix = ` (${label})`
    if (catalog.printingLabel !== label || !name.endsWith(suffix)) return null
    name = name.slice(0, -suffix.length)
    localId = catalog.localId
    if (!name) return null
    if (["normal", "holo", "reverse"].includes(evidence.type) && variant && evidence.type !== variant) return null
    // The decorated row retains only one variant. Check the base catalog list before inferring
    // a finish from its stamp; another finish with the same stamp makes the title ambiguous.
    if (catalog.tcgdexCardId === `${card.set_id}-${localId}` && evidence.size === "standard") {
      const { data: base, error: baseError } = await createAdminClient().from("tcg_cards").select("raw_json").eq("id", catalog.tcgdexCardId).maybeSingle()
      const raw = base?.raw_json
      const variants: unknown = Array.isArray(raw?.variants) ? raw.variants : raw?.variants_detailed
      if (!baseError && raw?.id === catalog.tcgdexCardId && Array.isArray(variants)) {
        const stamped = variants.filter(v => v && typeof v === "object" && v.size !== "jumbo" && Array.isArray(v.stamp) && v.stamp.includes(printing))
        if (stamped.length && stamped.every(v => v.size === "standard" && v.stamp.length === 1 && v.type === evidence.type)
          && stamped.some(v => v.variantId === evidence.variantId && String(v.thirdParty?.tcgplayer) === catalog.productId)
          && ["normal", "holo", "reverse"].includes(evidence.type)) unambiguousPrintingFinish = evidence.type
      }
    }
  } else if (cardId.includes("~") || catalog.printingLabel) {
    // A decorated identity alone is never evidence of a supported printing.
    return null
  }
  const set = (Array.isArray(card.tcg_sets) ? card.tcg_sets[0] : card.tcg_sets) as { name_en?: string; official_card_count?: number } | null
  if (!set?.name_en) return null
  // TCGcsv group 24451 maps to TCGdex mep (card-catalog-supplement.ts). Its market name
  // is "ME: Mega Evolution Promo", abbreviation MEP. Do not require the verbose set label
  // in a stamped-card search; title matching still verifies the set independently.
  const setAliases = card.set_id === "mep" && set.name_en === "MEP Black Star Promos" ? ["Mega Evolution Promo", "Mega Evolution Promos"] : []
  const query = (printing ? `${name} ${localId} ${catalog.printingLabel}` : `${card.name_en} ${localId} ${set.name_en}`).slice(0, 100)
  const subject: PriceSubject = { cardId, name, localId, setId: card.set_id, setName: set.name_en, officialCardCount: set.official_card_count, language: "en", variant, printing, setAliases, unambiguousPrintingFinish }
  return { subject, query }
}

export async function fetchEbayListingIndicator(subject: PriceSubject, query: string) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search")
  url.search = new URLSearchParams({ q: query, limit: "50", filter: "buyingOptions:{FIXED_PRICE},itemLocationCountry:GB" }).toString()
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await getEbayAppToken()}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_GB" },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`eBay listing search unavailable (${response.status})`)
  const data: { itemSummaries?: unknown } = await response.json()
  if (!data || (data.itemSummaries !== undefined && !Array.isArray(data.itemSummaries))) throw new Error("Invalid eBay search response")
  const evidence = summarizeEbayListingEvidence(subject, Array.isArray(data.itemSummaries) ? data.itemSummaries : [])
  // Keep public listing evidence only; never retain seller or account records.
  return { ...evidence, checkedAt: new Date().toISOString(), searchUrl: ebayOpenListingsUrl(query) }
}
