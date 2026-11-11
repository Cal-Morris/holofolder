'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { AlertCircle, Check } from 'lucide-react';

type Toast = { id: number; message: string; tone: 'success' | 'error' };

let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Show a short confirmation above the dock. One at a time: a new toast replaces the last. */
export function toast(message: string, tone: Toast['tone'] = 'success') {
  current = { id: nextId++, message, tone };
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

/** Mounted once in the root layout. The live region stays mounted so screen readers announce each toast. */
export function Toaster() {
  const active = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => dismiss(active.id), active.tone === 'error' ? 4500 : 2600);
    return () => window.clearTimeout(timer);
  }, [active]);

  return (
    <div
      aria-live="polite"
      role="status"
      data-toaster
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-clearance)+0.75rem)] z-[70] flex justify-center px-4 md:bottom-6"
    >
      {active && (
        <button
          key={active.id}
          type="button"
          onClick={() => dismiss(active.id)}
          className="holo-panel border-border/60 bg-card text-foreground pointer-events-auto flex min-h-11 max-w-sm items-center gap-2 rounded-full border px-4 py-2.5 text-left text-sm font-medium shadow-xl transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none starting:translate-y-2 starting:opacity-0"
        >
          {active.tone === 'error' ? (
            <AlertCircle className="text-destructive h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Check className="text-primary h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{active.message}</span>
        </button>
      )}
    </div>
  );
}
