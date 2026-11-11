'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';
import { MOMENTUM_SORT_OPTIONS, type MomentumSort } from '@/lib/momentum-sort';

/** Default / % down / % up chips (a radiogroup named "Price move"). */
export function MomentumSortChips({
  value,
  onChange,
  className = '',
}: {
  value: MomentumSort;
  onChange: (sort: MomentumSort) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Price move"
      className={`flex [scrollbar-width:none] gap-1.5 overflow-x-auto ${className}`}
    >
      {MOMENTUM_SORT_OPTIONS.map((option) => {
        const active = value === option.id;
        const Icon = option.id === 'falling' ? TrendingDown : option.id === 'rising' ? TrendingUp : null;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.id)}
            className={`flex h-12 shrink-0 items-center gap-1 rounded-full border px-4 text-sm font-semibold ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-card'}`}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
