'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { EllipsisVertical, History, type LucideIcon } from 'lucide-react';
import { runAfterOverlayHistory } from '@/hooks/use-overlay';
import { OverlayMenu } from '@/components/ui/overlay-dialog';
import { useActivityOpener } from '@/components/collection-activity-context';

export interface StorageMenuAction {
  label: string;
  icon?: LucideIcon;
  /** Starts a new group: a divider is drawn above it. */
  separated?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** Returns a function that queues an action, then runs it once the menu is closed and its history entry is gone. */
export function useMenuAction(open: boolean) {
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  useEffect(() => {
    if (open || !pending) return;
    runAfterOverlayHistory(pending.run);
    queueMicrotask(() => setPending(null));
  }, [open, pending]);
  return (run: () => void) => setPending({ run });
}

/** Secondary storage actions, out of the way of the collection. An action runs after the menu has closed
 * and its history entry is gone, so the dialog it opens owns Back. */
export function StorageMenu({
  actions,
  children,
  attention = false,
}: {
  actions: StorageMenuAction[];
  children?: ReactNode;
  attention?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const openActivity = useActivityOpener();
  const close = () => setOpen(false);
  const defer = useMenuAction(open);
  const items: StorageMenuAction[] = [
    ...(openActivity ? [{ label: 'Activity', icon: History, onSelect: () => openActivity({}) }] : []),
    ...actions,
  ];
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Storage"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="text-muted-foreground hover:bg-muted/60 relative flex h-9 w-9 items-center justify-center rounded-lg"
      >
        <EllipsisVertical className="h-4 w-4" aria-hidden />
        {attention && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
      </button>
      {open && (
        <OverlayMenu
          onClose={close}
          label="Storage"
          heading="Options"
          headingClassName="text-muted-foreground text-xs font-medium"
          closeLabel="Close storage"
          className="fixed top-[calc(var(--top-inset)+3.5rem)] right-[max(0.5rem,var(--right-inset))] max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-4rem)] w-72 max-w-[calc(100vw-1rem)] md:right-4"
        >
          <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain px-1 pb-1 text-sm">
            {items.map(({ label, icon: Icon, separated, danger, disabled, onSelect }, index) => (
              <div key={label} className={separated && index > 0 ? 'border-border/60 mt-1 border-t pt-1' : undefined}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    defer(onSelect);
                    close();
                  }}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left disabled:opacity-40 ${danger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted/70'}`}
                >
                  {Icon && <Icon className={`h-4 w-4 shrink-0 ${danger ? '' : 'text-muted-foreground'}`} aria-hidden />}
                  {label}
                </button>
              </div>
            ))}
            {children}
          </div>
        </OverlayMenu>
      )}
    </div>
  );
}
