'use client';

import { X } from 'lucide-react';
import { OverlayDialog } from '@/components/ui/overlay-dialog';

/** In-app confirm for big runs (engine asks at CHECK_COMPS_CONFIRM_AT+). Matches owned-remove sheet chrome. */
export default function CheckCompsConfirm({
  cardsNeedingSoldcomps,
  onConfirm,
  onCancel,
}: {
  cardsNeedingSoldcomps: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const n = cardsNeedingSoldcomps;
  const title = `${n} card${n === 1 ? '' : 's'} need a sold comps refresh. Check them now?`;

  return (
    <OverlayDialog
      onClose={onCancel}
      aria-labelledby="check-comps-confirm-title"
      data-testid="check-comps-confirm"
      className="bg-card/97 dark:border-border/50 bottom-[var(--dock-clearance)] max-h-[calc(100dvh-var(--dock-clearance)-var(--safe-top)-1rem)] overflow-y-auto px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] sm:bottom-[var(--dock-clearance)] sm:pb-4 md:bottom-4"
    >
      <div data-sheet-grabber className="flex items-center justify-between pb-2">
        <span aria-hidden="true" className="bg-muted-foreground/30 h-1 w-10 rounded-full" />
        <button
          type="button"
          aria-label="Close price check confirmation"
          onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p id="check-comps-confirm-title" className="mb-4 text-sm leading-snug font-semibold">
        {title}
      </p>
      <p className="text-muted-foreground mb-4 text-xs">
        Up to {n} sold comps lookups use the provider allowance. eBay asking prices are checked too. Saved checks are
        reused regardless of age.
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="bg-primary text-primary-foreground inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-3 text-sm font-semibold"
        >
          Check now
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-border/60 text-muted-foreground inline-flex min-h-12 w-full items-center justify-center rounded-2xl border px-3 text-sm font-semibold dark:border-white/10"
        >
          Cancel
        </button>
      </div>
    </OverlayDialog>
  );
}
