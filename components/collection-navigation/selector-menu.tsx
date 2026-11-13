'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { useOverlay } from '@/hooks/use-overlay';
import { useMenuAction } from '@/components/collection-navigation/storage-menu';

export interface SelectorOption {
  value: string;
  label: string;
}

/** Arrow, Home and End keys move focus between the menu's options. */
function move(event: KeyboardEvent<HTMLDivElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'ArrowDown'
      ? (at + 1) % items.length
      : event.key === 'ArrowUp'
        ? (at - 1 + items.length) % items.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : -1;
  if (next < 0) return;
  event.preventDefault();
  items[next]?.focus();
}

/** An enclosed selector: a bordered trigger showing the current value and a chevron, opening a bounded
 * single-choice menu on the shared overlay primitive. `onSelect` runs after the menu and its history entry are gone. */
export function SelectorMenu({
  label,
  heading,
  menuLabel,
  value,
  valueLabel,
  options,
  onSelect,
  action,
  width,
  icon,
  className = '',
  textClassName = '',
}: {
  /** One extra entry under the choices, for making a new one of the things listed (e.g. New binder). */
  action?: { label: string; hint?: string; disabled?: boolean; onSelect: () => void };
  /** Accessible name of the trigger. */
  label: string;
  /** Visible menu heading. */
  heading: string;
  menuLabel: string;
  value: string;
  valueLabel: string;
  options: SelectorOption[];
  onSelect: (value: string) => void;
  /** Icon-only trigger (like the toolbar's icon buttons); the value label stays for screen readers. */
  icon?: ReactNode;
  /** Menu width in px, capped to the viewport. */
  width: number;
  className?: string;
  textClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ left: 8, top: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textId = useId();
  const defer = useMenuAction(open);
  const close = () => setOpen(false);
  useOverlay(open, close, { containerRef: menuRef });
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    (Array.from(items ?? []).find((item) => item.getAttribute('aria-checked') === 'true') ?? items?.[0])?.focus({
      preventScroll: false,
    });
  }, [open]);
  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect)
      setAnchor({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(width, window.innerWidth - 16) - 8)),
        top: rect.bottom + 6,
      });
    setOpen((current) => !current);
  };
  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={textId}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-value={value}
        disabled={options.length === 0 && !action}
        onClick={show}
        className={
          icon
            ? 'text-muted-foreground hover:bg-muted/60 focus-visible:ring-ring/60 relative flex h-9 w-9 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60'
            : `border-border bg-muted/50 hover:bg-muted focus-visible:ring-ring/60 flex h-9 w-full min-w-0 items-center gap-1 rounded-lg border pr-1.5 pl-2.5 text-left focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60 ${textClassName}`
        }
      >
        {icon}
        <span id={textId} className={icon ? 'sr-only' : 'min-w-0 flex-1 truncate'}>
          {valueLabel}
        </span>
        {!icon && <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" data-overlay-backdrop aria-hidden onClick={close} />
          <div
            ref={menuRef}
            role="dialog"
            aria-modal="true"
            aria-label={menuLabel}
            style={{
              left: anchor.left,
              top: anchor.top,
              width,
              maxHeight: `calc(100dvh - ${anchor.top}px - var(--dock-clearance) - 0.5rem)`,
            }}
            className="border-border/60 bg-card fixed z-50 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border p-1.5 shadow-xl outline-none"
          >
            <div className="flex shrink-0 items-center justify-between pl-3">
              <p className="text-sm font-semibold">{heading}</p>
              <button
                type="button"
                onClick={close}
                aria-label={`Close ${heading.toLowerCase()}`}
                className="hover:bg-muted flex h-9 w-9 items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div
              role="menu"
              aria-label={menuLabel}
              tabIndex={-1}
              onKeyDown={move}
              className="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1 text-sm"
            >
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-value={option.value}
                    onClick={() => {
                      defer(() => onSelect(option.value));
                      close();
                    }}
                    className={`hover:bg-muted/70 focus-visible:bg-muted/70 flex min-h-11 w-full shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left leading-snug focus-visible:outline-none ${selected ? 'bg-muted font-semibold' : 'font-medium'}`}
                  >
                    <span className="min-w-0 flex-1 break-words">{option.label}</span>
                    {selected && <Check className="text-primary h-4 w-4 shrink-0" aria-hidden />}
                  </button>
                );
              })}
            </div>
            {action && (
              <div className="border-border/60 shrink-0 border-t p-1 pt-1.5">
                <button
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    defer(action.onSelect);
                    close();
                  }}
                  className="text-primary hover:bg-primary/10 focus-visible:bg-primary/10 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold focus-visible:outline-none disabled:opacity-45"
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block">{action.label}</span>
                    {action.hint && (
                      <span className="text-muted-foreground block text-xs font-normal">{action.hint}</span>
                    )}
                  </span>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
