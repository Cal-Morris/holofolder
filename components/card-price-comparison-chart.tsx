"use client"

import { useState } from "react"
import { ComposedChart, Line, ReferenceArea, ReferenceLine, Scatter, Tooltip, XAxis, YAxis } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { buildSoldPriceChart } from "@/lib/sold-price-guide"
import { formatGbpAmount } from "@/lib/price-format"
import type { CardPriceCheck } from "@/lib/card-price-checks"

export default function CardPriceComparisonChart({ sold, asking }: { sold: CardPriceCheck | null; asking: CardPriceCheck | null }) {
  const [overlay, setOverlay] = useState(true)
  const data = buildSoldPriceChart(sold)
  const ask = asking?.summary
  const date = (time: number) => new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
  return <figure aria-label="Sold prices and current eBay asking range" className="mt-3">
    <figcaption className="font-semibold">Sold prices over time</figcaption>
    {data.sales.length ? <>
      <ChartContainer config={{ amount: { label: "Sale", color: "#059669" }, median: { label: "Daily sold median", color: "#0284c7" } }} className="h-40 w-full aspect-auto">
        <ComposedChart data={data.daily} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <XAxis dataKey="time" type="number" scale="time" domain={[data.sales[0].time - 86400_000, data.sales.at(-1)!.time + 86400_000]} tickFormatter={date} tickLine={false} axisLine={false} fontSize={10} minTickGap={32} />
          <YAxis width={48} tickFormatter={value => formatGbpAmount(Number(value)) ?? "£0"} tickLine={false} axisLine={false} fontSize={10} domain={["auto", "auto"]} />
          {overlay && ask?.count && ask.low != null && ask.high != null ? <ReferenceArea y1={ask.low} y2={ask.high} fill="#d97706" fillOpacity={0.12} ifOverflow="extendDomain" /> : null}
          {overlay && ask?.median != null ? <ReferenceLine y={ask.median} stroke="#d97706" strokeDasharray="4 3" ifOverflow="extendDomain" /> : null}
          <Tooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return <div className="rounded-lg border border-border bg-background px-2 py-1 text-xs shadow">
              <p>{date(Number(payload[0]?.payload?.time ?? label))}</p>
              {payload.map((point, i) => <p key={i}>{point.name}: {formatGbpAmount(typeof point.value === "number" ? point.value : null)}</p>)}
            </div>
          }} />
          <Line name="Daily sold median" dataKey="median" type="linear" stroke="var(--color-median)" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Scatter name="Sale" data={data.sales} dataKey="amount" fill="var(--color-amount)" fillOpacity={0.55} isAnimationActive={false} />
        </ComposedChart>
      </ChartContainer>
      <p className="text-muted-foreground">Dots are individual sales; the line is each day’s median. Gaps have no sales.</p>
    </> : <>
      {ask?.count && ask.low != null && ask.high != null && ask.median != null ? <svg role="img" aria-label="Current eBay asking-price spread" viewBox="0 0 300 76" className="my-2 w-full">
        <line x1="12" x2="288" y1="32" y2="32" stroke="currentColor" opacity="0.3" strokeWidth="4" />
        <circle cx={12 + (ask.median - ask.low) / (ask.high - ask.low || 1) * 276} cy="32" r="5" fill="#d97706" />
        <text x="150" y="14" textAnchor="middle" fill="currentColor" fontSize="10">Median {formatGbpAmount(ask.median)}</text>
        <text x="12" y="61" fill="currentColor" fontSize="10">{formatGbpAmount(ask.low)}</text>
        <text x="288" y="61" textAnchor="end" fill="currentColor" fontSize="10">{formatGbpAmount(ask.high)}</text>
      </svg> : null}
      <p className="my-2 text-muted-foreground">No dated sales to plot yet.</p>
    </>}
    {ask?.count ? <>
      <button type="button" aria-pressed={overlay} className="mt-1 min-h-9 underline" onClick={() => setOverlay(value => !value)}>{overlay ? "Hide" : "Show"} current asking overlay</button>
      <p className="text-muted-foreground">Current asks: {formatGbpAmount(ask.low)} to {formatGbpAmount(ask.high)}, median {formatGbpAmount(ask.median)}. {data.sales.length ? "Shaded band and dashed line are the current asking snapshot, not historical asking prices." : "A single asking snapshot cannot show a trend."}</p>
    </> : null}
  </figure>
}
