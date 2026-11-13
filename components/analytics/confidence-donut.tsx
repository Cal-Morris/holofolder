'use client';

// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- only rendered inside the analytics view, which is itself loaded with next/dynamic
import { Pie, PieChart } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { CONFIDENCE_BUCKETS, CONFIDENCE_STYLE, type ConfidenceBucket } from '@/lib/collection/analytics-insights';

/** How much of the total rests on reliable prices: a donut with the share priced in the middle. */
export default function AnalyticsConfidenceDonut({ counts }: { counts: Record<ConfidenceBucket, number> }) {
  const total = CONFIDENCE_BUCKETS.reduce((n, b) => n + counts[b], 0);
  const priced = counts.high + counts.medium + counts.low;
  const data = CONFIDENCE_BUCKETS.flatMap((bucket) =>
    counts[bucket] > 0 ? [{ bucket, value: counts[bucket], fill: CONFIDENCE_STYLE[bucket].color }] : [],
  );
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-28 shrink-0">
        <ChartContainer config={{}} className="aspect-square size-28" aria-hidden="true">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="bucket"
              innerRadius={38}
              outerRadius={54}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums">{total ? Math.round((priced / total) * 100) : 0}%</span>
          <span className="text-muted-foreground text-xs">priced</span>
        </div>
      </div>
      <ul className="min-w-0 space-y-1 text-sm">
        {data.map(({ bucket, value, fill }) => (
          <li key={bucket} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: fill }} aria-hidden="true" />
            <span className="min-w-0 truncate">{CONFIDENCE_STYLE[bucket].label}</span>
            <span className="text-muted-foreground ml-auto pl-2 tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
