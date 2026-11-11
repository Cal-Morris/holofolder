'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useOpenOverlayCount } from '@/hooks/use-overlay';

const BOTTOM_VAR = '--top-banner-bottom';

/**
 * The shared spot at the top of the screen for transient status pills (offline mode,
 * pending sync, …). It
 * - publishes where it ends (`--top-banner-bottom`, px from the top of the viewport, incl. a
 *   small gap) on <html> so sheets can stay below it, and
 * - while any overlay is open, sits just above the header (z-41) but below every overlay
 *   layer except the card-detail sheet (z-40), which keeps itself below the banner via
 *   `--top-banner-bottom`; so it never covers an overlay's own controls (e.g. close buttons).
 * Render at most one banner at a time in this slot.
 */
export function TopBannerSlot({
  children,
  topClassName = 'top-[calc(var(--top-inset)+0.25rem)]',
}: {
  children: ReactNode;
  topClassName?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const overlayOpen = useOpenOverlayCount() > 0;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof document === 'undefined') return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(BOTTOM_VAR, `${Math.ceil(element.getBoundingClientRect().bottom + 6)}px`);
    };
    publish();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(BOTTOM_VAR);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-top-banner-slot
      data-overlay-open={overlayOpen ? '' : undefined}
      className={`pointer-events-none fixed inset-x-0 ${topClassName} flex justify-center px-3 ${overlayOpen ? 'z-[41]' : 'z-50'}`}
    >
      {children}
    </div>
  );
}
