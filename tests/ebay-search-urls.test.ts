import { test } from "node:test"
import assert from "node:assert/strict"
import { ebayOpenListingsUrl, ebaySoldListingsUrl } from "../lib/ebay-search-urls"
import { isCardPriceCheck } from "../lib/card-price-checks"

test("open and sold eBay UK search links share the query and stay on trusted origin", () => {
  const open = new URL(ebayOpenListingsUrl("Charmeleon 005 151"))
  const sold = new URL(ebaySoldListingsUrl("Charmeleon 005 151"))
  for (const url of [open, sold]) {
    assert.equal(url.origin + url.pathname, "https://www.ebay.co.uk/sch/i.html")
    assert.equal(url.searchParams.get("_nkw"), "Charmeleon 005 151")
  }
  assert.equal(open.searchParams.get("LH_BIN"), "1")
  assert.equal(open.searchParams.get("LH_Sold"), null)
  assert.equal(sold.searchParams.get("LH_Sold"), "1")
  assert.equal(sold.searchParams.get("LH_Complete"), "1")
  assert.equal(sold.searchParams.get("LH_BIN"), null)
  const saved = { summary: { kind: "sold", currency: "GBP", count: 1, median: 9, low: 9, high: 9 }, checkedAt: new Date().toISOString(), searchUrl: sold.toString() }
  assert.equal(isCardPriceCheck(saved), true)
})
