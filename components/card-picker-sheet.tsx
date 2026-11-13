'use client';

import type { ReactNode } from 'react';
import { OverlayCloseButton, OverlayDialog, OverlayGrabber } from '@/components/ui/overlay-dialog';

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
  return (
    <OverlayDialog
      onClose={onClose}
      aria-label={title}
      // Taps inside stay out of the overlays and rows behind it in the React tree.
      onClick={(event) => event.stopPropagation()}
      className="max-h-none px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)]"
    >
      <div data-sheet-grabber className="-mx-4 -mt-3 px-4 pt-3">
        <OverlayGrabber />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
          </div>
          <OverlayCloseButton
            label="Back to cards"
            onClick={onClose}
            className="text-muted-foreground hover:bg-muted/70 hover:text-foreground -mr-1 h-9 w-9"
          />
        </div>
      </div>
      {children}
    </OverlayDialog>
  );
}

// oxlint-disable-next-line react-doctor/only-export-components -- class helper shared with the sheet's callers in other passes; moving it touches their imports
export const cardPickerSheetChoice = (highlighted = false) =>
  `flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-2xl border px-4 text-left text-sm font-semibold transition-colors ${
    highlighted
      ? 'border-primary/45 bg-primary/10 text-foreground'
      : 'border-border/60 bg-background/70 text-foreground hover:bg-muted/60'
  }`;
