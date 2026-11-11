'use client';

import { useRef, useState, type ReactNode } from 'react';
import { OverlayLink } from '@/components/overlay-link';
import { MoreHorizontal, X } from 'lucide-react';
import { useOverlay } from '@/hooks/use-overlay';

export type HeaderMoreItem = {
  id: string;
  label: string;
  icon: ReactNode;
} & ({ href: string; onSelect?: never; disabled?: never } | { href?: never; onSelect: () => void; disabled?: boolean });

export function HeaderMoreMenu({
  items,
  compact = false,
}: {
  items: HeaderMoreItem[];
  /** 36px wide on phones, where the header is short of room. */ compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useOverlay(open, close, { containerRef: menuRef });

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="More"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`text-foreground hover:bg-muted/70 flex h-11 items-center justify-center rounded-xl ${compact ? 'w-9 md:w-11' : 'w-11'}`}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" data-overlay-backdrop aria-hidden onClick={close} />
          <div
            ref={menuRef}
            role="dialog"
            aria-modal="true"
            aria-label="More"
            className="holo-panel border-border/60 bg-card fixed top-[calc(var(--top-inset)+0.5rem)] right-[max(0.5rem,var(--right-inset))] z-50 flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] w-64 flex-col overflow-hidden rounded-2xl border p-1.5 shadow-xl outline-none md:right-4"
          >
            <div className="flex shrink-0 items-center justify-between pl-3">
              <p className="text-sm font-semibold">More</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close more"
                className="hover:bg-muted flex h-9 w-9 items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div role="menu" aria-label="More" className="min-h-0 overflow-y-auto overscroll-contain">
              {items.map((item) =>
                item.href ? (
                  <OverlayLink
                    key={item.id}
                    role="menuitem"
                    href={item.href}
                    onClose={close}
                    className="hover:bg-muted/70 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium"
                  >
                    <span
                      className="text-muted-foreground flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4"
                      aria-hidden
                    >
                      {item.icon}
                    </span>
                    {item.label}
                  </OverlayLink>
                ) : (
                  <button
                    key={item.id}
                    role="menuitem"
                    type="button"
                    disabled={item.disabled}
                    onClick={() => {
                      close();
                      buttonRef.current?.focus();
                      item.onSelect?.();
                    }}
                    className="hover:bg-muted/70 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium disabled:opacity-40"
                  >
                    <span
                      className="text-muted-foreground flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4"
                      aria-hidden
                    >
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                ),
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
