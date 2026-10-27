"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { formatGbpAmount } from "@/lib/price-format"
import { isCardPriceCheck, type CardPriceChecks, type CardPriceCheck, type PriceCheckSource } from "@/lib/card-price-checks"
import { buildSoldPriceGuide, type BuyingBand } from "@/lib/sold-price-guide"
import { readDealThresholds, type DealThresholds } from "@/lib/deal-check"
import type { CardFinish } from "@/lib/domain/cards"

const ComparisonChart = dynamic(() => import("@/components/card-price-comparison-chart"), { ssr: false, loading: () => <div className="h-56" aria-hidden="true" /> })

export function CardPriceComparison({ cardId, language = "en", finish, catalogMarketGbp, thresholds: givenThresholds, onSoldCheck }: {
  cardId: string; language?: string; finish?: CardFinish; catalogMarketGbp?: number | null; thresholds?: DealThresholds; onSoldCheck?: (check: CardPriceCheck) => void
}) {
  const [result, setResult] = useState<CardPriceChecks | null>(null)
  const requestController = useRef<AbortController | null>(null)
  useEffect(() => () => requestController.current?.abort(), [])
  const [pending, setPending] = useState({ ebay: false, soldcomps: false })
  const [error, setError] = useState<string | null>(null)
  const [savedThresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  if (language !== "en" || finish === "jumbo") return null
  const exactFinish = finish && ["normal", "holo", "reverse_holo"].includes(finish) ? finish : "any"
  const loading = pending.ebay || pending.soldcomps
  const guide = buildSoldPriceGuide(result?.soldcomps, catalogMarketGbp, finish, givenThresholds ?? savedThresholds)

  async function checkSource(source: PriceCheckSource, signal: AbortSignal) {
    try {
      const params = new URLSearchParams({ cardId, language, finish: exactFinish, source })
      const response = await fetch(`/api/card-price-checks?${params}`, { method: "POST", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Price check unavailable.")
      const check = data?.[source]
      if (!(check === null || (isCardPriceCheck(check) && check.summary.kind === (source === "ebay" ? "asking" : "sold")))
        || !data?.errors || typeof data.errors !== "object" || (data.errors[source] !== undefined && typeof data.errors[source] !== "string")) throw new Error("Invalid price check response.")
      if (signal.aborted) return
      setResult(previous => ({ ebay: null, soldcomps: null, ...previous, [source]: check, errors: { ...previous?.errors, [source]: data.errors[source] } }))
      if (source === "soldcomps" && check) onSoldCheck?.(check)
    } catch (failure) {
      if (signal.aborted) return
      const message = failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "Price check timed out. Try again later."
      setResult(previous => ({ ebay: null, soldcomps: null, ...previous, errors: { ...previous?.errors, [source]: message } }))
    } finally { if (!signal.aborted) setPending(previous => ({ ...previous, [source]: false })) }
  }

  async function checkPrices() {
    if (loading) return
    if (!navigator.onLine) { setError("Connect to the internet to check prices."); return }
    setError(null)
    setResult(previous => ({ ebay: null, soldcomps: null, ...previous, errors: {} }))
    setPending({ ebay: true, soldcomps: true })
    const controller = new AbortController()
    requestController.current = controller
    await Promise.all([checkSource("ebay", controller.signal), checkSource("soldcomps", controller.signal)])
  }

  return (
    <section aria-label="Price comparisons" className="mt-2 rounded-xl border border-border/45 bg-background/35 px-2.5 py-2 text-xs">
      <p className="font-semibold">eBay listings + sold comps</p>
      <p className="mt-1 text-muted-foreground">Asking and sold prices shown separately. Only qualifying sold evidence can adjust the buying guide.</p>
      {result ? <div className="mt-2 space-y-2" aria-live="polite">
        {(["ebay", "soldcomps"] as const).map(source => {
          const check = result[source]
          const label = source === "ebay" ? "eBay UK asking prices" : "SaleHistory UK sold comps"
          return <div key={source}>
            <p className="font-semibold">{label}</p>
            {pending[source] ? <p role="status">Checking {source === "ebay" ? "eBay" : "sold comps"}…</p> : null}
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
      {result && (result.ebay || result.soldcomps) ? <ComparisonChart sold={result.soldcomps} asking={result.ebay} /> : null}
      {guide ? <div className="mt-3 space-y-1" aria-label="Sold buying guide">
        <p className="font-semibold">Recent sold evidence · {guide.count} sales across {guide.days} dates</p>
        <p>Middle 50% sold range: {formatGbpAmount(guide.q1)} to {formatGbpAmount(guide.q3)}.</p>
        <p className="text-muted-foreground">{guide.reason} Conditions vary.</p>
        {guide.eligible ? <BuyingOverlap sold={guide.soldBand} catalog={guide.catalogBand} overlap={guide.overlap} /> : guide.catalogBand && !guide.overlap ? <p>No good-price overlap.</p> : null}
      </div> : null}
      {error ? <p role="status" className="mt-2 text-muted-foreground">{error}</p> : null}
      <Button type="button" variant="outline" size="sm" className="mt-2 min-h-9" onClick={() => void checkPrices()} disabled={loading}>{loading ? "Checking prices…" : "Check prices"}</Button>
      <p className="mt-1 text-muted-foreground">Checks are saved per card and finish, and reused for 12 hours.</p>
    </section>
  )
}

function BuyingOverlap({ sold, catalog, overlap }: { sold: BuyingBand; catalog: BuyingBand | null; overlap: BuyingBand | null }) {
  const bands = [{ label: "Sold good-buy range", value: sold, color: "bg-emerald-500" }, ...(catalog ? [{ label: "Catalogue good-buy range", value: catalog, color: "bg-sky-500" }] : []), ...(overlap ? [{ label: "Good-price overlap", value: overlap, color: "bg-violet-500" }] : [])]
  const min = Math.min(...bands.map(band => band.value.low)), max = Math.max(...bands.map(band => band.value.high))
  return <figure aria-label="Good-price overlap" className="space-y-2 pt-1">
    {bands.map(({ label, value, color }) => <div key={label}>
      <p>{label}: {formatGbpAmount(value.low)} to {formatGbpAmount(value.high)}</p>
      <div className="relative mt-1 h-2 rounded bg-muted" aria-hidden="true"><div className={`absolute h-2 rounded ${color}`} style={{ left: `${(value.low - min) / (max - min || 1) * 100}%`, width: `${Math.max(1, (value.high - value.low) / (max - min || 1) * 100)}%` }} /></div>
    </div>)}
    <figcaption className="text-muted-foreground">Good-buy bands use your Great and Fair discounts. The sold median is the reference when evidence qualifies; overlap shows where both guides agree.</figcaption>
  </figure>
}
