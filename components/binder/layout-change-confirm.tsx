'use client';

import { X } from 'lucide-react';
import { OverlayDialog } from '@/components/ui/overlay-dialog';
import { describeBinderLayoutChange, type BinderLayoutChangePlan } from '@/lib/binder-layout-change';

/** Says what a native binder's new grid does to its cards before anything is queued. Nothing changes on cancel. */
export default function LayoutChangeConfirm({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: BinderLayoutChangePlan;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [first, ...rest] = describeBinderLayoutChange(plan);
  return (
    <OverlayDialog
      onClose={onCancel}
      aria-labelledby="layout-change-confirm-title"
      className="bg-card/97 dark:border-border/50 bottom-[var(--dock-clearance)] max-h-[calc(100dvh-var(--dock-clearance)-var(--safe-top)-1rem)] overflow-y-auto px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] sm:bottom-[var(--dock-clearance)] sm:pb-4 md:bottom-4"
    >
      <div data-sheet-grabber className="flex items-center justify-between pb-2">
        <span aria-hidden="true" className="bg-muted-foreground/30 h-1 w-10 rounded-full" />
        <button
          type="button"
          aria-label="Close layout change"
          onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <h2 id="layout-change-confirm-title" className="mb-1 text-base font-semibold">
        Change layout to {plan.to.rows}×{plan.to.cols}?
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">
        From {plan.from.rows}×{plan.from.cols} ({plan.from.rows * plan.from.cols} per page) to {plan.to.rows}×
        {plan.to.cols} ({plan.to.rows * plan.to.cols} per page). Cards move with their pockets.
      </p>
      <ul className="mb-4 space-y-2 text-sm">
        <li className="font-medium">{first}</li>
        {rest.map((line) => (
          <li key={line} className="text-muted-foreground">
            {line}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="bg-primary text-primary-foreground inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-3 text-sm font-semibold"
        >
          Change layout
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-border/60 text-muted-foreground inline-flex min-h-12 w-full items-center justify-center rounded-2xl border px-3 text-sm font-semibold dark:border-white/10"
        >
          Keep {plan.from.rows}×{plan.from.cols}
        </button>
      </div>
    </OverlayDialog>
  );
}
