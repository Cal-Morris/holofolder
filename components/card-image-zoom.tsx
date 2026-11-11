'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import CardImage from '@/components/card-image';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { cardTilt } from '@/lib/card-tilt';

const TILT_RESET = 'transform 500ms cubic-bezier(0.22, 1, 0.36, 1)';

/** Tilt the card towards the pointer or finger and move the shine with it (skipped for reduced motion). */
function tiltCard(event: ReactPointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const tilt = cardTilt(event.clientX, event.clientY, card.getBoundingClientRect());
  card.style.transition = 'none';
  card.style.setProperty('--card-rx', `${tilt.rotateX}deg`);
  card.style.setProperty('--card-ry', `${tilt.rotateY}deg`);
  card.style.setProperty('--card-sx', `${tilt.shineX}%`);
  card.style.setProperty('--card-sy', `${tilt.shineY}%`);
  card.style.setProperty('--card-shine', '1');
}

function resetCardTilt(event: ReactPointerEvent<HTMLElement>) {
  const card = event.currentTarget;
  card.style.transition = TILT_RESET;
  for (const name of ['--card-rx', '--card-ry', '--card-sx', '--card-sy', '--card-shine'])
    card.style.removeProperty(name);
}

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
            onPointerMove={tiltCard}
            onPointerLeave={resetCardTilt}
            onPointerUp={resetCardTilt}
            onPointerCancel={resetCardTilt}
            style={{
              width:
                'min(calc(100vw - 2rem), calc((100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 5rem) * 600 / 825))',
              transform: 'perspective(1000px) rotateX(var(--card-rx, 0deg)) rotateY(var(--card-ry, 0deg))',
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
            {/* Card corners are transparent in the image, so the shine is clipped to a card-shaped radius. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[4.5%/3.3%] transition-opacity duration-300"
              style={{
                opacity: 'var(--card-shine, 0)',
                background:
                  'radial-gradient(circle at var(--card-sx, 50%) var(--card-sy, 50%), rgb(255 255 255 / 0.35), rgb(255 255 255 / 0.08) 35%, transparent 65%)',
              }}
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
