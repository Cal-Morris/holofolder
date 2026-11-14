'use client';

import { SegmentedControl } from '@/components/ui/segmented-control';
import type { BinderScope } from '@/lib/binders/all-binders';

const OPTIONS = [
  { value: 'binder', label: 'This binder' },
  { value: 'all', label: 'All binders' },
] as const;

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
    <SegmentedControl
      value={scope}
      options={OPTIONS}
      onChange={onChange}
      label="Binders shown"
      data-testid="binder-scope"
      className={className}
    />
  );
}
