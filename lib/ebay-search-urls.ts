import type { CardFinish } from "@/lib/domain/cards"

const EBAY_UK_SEARCH = "https://www.ebay.co.uk/sch/i.html"

/** Open Buy It Now listings on eBay UK, UK-located sellers. */
export function ebayOpenListingsUrl(query: string) {
  return `${EBAY_UK_SEARCH}?${new URLSearchParams({ _nkw: query, LH_BIN: "1", LH_PrefLoc: "1" })}`
}

/** Completed + sold listings on eBay UK, UK-located sellers. */
export function ebaySoldListingsUrl(query: string) {
  return `${EBAY_UK_SEARCH}?${new URLSearchParams({ _nkw: query, LH_Sold: "1", LH_Complete: "1", LH_PrefLoc: "1" })}`
}

/** Search text only: this never establishes eligibility for a provider price check. */
export function priceCheckSearchQuery(name: string, localId: string, setName?: string, printingLabel?: string) {
  const suffix = printingLabel ? ` (${printingLabel})` : ""
  const baseName = suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
  return [baseName, localId, printingLabel || setName].filter(Boolean).join(" ")
}

export type ListingSearchCard = { cardId: string; name?: string; localId?: string; setName?: string }

export function cardListingSearchQuery(card: ListingSearchCard, finish?: CardFinish) {
  const name = card.name?.trim()
  const printingLabel = name?.match(/ \((Pokémon Center|Staff|Prerelease)\)$/)?.[1]
  // Stored collection rows have no number field. Keep unknown decorated identities intact;
  // only a named stamp lets a browser search use the printed number without its product suffix.
  const number = card.localId || (card.cardId.startsWith("tcgplayer-") ? "" : card.cardId.slice(card.cardId.indexOf("-") + 1))
  const localId = printingLabel ? number.split("~")[0] : number
  const query = priceCheckSearchQuery(name || card.cardId, localId, card.setName, printingLabel)
  const variant = finish === "reverse_holo" ? "reverse holo" : finish === "holo" ? "holo -reverse" : finish === "normal" ? "non holo -reverse" : ""
  return [query, variant].filter(Boolean).join(" ")
}
