'use client';

import { TrendingDown } from 'lucide-react';
import { formatMomentumChange, getFallingMomentum, type MomentumPriceInput } from '@/lib/price-momentum';

interface PriceDropBadgeProps {
  price: MomentumPriceInput | null | undefined;
  className?: string;
}

/** Small "Drop −18%" ("Price dropped −18%" on wider screens) pill for wanted cards. Renders nothing unless the drop rules qualify. */
export function PriceDropBadge({ price, className = '' }: PriceDropBadgeProps) {
  const momentum = getFallingMomentum(price);
  if (!momentum) return null;

  const change = formatMomentumChange(momentum.change).replace('-', '−');
  return (
    <span
      data-testid="price-drop-badge"
      title={`Price dropped ${change} vs ${momentum.timeframe} average`}
      aria-label={`Price dropped ${change} over ${momentum.timeframe}`}
      className={`inline-flex items-center gap-0.5 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums shadow-sm ${className}`}
    >
      <TrendingDown className="h-3 w-3" aria-hidden="true" />
      {/* Short on phones so the card name keeps its room; the full wording is in the label. */}
      <span className="sm:hidden">Drop</span>
      <span className="hidden sm:inline">Price dropped</span>
      {change}
    </span>
  );
}
