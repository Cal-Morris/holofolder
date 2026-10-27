"use client"

import { useState } from "react"
import { Area, ComposedChart, ErrorBar, Line, ReferenceArea, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { buildSoldPriceChart, type BuyingBand } from "@/lib/sold-price-guide"
import { formatGbpAmount } from "@/lib/price-format"
import type { CardPriceCheck } from "@/lib/card-price-checks"

export default function CardPriceComparisonChart({ sold, asking, goodBand, offerGbp }: { sold: CardPriceCheck | null; asking: CardPriceCheck | null; goodBand?: BuyingBand | null; offerGbp?: number | null }) {
  const [fullRange, setFullRange] = useState(false)
  const data = buildSoldPriceChart(sold)
  const daily = data.daily.map(day => ({ ...day, middle: day.range && day.median != null ? [day.median - day.range[0], day.range[1] - day.median] : null }))
  const ask = asking?.summary
  const bounds = [...daily.flatMap(day => day.range ?? []), ...(goodBand ? [goodBand.low, goodBand.high] : []), ...(ask?.median != null ? [ask.median] : []), ...(fullRange ? data.sales.map(sale => sale.amount) : [])]
  const min = Math.min(...bounds), max = Math.max(...bounds), padding = Math.max((max - min) * 0.15, max * 0.05)
  const date = (time: number) => new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
  return <figure aria-label="Sold price history" className="mt-2">
    <figcaption className="flex items-center justify-between gap-2 font-semibold"><span>Sold price history</span><span className="text-[10px] font-normal text-muted-foreground">GBP · tap a date</span></figcaption>
    {data.sales.length ? <>
      <ChartContainer config={{ range: { label: "Middle 50%", color: "#0284c7" }, median: { label: "Daily median", color: "#0284c7" } }} className="h-36 w-full aspect-auto">
        <ComposedChart data={daily} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
          <XAxis dataKey="time" type="number" scale="time" domain={[data.sales[0].time - 86400_000, data.sales.at(-1)!.time + 86400_000]} tickFormatter={date} tickLine={false} axisLine={false} fontSize={10} minTickGap={40} />
          <YAxis width={48} tickFormatter={value => formatGbpAmount(Number(value)) ?? "£0"} tickLine={false} axisLine={false} fontSize={10} domain={[Math.max(0, min - padding), max + padding]} allowDataOverflow />
          {goodBand ? <ReferenceArea y1={goodBand.low} y2={goodBand.high} fill="#059669" fillOpacity={0.15} /> : null}
          {ask?.median != null ? <ReferenceLine y={ask.median} stroke="#d97706" strokeDasharray="4 3" /> : null}
          <Tooltip content={({ active, payload }) => {
            const day = payload?.[0]?.payload
            if (!active || !day?.count) return null
            const sales = data.sales.filter(sale => sale.time === day.time)
            return <div className="rounded-lg border border-border bg-background px-2 py-1 text-xs shadow">
              <p>{date(day.time)} · {day.count} sales</p><p>Median {formatGbpAmount(day.median)}</p>
              <p>Middle 50% {formatGbpAmount(day.range[0])} to {formatGbpAmount(day.range[1])}</p>
              <p>Full range {formatGbpAmount(sales[0] ? Math.min(...sales.map(sale => sale.amount)) : null)} to {formatGbpAmount(sales[0] ? Math.max(...sales.map(sale => sale.amount)) : null)}</p>
            </div>
          }} />
          <Area dataKey="range" name="Middle 50%" type="linear" stroke="none" fill="var(--color-range)" fillOpacity={0.18} connectNulls={false} isAnimationActive={false} />
          <Line name="Daily median" dataKey="median" type="linear" stroke="var(--color-median)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false}>
            <ErrorBar dataKey={fullRange ? "whisker" : "middle"} width={3} direction="y" stroke="var(--color-median)" strokeWidth={2} />
          </Line>
          {offerGbp != null && offerGbp > 0 ? <ReferenceDot x={data.sales.at(-1)!.time + 43200_000} y={offerGbp} r={5} fill="currentColor" stroke="var(--background)" ifOverflow="hidden" /> : null}
        </ComposedChart>
      </ChartContainer>
      <div className="flex flex-wrap items-center gap-x-3 text-[10px] text-muted-foreground"><span><span className="text-sky-600">●</span> Middle 50% + median</span>{goodBand ? <span><span className="text-emerald-600">●</span> Good range</span> : null}{ask?.median != null ? <span><span className="text-amber-600">●</span> Current ask {formatGbpAmount(ask.median)}</span> : null}{offerGbp != null && offerGbp > 0 ? <span>● Your offer {formatGbpAmount(offerGbp)}{offerGbp < Math.max(0, min - padding) || offerGbp > max + padding ? " (off scale)" : ""}</span> : null}</div>
      <button type="button" aria-pressed={fullRange} className="min-h-9 text-[11px] underline" onClick={() => setFullRange(value => !value)}>{fullRange ? "Hide" : "Show"} full sale range</button>
    </> : <p className="my-2 text-muted-foreground">No dated sales to plot yet.{ask?.median != null ? ` Current asking median ${formatGbpAmount(ask.median)}.` : ""}</p>}
  </figure>
}
