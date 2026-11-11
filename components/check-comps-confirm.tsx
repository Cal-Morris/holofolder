'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';

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
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useOverlay(true, onCancel, { containerRef: sheetRef });

  const swipe = useSwipeToDismiss(sheetRef, onCancel);

  if (typeof document === 'undefined') return null;

  const n = cardsNeedingSoldcomps;
  const title = `${n} card${n === 1 ? '' : 's'} need a sold comps refresh. Check them now?`;

  return createPortal(
    <div
      data-overlay-backdrop
      data-testid="check-comps-confirm-backdrop"
      className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-comps-confirm-title"
        data-testid="check-comps-confirm"
        className="border-border/65 bg-card/97 dark:border-border/50 absolute inset-x-0 bottom-[var(--dock-clearance)] mx-auto max-h-[calc(100dvh-var(--dock-clearance)-var(--safe-top)-1rem)] w-full max-w-md overflow-y-auto rounded-t-[1.6rem] border-t px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] outline-none sm:rounded-[1.6rem] sm:border sm:pb-4 md:bottom-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div {...swipe} className="flex items-center justify-between pb-2">
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
      </div>
    </div>,
    document.body,
  );
}
