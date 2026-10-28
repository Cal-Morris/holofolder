"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { requestCardPriceCheck } from "@/lib/card-price-check-client"
import { PriceCheckRecords } from "@/components/price-check-records"
import { DealPriceScale } from "@/components/deal-price-scale"
import { Button } from "@/components/ui/button"
import { formatGbpAmount } from "@/lib/price-format"
import { type CardPriceChecks, type CardPriceCheck, type PriceCheckSource } from "@/lib/card-price-checks"
import { buildSoldPriceGuide } from "@/lib/sold-price-guide"
import { readDealThresholds, type DealThresholds } from "@/lib/deal-check"
import type { CardFinish } from "@/lib/domain/cards"

const ComparisonChart = dynamic(() => import("@/components/card-price-comparison-chart"), { ssr: false, loading: () => <div className="h-56" aria-hidden="true" /> })

export function CardPriceComparison({ cardId, language = "en", finish, catalogMarketGbp, thresholds: givenThresholds, onSoldCheck, offerGbp, showBuyingScale = true }: {
  cardId: string; language?: string; finish?: CardFinish; catalogMarketGbp?: number | null; thresholds?: DealThresholds; onSoldCheck?: (check: CardPriceCheck) => void; offerGbp?: number | null; showBuyingScale?: boolean
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
      const { check, error } = await requestCardPriceCheck(cardId, language, finish, source, signal)
      if (signal.aborted) return
      setResult(previous => ({ ebay: null, soldcomps: null, ...previous, [source]: check, errors: { ...previous?.errors, [source]: error } }))
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
      <p className="mt-1 text-muted-foreground">Manual checks · saved for 12 hours</p>
      {result ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-live="polite">
        {(["ebay", "soldcomps"] as const).map(source => <div key={source}>
          {pending[source] ? <p role="status">Checking {source === "ebay" ? "eBay" : "sold comps"}…</p> : null}
          {result[source]?.summary.count ? <p><strong>{formatGbpAmount(result[source]!.summary.median)}</strong> median {source === "ebay" ? "asking" : "sold"} price · {result[source]!.summary.count} matched {source === "ebay" ? "listings" : "sales"}</p> : result[source] ? <p>No matching {source === "ebay" ? "listings" : "sales"} in the search sample.</p> : null}
          {result.errors[source] ? <p role="status" className="text-muted-foreground">{result.errors[source]}{result[source] ? " Showing the saved check." : ""}</p> : null}
        </div>)}
      </div> : null}
      {result ? <PriceCheckRecords checks={result} /> : null}
      {result && (result.ebay || result.soldcomps) ? <ComparisonChart sold={result.soldcomps} asking={result.ebay} marketGbp={guide?.referenceGbp ?? catalogMarketGbp} thresholds={givenThresholds ?? savedThresholds} offerGbp={offerGbp} /> : null}
      {showBuyingScale && guide?.eligible ? <DealPriceScale market={guide.referenceGbp!} overlap={guide.fairOverlap} thresholds={givenThresholds ?? savedThresholds} money={value => formatGbpAmount(value) ?? ""} /> : null}
      {result ? <details className="mt-1">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold">Evidence</summary>
        <div className="space-y-2 text-muted-foreground">
          {guide ? <p>{guide.reason} {guide.count} recent sales across {guide.days} dates. Conditions vary.</p> : null}
          {guide?.eligible && guide.fairOverlap ? <p>Fair-range agreement with catalogue: {formatGbpAmount(guide.fairOverlap.low)} to {formatGbpAmount(guide.fairOverlap.high)}.</p> : null}
          {(["ebay", "soldcomps"] as const).map(source => {
            const check = result[source]
            return check ? <div key={source}>
              <p>{source === "ebay" ? "eBay UK asking prices" : "SaleHistory UK sold comps"} · Range {formatGbpAmount(check.summary.low)} to {formatGbpAmount(check.summary.high)}. Postage excluded.</p>
              <p>Saved {new Date(check.checkedAt).toLocaleString("en-GB")}. Conditions{exactFinish === "any" ? " and finishes" : ""} vary{source === "soldcomps" ? "; sales from the last 90 days, hidden offers excluded" : "; current asking snapshot, not historical asking prices"}.</p>
            </div> : null
          })}
          <p>Fair / expected is centred on the market reference using your Fair tolerance. Green marks bargains; amber and red mark prices above market. Purple outlines agreement with the catalogue fair range. Only qualified sold evidence changes the guide.</p>
        </div>
      </details> : null}
      {error ? <p role="status" className="mt-2 text-muted-foreground">{error}</p> : null}
      <Button type="button" variant="outline" size="sm" className="mt-2 min-h-14 w-full rounded-2xl text-base font-bold" onClick={() => void checkPrices()} disabled={loading}>{loading ? "Checking prices…" : "Check prices"}</Button>
    </section>
  )
}
