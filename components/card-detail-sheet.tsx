'use client';

import type { ComponentProps, ReactNode } from 'react';
import { OverlayDialog, OverlayGrabber } from '@/components/ui/overlay-dialog';
import { cn } from '@/lib/utils';

/**
 * A card's details sheet (a binder pocket's or an inventory copy's): non-modal above the dock, which stays usable, in
 * a z-40 layer over a blurred backdrop, rendered in place. `header` (the art, name and X) drags the sheet; the body
 * follows as `children`.
 */
export default function CardDetailSheet({
  header,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof OverlayDialog>, 'children'> & { header: ReactNode; children: ReactNode }) {
  return (
    <OverlayDialog
      modal={false}
      portal={false}
      layerClassName="z-40"
      backdropProps={{ className: 'bg-black/45 backdrop-blur-[2px]' }}
      {...props}
      className={cn(
        'holo-panel border-border/70 bg-card/96 text-foreground absolute inset-x-2 bottom-[calc(var(--dock-clearance)+0.375rem)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-md flex-col overflow-hidden rounded-[1.35rem] border p-3 backdrop-blur-xl sm:rounded-[1.6rem] md:bottom-4',
        className,
      )}
    >
      <div data-sheet-grabber className="shrink-0">
        <OverlayGrabber className="-mt-1 sm:hidden" />
        {header}
      </div>
      {children}
    </OverlayDialog>
  );
}
