'use client';

import { useId } from 'react';
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { formatGbpAmount } from '@/lib/price-format';

export interface CardPriceTrendDatum {
  label: string;
  value: number | null | undefined;
  original: string | null;
}

/** Cardmarket trend sparkline for the card price details. Loaded on demand (see card-price-evidence). */
export default function CardPriceTrendChart({ data }: { data: CardPriceTrendDatum[] }) {
  const gradientId = useId().replaceAll(':', '');
  return (
    <ChartContainer config={{ value: { label: 'Price', color: 'var(--primary)' } }} className="aspect-auto h-20 w-full">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={4} fontSize={10} />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip
          cursor={false}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const item = payload[0]?.payload as { value?: number; original?: string } | undefined;
            return (
              <div className="border-border/60 bg-background rounded-lg border px-2 py-1 text-[10px] shadow-lg dark:border-white/10">
                <p className="font-semibold">{label}</p>
                <p className="tabular-nums">
                  {formatGbpAmount(item?.value)}
                  {item?.original ? ` · ${item.original}` : ''}
                </p>
              </div>
            );
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
  );
}
