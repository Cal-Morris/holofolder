"use client"

import dynamic from "next/dynamic"
import type { CardPriceSnapshot } from "@/lib/card-pricing"
import { formatCurrencyAmount, formatGbpAmount } from "@/lib/price-format"
import { isMomentumEligibleConfidence } from "@/lib/price-momentum"

// The chart library is large and only needed once a card's price details are open, so the
// trend chart loads in its own chunk. The placeholder has the chart's exact height, so the
// sheet doesn't shift when it arrives.
const loadCardPriceTrendChart = () => import("@/components/card-price-trend-chart")
const CardPriceTrendChart = dynamic(loadCardPriceTrendChart, {
  ssr: false,
  loading: () => <div className="h-20 w-full" aria-hidden="true" />,
})

// Fetch the chunk once the app is idle so the chart is ready (and cached for offline use)
// before anyone opens a card.
if (typeof window !== "undefined") {
  const prefetch = () => { void loadCardPriceTrendChart().catch(() => undefined) }
  if ("requestIdleCallback" in window) window.requestIdleCallback(prefetch, { timeout: 5000 })
  else setTimeout(prefetch, 3000)
}

interface CardPriceEvidenceProps {
  price: CardPriceSnapshot | undefined
  showTrend?: boolean
  emptyMessage?: string
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return null

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null

  const days = Math.max(0, Math.round((Date.now() - timestamp) / (24 * 60 * 60 * 1000)))
  if (days === 0) return "today"
  if (days === 1) return "1 day ago"
  return `${days} days ago`
}

export function CardPriceEvidence({ price, showTrend = true, emptyMessage }: CardPriceEvidenceProps) {
  const sourcePrices = price?.sourcePrices ?? []
  const trendPoints = (price?.trendPoints ?? []).filter(point => point.source === "cardmarket")
  const history = price?.historyPoints ?? []
  // Cached snapshots can contain timing calls made before confidence gates.
  const rawBuySignal = price?.buySignal ?? null
  const buySignal = rawBuySignal && !isMomentumEligibleConfidence(price?.confidence)
    ? { status: "hold" as const, label: "Thin data", reason: "Price confidence is too low to call the timing." }
    : rawBuySignal

  if (!buySignal && sourcePrices.length === 0 && history.length === 0 && (!showTrend || trendPoints.length < 2)) {
    return emptyMessage ? <p className="mt-2 text-xs text-muted-foreground">{emptyMessage}</p> : null
  }

  const chartData = trendPoints.map((point) => ({
    label: point.label,
    value: point.gbpAmount,
    original: formatCurrencyAmount(point.originalAmount, point.originalCurrency),
  }))

  return (
    <div className="mt-2 space-y-2">
      {history.length > 0 ? (
        <details className="rounded-xl border border-border/45 bg-background/35 px-2.5 py-2 text-[10px]" aria-label="Recorded price history">
          <summary className="min-h-9 cursor-pointer py-2 font-semibold">TCGplayer history · USD · {history.length} quotes</summary>
          <p className="my-2 text-muted-foreground">{history[0].date} to {history[history.length - 1].date}. US market quotes, not sold listings. Missing dates stay empty. Latest 12 quotes shown.</p>
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">Dated TCGplayer market quotes in US dollars</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Finish</th><th scope="col" className="text-right">Market</th><th scope="col" className="text-right">Low</th></tr></thead>
            <tbody>{history.slice(-12).reverse().map(point => (
              <tr key={`${point.date}:${point.productId}:${point.finish}`}>
                <td className="py-1">{point.date}</td><td>{point.finish === "reverse_holo" ? "Reverse" : point.finish === "holo" ? "Holo" : "Normal"}</td>
                <td className="text-right">{formatCurrencyAmount(point.amount, "USD")}</td><td className="text-right">{point.lowAmount == null ? "Unknown" : formatCurrencyAmount(point.lowAmount, "USD")}</td>
              </tr>
            ))}</tbody>
          </table>
        </details>
      ) : null}
      {buySignal ? (
        <div className={getBuySignalClassName(buySignal.status)}>
          <div className="min-w-0">
            <p className="truncate font-semibold">{buySignal.label}</p>
            <p className="truncate text-muted-foreground">{buySignal.reason}</p>
          </div>
        </div>
      ) : null}

      {sourcePrices.length > 0 ? (
        <div className="grid gap-1.5">
          {sourcePrices.map((source) => {
            const market = formatGbpAmount(source.marketGbpAmount)
            const low = formatGbpAmount(source.lowGbpAmount)
            const originalMarket = source.originalCurrency === "GBP" ? null : formatCurrencyAmount(source.originalMarketAmount, source.originalCurrency)
            const originalLow = source.originalCurrency === "GBP" ? null : formatCurrencyAmount(source.originalLowAmount, source.originalCurrency)
            const updated = formatUpdatedAt(source.updatedAt)

            return (
              <div
                key={`${source.source}-${source.variantLabel ?? "default"}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border/45 bg-background/35 px-2.5 py-1.5 text-[10px] dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">
                    {source.label}{source.variantLabel ? `, ${source.variantLabel}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {[
                      low ? `Low ${low} GBP` : null,
                      updated ? `Updated ${updated}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="font-semibold">{market ? `${market} GBP` : "No market"}</p>
                  {originalMarket && <p className="text-muted-foreground">Original {originalMarket} {source.originalCurrency}</p>}
                  {originalLow && <p className="text-muted-foreground">Low {originalLow} {source.originalCurrency}</p>}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {showTrend && chartData.length >= 2 ? (
        <div className="rounded-xl border border-border/45 bg-background/35 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px]">
            <span className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Cardmarket trend · GBP</span>
            <span className="text-muted-foreground">avg 30d to now</span>
          </div>
          <CardPriceTrendChart data={chartData} />
        </div>
      ) : null}
    </div>
  )
}

function getBuySignalClassName(status: NonNullable<CardPriceSnapshot["buySignal"]>["status"]) {
  const base = "rounded-xl border px-2.5 py-1.5 text-[10px]"

  switch (status) {
    case "good":
      return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200`
    case "fair":
      return `${base} border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200`
    case "rising":
      return `${base} border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200`
    case "hold":
      return `${base} border-border/45 bg-background/35 text-foreground dark:border-white/10 dark:bg-white/[0.03]`
  }
}
