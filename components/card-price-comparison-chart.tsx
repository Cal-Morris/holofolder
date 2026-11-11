'use client';

import { useState } from 'react';
import {
  Area,
  ComposedChart,
  ErrorBar,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { buildSoldPriceChart } from '@/lib/sold-price-guide';
import { buildDealPriceBands, type DealThresholds } from '@/lib/deal-check';
import { formatGbpAmount } from '@/lib/price-format';
import type { CardPriceCheck } from '@/lib/card-price-checks';

export default function CardPriceComparisonChart({
  sold,
  asking,
  marketGbp,
  thresholds,
  offerGbp,
}: {
  sold: CardPriceCheck | null;
  asking: CardPriceCheck | null;
  marketGbp?: number | null;
  thresholds?: DealThresholds;
  offerGbp?: number | null;
}) {
  const [fullRange, setFullRange] = useState(false);
  const data = buildSoldPriceChart(sold);
  const daily = data.daily.map((day) => ({
    ...day,
    middle: day.range && day.median != null ? [day.median - day.range[0], day.range[1] - day.median] : null,
  }));
  const ask = asking?.summary;
  const bands = marketGbp != null ? buildDealPriceBands(marketGbp, thresholds) : null;
  const bounds = [
    ...daily.flatMap((day) => day.range ?? []),
    ...(bands ? [bands.greatBelow, bands.fair.low, bands.fair.high] : []),
    ...(ask?.median != null ? [ask.median] : []),
    ...(fullRange ? data.sales.map((sale) => sale.amount) : []),
  ];
  const min = Math.min(...bounds),
    max = Math.max(...bounds),
    padding = Math.max((max - min) * 0.15, max * 0.05);
  const date = (time: number) =>
    new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <figure aria-label="Sold price history" className="mt-2">
      <figcaption className="flex items-center justify-between gap-2 font-semibold">
        <span>Sold price history</span>
        <span className="text-muted-foreground text-[10px] font-normal">GBP · tap a date</span>
      </figcaption>
      {data.sales.length ? (
        <>
          <ChartContainer
            config={{
              range: { label: 'Middle 50%', color: '#64748b' },
              median: { label: 'Daily median', color: '#64748b' },
            }}
            className="aspect-auto h-36 w-full"
          >
            <ComposedChart data={daily} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={[data.sales[0].time - 86400_000, data.sales.at(-1)!.time + 86400_000]}
                tickFormatter={date}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                minTickGap={40}
              />
              <YAxis
                width={48}
                tickFormatter={(value) => formatGbpAmount(Number(value)) ?? '£0'}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                domain={[Math.max(0, min - padding), max + padding]}
                allowDataOverflow
              />
              {bands
                ? [
                    { low: Math.max(0, min - padding), high: bands.fair.low, color: '#059669' },
                    { low: bands.fair.low, high: bands.fair.high, color: '#0284c7' },
                    { low: bands.fair.high, high: bands.walkAwayAbove, color: '#d97706' },
                    { low: bands.walkAwayAbove, high: max + padding, color: '#dc2626' },
                  ].map((zone, i) =>
                    Math.min(zone.high, max + padding) > Math.max(zone.low, min - padding) ? (
                      <ReferenceArea
                        key={i}
                        y1={Math.max(zone.low, min - padding)}
                        y2={Math.min(zone.high, max + padding)}
                        fill={zone.color}
                        fillOpacity={0.12}
                      />
                    ) : null,
                  )
                : null}
              {ask?.median != null ? <ReferenceLine y={ask.median} stroke="#7c3aed" strokeDasharray="4 3" /> : null}
              <Tooltip
                content={({ active, payload }) => {
                  const day = payload?.[0]?.payload;
                  if (!active || !day?.count) return null;
                  const sales = data.sales.filter((sale) => sale.time === day.time);
                  return (
                    <div className="border-border bg-background rounded-lg border px-2 py-1 text-xs shadow">
                      <p>
                        {date(day.time)} · {day.count} sales
                      </p>
                      <p>Median {formatGbpAmount(day.median)}</p>
                      <p>
                        Middle 50% {formatGbpAmount(day.range[0])} to {formatGbpAmount(day.range[1])}
                      </p>
                      <p>
                        Full range {formatGbpAmount(sales[0] ? Math.min(...sales.map((sale) => sale.amount)) : null)} to{' '}
                        {formatGbpAmount(sales[0] ? Math.max(...sales.map((sale) => sale.amount)) : null)}
                      </p>
                    </div>
                  );
                }}
              />
              <Area
                dataKey="range"
                name="Middle 50%"
                type="linear"
                stroke="none"
                fill="var(--color-range)"
                fillOpacity={0.18}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                name="Daily median"
                dataKey="median"
                type="linear"
                stroke="var(--color-median)"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              >
                <ErrorBar
                  dataKey={fullRange ? 'whisker' : 'middle'}
                  width={3}
                  direction="y"
                  stroke="var(--color-median)"
                  strokeWidth={2}
                />
              </Line>
              {offerGbp != null && offerGbp > 0 ? (
                <ReferenceDot
                  x={data.sales.at(-1)!.time + 43200_000}
                  y={offerGbp}
                  r={5}
                  fill="currentColor"
                  stroke="var(--background)"
                  ifOverflow="hidden"
                />
              ) : null}
            </ComposedChart>
          </ChartContainer>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-[10px]">
            <span>
              <span className="text-slate-500">●</span> Sales · middle 50% + median
            </span>
            {bands ? (
              <>
                <span className="text-emerald-700 dark:text-emerald-400">● Bargain</span>
                <span className="text-sky-700 dark:text-sky-400">● Fair / expected</span>
                <span className="text-amber-700 dark:text-amber-400">● Above market</span>
                <span className="text-red-700 dark:text-red-400">● Walk away</span>
              </>
            ) : null}
            {ask?.median != null ? (
              <span>
                <span className="text-violet-600">●</span> Current ask {formatGbpAmount(ask.median)}
              </span>
            ) : null}
            {offerGbp != null && offerGbp > 0 ? (
              <span>
                ● Your offer {formatGbpAmount(offerGbp)}
                {offerGbp < Math.max(0, min - padding) || offerGbp > max + padding ? ' (off scale)' : ''}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            aria-pressed={fullRange}
            className="min-h-12 text-[11px] underline"
            onClick={() => setFullRange((value) => !value)}
          >
            {fullRange ? 'Hide' : 'Show'} full sale range
          </button>
        </>
      ) : (
        <p className="text-muted-foreground my-2">
          No dated sales to plot yet.
          {ask?.median != null ? ` Current asking median ${formatGbpAmount(ask.median)}.` : ''}
        </p>
      )}
    </figure>
  );
}
