"use client"

import { Area, AreaChart, Tooltip, XAxis, YAxis } from "recharts"
import { useId } from "react"
import { ChartContainer } from "@/components/ui/chart"
import type { CardPriceSnapshot, SupportedCurrency } from "@/lib/card-pricing"
import { isMomentumEligibleConfidence } from "@/lib/price-momentum"

interface CardPriceEvidenceProps {
  price: CardPriceSnapshot | undefined
  showTrend?: boolean
}

function formatCurrencyAmount(amount: number | null | undefined, currency: SupportedCurrency) {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount)
}

function formatGbpAmount(amount: number | null | undefined) {
  return typeof amount === "number" && Number.isFinite(amount)
    ? formatCurrencyAmount(amount, "GBP")
    : null
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

export function CardPriceEvidence({ price, showTrend = true }: CardPriceEvidenceProps) {
  const gradientId = useId().replaceAll(":", "")
  const sourcePrices = price?.sourcePrices ?? []
  const trendPoints = price?.trendPoints ?? []
  const history = price?.historyPoints ?? []
  // Cached snapshots can contain timing calls made before confidence gates.
  const rawBuySignal = price?.buySignal ?? null
  const buySignal = rawBuySignal && !isMomentumEligibleConfidence(price?.confidence)
    ? { status: "hold" as const, label: "Thin data", reason: "Price confidence is too low to call the timing." }
    : rawBuySignal

  if (!buySignal && sourcePrices.length === 0 && history.length === 0 && (!showTrend || trendPoints.length < 2)) {
    return null
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
                  <p className="truncate text-muted-foreground">
                    {[
                      low ? `Low ${low}` : null,
                      updated ? `Updated ${updated}` : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="font-semibold">{market ?? "No market"}</p>
                  {originalMarket && <p className="text-muted-foreground">Original {originalMarket} {source.originalCurrency}</p>}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {showTrend && chartData.length >= 2 ? (
        <div className="rounded-xl border border-border/45 bg-background/35 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
            <span className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">Cardmarket trend</span>
            <span className="text-muted-foreground">avg 30d to now</span>
          </div>
          <ChartContainer
            config={{ value: { label: "Price", color: "var(--chart-2)" } }}
            className="h-20 w-full aspect-auto"
          >
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={4} fontSize={10} />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip
                cursor={false}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0]?.payload as { value?: number; original?: string } | undefined
                  return (
                    <div className="rounded-lg border border-border/60 bg-background px-2 py-1 text-[10px] shadow-lg dark:border-white/10">
                      <p className="font-semibold">{label}</p>
                      <p className="tabular-nums">{formatGbpAmount(item?.value)}{item?.original ? ` · ${item.original}` : ""}</p>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={{ r: 2 }}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          </ChartContainer>
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
