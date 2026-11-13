'use client';

import { useRef, useState, type ReactNode } from 'react';
import { OverlayLink } from '@/components/overlay-link';
import { MoreHorizontal } from 'lucide-react';
import { OverlayMenu } from '@/components/ui/overlay-dialog';

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

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
        <OverlayMenu
          onClose={close}
          label="More"
          heading="More"
          closeLabel="Close more"
          className="holo-panel fixed top-[calc(var(--top-inset)+0.5rem)] right-[max(0.5rem,var(--right-inset))] max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] w-64 md:right-4"
        >
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
        </OverlayMenu>
      )}
    </div>
  );
}
