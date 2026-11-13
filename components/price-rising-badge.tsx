'use client';

import { TrendingUp } from 'lucide-react';
import { formatMomentumChange, getRisingMomentum, type MomentumPriceInput } from '@/lib/price-momentum';

interface PriceRisingBadgeProps {
  price: MomentumPriceInput | null | undefined;
  className?: string;
}

/** Small "Rising +18% · 30d" pill. Renders nothing unless the momentum rules qualify. */
export function PriceRisingBadge({ price, className = '' }: PriceRisingBadgeProps) {
  const momentum = getRisingMomentum(price);
  if (!momentum) return null;

  const change = formatMomentumChange(momentum.change);
  return (
    <span
      data-testid="price-rising-badge"
      title={`Price ${change} vs ${momentum.timeframe} average`}
      aria-label={`Rising ${change} over ${momentum.timeframe}`}
      className={`inline-flex items-center gap-0.5 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums shadow-sm ${className}`}
    >
      <TrendingUp className="h-3 w-3" aria-hidden="true" />
      {change}
      <span className="font-semibold opacity-85">{momentum.timeframe}</span>
    </span>
  );
}
