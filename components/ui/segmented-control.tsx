'use client';

import { cn } from '@/lib/utils';

/** A pill row of two or three exclusive choices ("This binder / All binders", "Cards / Binder pages"). */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  ...props
}: {
  value: T;
  options: readonly { value: T; label: string }[];
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
          onClick={() => onChange(option.value)}
          className={`min-h-9 rounded-full px-3 transition-colors ${value === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
