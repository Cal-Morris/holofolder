const EBAY_UK_SEARCH = "https://www.ebay.co.uk/sch/i.html"

/** Open Buy It Now listings on eBay UK, UK-located sellers. */
export function ebayOpenListingsUrl(query: string) {
  return `${EBAY_UK_SEARCH}?${new URLSearchParams({ _nkw: query, LH_BIN: "1", LH_PrefLoc: "1" })}`
}

/** Completed + sold listings on eBay UK, UK-located sellers. */
export function ebaySoldListingsUrl(query: string) {
  return `${EBAY_UK_SEARCH}?${new URLSearchParams({ _nkw: query, LH_Sold: "1", LH_Complete: "1", LH_PrefLoc: "1" })}`
}
