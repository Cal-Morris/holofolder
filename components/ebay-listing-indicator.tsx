"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { formatGbpAmount } from "@/lib/price-format"
import type { EbayListingSummary } from "@/lib/ebay-listings"
import type { CardFinish } from "@/lib/domain/cards"

export function EbayListingIndicator({ cardId, language = "en", finish }: { cardId: string; language?: string; finish?: CardFinish }) {
  const [result, setResult] = useState<{ summary: EbayListingSummary; checkedAt: string; searchUrl: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (language !== "en" || finish === "jumbo") return null
  const exactFinish = finish && ["normal", "holo", "reverse_holo"].includes(finish) ? finish : null

  async function checkListings() {
    if (!navigator.onLine) { setError("Connect to the internet to check eBay listings."); return }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ cardId })
      if (exactFinish) params.set("finish", exactFinish)
      const response = await fetch(`/api/ebay/listings?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "eBay listings are unavailable.")
      if (data?.summary?.kind !== "asking" || data.summary.currency !== "GBP" || !Number.isInteger(data.summary.count) || data.summary.count < 0 || data.summary.count > 50
        || ![data.summary.median, data.summary.low, data.summary.high].every(value => value === null || (typeof value === "number" && Number.isFinite(value) && value > 0))
        || (data.summary.count === 0 ? data.summary.median !== null || data.summary.low !== null || data.summary.high !== null : data.summary.low === null || data.summary.median === null || data.summary.high === null || data.summary.low > data.summary.median || data.summary.median > data.summary.high)
        || typeof data.searchUrl !== "string" || new URL(data.searchUrl).origin !== "https://www.ebay.co.uk" || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error("eBay listings are unavailable.")
      setResult(data)
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "eBay listings are unavailable. Try again when online.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-label="eBay asking prices" className="mt-2 rounded-xl border border-border/45 bg-background/35 px-2.5 py-2 text-xs">
      <p className="font-semibold">eBay UK asking prices</p>
      <p className="mt-1 text-muted-foreground">Active listings, not sold prices. Excluded from valuations and trends.</p>
      {result ? <div className="mt-2 space-y-1" aria-live="polite">
        {result.summary.count ? <>
          <p><strong>{formatGbpAmount(result.summary.median)}</strong> median asking price · {result.summary.count} matched listings</p>
          <p className="text-muted-foreground">Range {formatGbpAmount(result.summary.low)} to {formatGbpAmount(result.summary.high)}. Item prices only, postage excluded.</p>
        </> : <p>No matching listings in the search sample.</p>}
        <p className="text-muted-foreground">Title matches; conditions{exactFinish ? " vary" : " and finishes vary"}. Checked {new Date(result.checkedAt).toLocaleDateString("en-GB")}.</p>
        <a href={result.searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center underline">View listings on eBay</a>
      </div> : null}
      {error ? <p role="status" className="mt-2 text-muted-foreground">{error}</p> : null}
      {!result ? <Button type="button" variant="outline" size="sm" className="mt-2 min-h-9" onClick={() => void checkListings()} disabled={loading}>{loading ? "Checking eBay…" : "Check eBay asking prices"}</Button> : null}
    </section>
  )
}
