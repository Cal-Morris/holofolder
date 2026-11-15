'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A pill row of two or three exclusive choices ("This binder / All binders", "Binder / List / Slabs").
 * An option with an `icon` shows only the icon in a square 36 px button, named by its label.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  ...props
}: {
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  /** The group's accessible name. */
  label: string;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-value={value}
      data-testid={props['data-testid']}
      className={cn(
        'border-border/60 bg-card inline-flex shrink-0 rounded-full border p-0.5 text-xs font-semibold dark:border-white/10',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.icon ? option.label : undefined}
          title={option.icon ? option.label : undefined}
          data-value={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-9 rounded-full transition-colors',
            option.icon ? 'inline-flex min-w-9 items-center justify-center' : 'px-3',
            value === option.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}
