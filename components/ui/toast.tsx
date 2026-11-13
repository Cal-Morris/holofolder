'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
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

  const icon =
    active?.tone === 'error' ? (
      <AlertCircle className="text-destructive h-4 w-4 shrink-0" aria-hidden />
    ) : (
      <Check className="text-primary h-4 w-4 shrink-0" aria-hidden />
    );

  return (
    <div
      aria-live="polite"
      role="status"
      data-toaster
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-clearance)+0.75rem)] z-[70] flex justify-center px-4 md:bottom-6"
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
}
