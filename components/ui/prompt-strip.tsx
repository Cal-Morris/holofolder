import type { ReactNode } from 'react';

/** The slim strip under the app header for an optional prompt: a short message, then its actions. */
export function PromptStrip({ label, message, children }: { label: string; message: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="border-border bg-muted/50 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs"
    >
      <p className="min-w-0 flex-1">{message}</p>
      {children}
    </section>
  );
}
