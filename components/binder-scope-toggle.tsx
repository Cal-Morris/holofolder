'use client';

import type { BinderScope } from '@/lib/binders/all-binders';

/** "This binder / All binders" segmented control for the analytics and want list views. */
export function BinderScopeToggle({
  scope,
  onChange,
  className = '',
}: {
  scope: BinderScope;
  onChange: (scope: BinderScope) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Binders shown"
      data-testid="binder-scope"
      className={`border-border/60 bg-card inline-flex shrink-0 rounded-full border p-0.5 text-xs font-semibold dark:border-white/10 ${className}`}
    >
      {(['binder', 'all'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={scope === option}
          onClick={() => onChange(option)}
          className={`min-h-9 rounded-full px-3 transition-colors ${scope === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {option === 'binder' ? 'This binder' : 'All binders'}
        </button>
      ))}
    </div>
  );
}
