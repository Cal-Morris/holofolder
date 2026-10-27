"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { formatGbpAmount } from "@/lib/price-format"
import { isCardPriceCheck, type CardPriceChecks } from "@/lib/card-price-checks"
import type { CardFinish } from "@/lib/domain/cards"

export function CardPriceComparison({ cardId, language = "en", finish }: { cardId: string; language?: string; finish?: CardFinish }) {
  const [result, setResult] = useState<CardPriceChecks | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (language !== "en" || finish === "jumbo") return null
  const exactFinish = finish && ["normal", "holo", "reverse_holo"].includes(finish) ? finish : "any"

  async function checkPrices() {
    if (!navigator.onLine) { setError("Connect to the internet to check prices."); return }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ cardId, language, finish: exactFinish })
      const response = await fetch(`/api/card-price-checks?${params}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(45_000) })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Price checks are unavailable.")
      if (!data || !(data.ebay === null || (isCardPriceCheck(data.ebay) && data.ebay.summary.kind === "asking"))
        || !(data.soldcomps === null || (isCardPriceCheck(data.soldcomps) && data.soldcomps.summary.kind === "sold"))
        || !data.errors || typeof data.errors !== "object" || !Object.values(data.errors).every(value => typeof value === "string")) throw new Error("Invalid price check response.")
      setResult(data)
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "Price checks timed out. Try again later.")
    } finally { setLoading(false) }
  }

  return (
    <section aria-label="Price comparisons" className="mt-2 rounded-xl border border-border/45 bg-background/35 px-2.5 py-2 text-xs">
      <p className="font-semibold">eBay listings + sold comps</p>
      <p className="mt-1 text-muted-foreground">Asking and sold prices shown separately. Excluded from valuations and deal verdicts.</p>
      {result ? <div className="mt-2 space-y-2" aria-live="polite">
        {(["ebay", "soldcomps"] as const).map(source => {
          const check = result[source]
          const label = source === "ebay" ? "eBay UK asking prices" : "SaleHistory UK sold comps"
          return <div key={source}>
            <p className="font-semibold">{label}</p>
            {check ? <>
              {check.summary.count ? <p><strong>{formatGbpAmount(check.summary.median)}</strong> median {source === "ebay" ? "asking" : "sold"} price · {check.summary.count} matched {source === "ebay" ? "listings" : "sales"}</p> : <p>No matching {source === "ebay" ? "listings" : "sales"} in the search sample.</p>}
              {check.summary.count > 0 ? <p className="text-muted-foreground">Range {formatGbpAmount(check.summary.low)} to {formatGbpAmount(check.summary.high)}. Postage excluded.</p> : null}
              <p className="text-muted-foreground">Saved {new Date(check.checkedAt).toLocaleString("en-GB")}. Conditions{exactFinish === "any" ? " and finishes" : ""} vary{source === "soldcomps" ? "; sales from the last 90 days, hidden offers excluded" : "; active listings, not sold prices"}.</p>
              {check.searchUrl ? <a href={check.searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center underline">View listings on eBay</a> : null}
            </> : null}
            {result.errors[source] ? <p role="status" className="text-muted-foreground">{label}: {result.errors[source]}{check ? " Showing the saved check." : ""}</p> : null}
          </div>
        })}
      </div> : null}
      {error ? <p role="status" className="mt-2 text-muted-foreground">{error}</p> : null}
      <Button type="button" variant="outline" size="sm" className="mt-2 min-h-9" onClick={() => void checkPrices()} disabled={loading}>{loading ? "Checking prices…" : "Check prices"}</Button>
      <p className="mt-1 text-muted-foreground">Checks are saved per card and finish, and reused for 12 hours.</p>
    </section>
  )
}
