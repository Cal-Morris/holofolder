'use client';

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';

/** The card picker's small bottom sheet (variant, copy and save questions), on the shared overlay primitive. */
export default function CardPickerSheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useOverlay(true, onClose, { containerRef: sheetRef });
  const swipe = useSwipeToDismiss(sheetRef, onClose);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-overlay-backdrop className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="border-border/65 bg-card absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[1.6rem] border-t px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] outline-none sm:bottom-4 sm:rounded-[1.6rem] sm:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div data-sheet-grabber className="-mx-4 -mt-3 px-4 pt-3" {...swipe}>
          <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto mb-2 h-1.5 w-10 rounded-full" />
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to cards"
              className="text-muted-foreground hover:bg-muted/70 hover:text-foreground -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const cardPickerSheetChoice = (highlighted = false) =>
  `flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-2xl border px-4 text-left text-sm font-semibold transition-colors ${
    highlighted
      ? 'border-primary/45 bg-primary/10 text-foreground'
      : 'border-border/60 bg-background/70 text-foreground hover:bg-muted/60'
  }`;
