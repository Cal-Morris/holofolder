'use client';

import type { ComponentProps, ReactNode } from 'react';
import { OverlayDialog, OverlayGrabber } from '@/components/ui/overlay-dialog';
import { cn } from '@/lib/utils';

/**
 * The shell of the all-cards views (a Pokémon's cards, an illustrator's cards): non-modal, so the dock stays usable,
 * above the card details (z-43/44). A tall sheet over the dock on phones that swipes down; a centred panel on desktop.
 * `header` drags the sheet; the scrolling list follows as `children`.
 */
export default function CardsBrowserSheet({
  isDesktop,
  phoneHeight,
  header,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof OverlayDialog>, 'children'> & {
  isDesktop: boolean;
  /** The sheet's CSS height on phones, from the top inset down to just above the dock. */
  phoneHeight: string;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <OverlayDialog
      modal={false}
      swipe={!isDesktop}
      backdropProps={{ className: 'z-[43] bg-black/55' }}
      {...props}
      className={cn(
        'border-border/70 bg-card dark:border-border/50 z-[44] flex flex-col overflow-hidden rounded-[1.6rem] border shadow-[0_28px_80px_-30px_rgba(15,23,42,0.6)]',
        className,
      )}
      style={
        isDesktop
          ? {
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(calc(100vw - 2rem), 52rem)',
              maxHeight: 'min(85vh, 56rem)',
            }
          : {
              left: '0.5rem',
              right: '0.5rem',
              // Sits above the bottom dock (which stays usable) and never under the status bar.
              bottom: 'calc(var(--dock-clearance) + 0.375rem)',
              height: phoneHeight,
            }
      }
    >
      <div data-sheet-grabber className="border-border/50 shrink-0 border-b px-4 pt-2 pb-3">
        {isDesktop ? null : <OverlayGrabber />}
        {header}
      </div>
      {children}
    </OverlayDialog>
  );
}
