'use client';

import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import CardImage from '@/components/card-image';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';

// Keep this small viewer bundled with its opener so it also opens offline.
export default function CardImageZoom({
  src,
  alt,
  children,
  className,
  disabled = false,
}: {
  src: string;
  alt: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (disabled) return <div className={className}>{children}</div>;
  return (
    <>
      <button
        type="button"
        aria-label={`View ${alt} full screen`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`focus-visible:outline-primary cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 ${className ?? ''}`}
      >
        {children}
      </button>
      {open && <CardImageViewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function CardImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useOverlay(true, onClose, { containerRef: dialogRef });
  const swipe = useSwipeToDismiss(cardRef, onClose);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} full screen`}
      // Portal pointer events must not start a drag on the detail sheet underneath.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden text-white outline-none"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)',
      }}
    >
      <div data-overlay-backdrop aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/95" />
      <div
        ref={cardRef}
        className="pointer-events-none relative flex min-h-0 flex-1 flex-col items-center gap-2 px-4"
        {...swipe}
      >
        <div data-sheet-grabber className="pointer-events-auto flex w-full shrink-0 items-center justify-between gap-3">
          <p className="text-sm text-white/70">Swipe down to close</p>
          <button
            type="button"
            aria-label="Close full-screen card"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div
            className="pointer-events-auto relative aspect-[600/825] max-h-full"
            style={{
              width:
                'min(calc(100vw - 2rem), calc((100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 5rem) * 600 / 825))',
            }}
          >
            <CardImage
              src={src}
              alt={alt}
              fill
              sizes="100vw"
              draggable={false}
              className="object-contain select-none"
              onError={() => setFailed(true)}
            />
            {failed && (
              <p
                role="status"
                className="absolute inset-0 flex items-center justify-center bg-black p-6 text-center text-sm text-white/70"
              >
                This card image isn&apos;t available. Connect to the internet and try again.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
