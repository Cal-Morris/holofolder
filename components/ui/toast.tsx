'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check } from 'lucide-react';

type Tone = 'success' | 'error';
type ToastAction = { label: string; onAction: () => void };
type Toast = { id: number; message: string; tone: Tone; action?: ToastAction };

let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Show a short confirmation above the dock. One at a time: a new toast replaces the last.
 *  An `action` (e.g. Undo) keeps it up longer, and it waits while hovered or focused. */
export function toast(message: string, options: Tone | { tone?: Tone; action?: ToastAction } = 'success') {
  const { tone = 'success', action } = typeof options === 'string' ? { tone: options } : options;
  current = { id: nextId++, message, tone, action };
  emit();
}

function dismiss(id: number) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const pill =
  'holo-panel border-border/60 bg-card text-foreground pointer-events-auto flex min-h-11 max-w-sm items-center gap-2 rounded-full border text-left text-sm font-medium shadow-xl transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none starting:translate-y-2 starting:opacity-0';

/** Marks a sheet's bottom action area (OverlayFooter, Show's deal check and bundle footers): toasts sit above it. */
export const TOAST_ANCHOR = { 'data-toast-anchor': '' } as const;

type Place = { host: HTMLDialogElement | null; top: number | null };

/**
 * Where a toast goes. A modal `<dialog>` is in the top layer and makes the page inert, so the toast renders inside the
 * topmost one. In that layer (or the page when none is open) it sits just above the last visible `[data-toast-anchor]`,
 * so a sheet that covers the dock keeps its action area clear; with no anchor it sits above the dock.
 */
function findPlace(): Place & { anchor: HTMLElement | null } {
  const host = [...document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal')).at(-1) ?? null;
  const anchor =
    [...(host ?? document).querySelectorAll<HTMLElement>('[data-toast-anchor]')]
      .filter((el) => el.getClientRects().length > 0)
      .at(-1) ?? null;
  return { host: host as HTMLDialogElement | null, anchor, top: anchor ? anchor.getBoundingClientRect().top : null };
}

/** Mounted once in the root layout. The live region stays mounted so screen readers announce each toast. */
export function Toaster() {
  const active = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  // An action toast waits while the pointer is on it or it holds focus.
  const held = useRef({ hover: false, focus: false });
  const timer = useRef<number | undefined>(undefined);
  const release = () => {
    window.clearTimeout(timer.current);
    if (!active || held.current.hover || held.current.focus) return;
    const ms = active.action ? 6000 : active.tone === 'error' ? 4500 : 2600;
    const id = active.id;
    timer.current = window.setTimeout(() => dismiss(id), ms);
  };
  const hold = (key: 'hover' | 'focus', on: boolean) => {
    held.current[key] = on;
    release();
  };

  useEffect(() => {
    held.current = { hover: false, focus: false };
    release();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when a new toast arrives
  }, [active]);

  // Follow the anchor while the toast is up: its height changes (keyboard, verdict) and the viewport resizes.
  const [place, setPlace] = useState<Place>({ host: null, top: null });
  useLayoutEffect(() => {
    if (!active) return;
    const { host, anchor } = findPlace();
    const measure = () => setPlace({ host, top: anchor?.isConnected ? anchor.getBoundingClientRect().top : null });
    measure();
    if (!anchor) return;
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [active]);

  const icon =
    active?.tone === 'error' ? (
      <AlertCircle className="text-destructive h-4 w-4 shrink-0" aria-hidden />
    ) : (
      <Check className="text-primary h-4 w-4 shrink-0" aria-hidden />
    );

  const region = (
    <div
      aria-live="polite"
      role="status"
      data-toaster
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-clearance)+0.75rem)] z-[70] flex justify-center px-4 md:bottom-6"
      style={place.top === null ? undefined : { top: place.top - 8, bottom: 'auto', translate: '0 -100%' }}
    >
      {active?.action ? (
        <div
          key={active.id}
          onPointerEnter={() => hold('hover', true)}
          onPointerLeave={() => hold('hover', false)}
          onFocus={() => hold('focus', true)}
          onBlur={() => hold('focus', false)}
          className={`${pill} py-1 pr-1.5 pl-4`}
        >
          {icon}
          <span className="min-w-0 flex-1">{active.message}</span>
          <button
            type="button"
            data-toast-action
            onClick={() => {
              dismiss(active.id);
              active.action?.onAction();
            }}
            className="text-primary hover:bg-muted min-h-9 shrink-0 rounded-full px-3 font-semibold"
          >
            {active.action.label}
          </button>
        </div>
      ) : (
        active && (
          <button key={active.id} type="button" onClick={() => dismiss(active.id)} className={`${pill} px-4 py-2.5`}>
            {icon}
            <span>{active.message}</span>
          </button>
        )
      )}
    </div>
  );
  return place.host?.isConnected ? createPortal(region, place.host) : region;
}
