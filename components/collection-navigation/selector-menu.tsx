"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { Check, ChevronDown, Plus, X } from "lucide-react"
import { useOverlay } from "@/hooks/use-overlay"
import { useMenuAction } from "@/components/collection-navigation/storage-menu"

export interface SelectorOption { value: string; label: string }

/** An enclosed selector: a bordered trigger showing the current value and a chevron, opening a bounded
 * single-choice menu on the shared overlay primitive. `onSelect` runs after the menu and its history entry are gone. */
export function SelectorMenu({ label, heading, menuLabel, value, valueLabel, options, onSelect, action, width, className = "", textClassName = "" }: {
  /** One extra entry under the choices, for making a new one of the things listed (e.g. New binder). */
  action?: { label: string; hint?: string; disabled?: boolean; onSelect: () => void }
  /** Accessible name of the trigger. */
  label: string
  /** Visible menu heading. */
  heading: string
  menuLabel: string
  value: string
  valueLabel: string
  options: SelectorOption[]
  onSelect: (value: string) => void
  /** Menu width in px, capped to the viewport. */
  width: number
  className?: string
  textClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState({ left: 8, top: 0 })
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const textId = useId()
  const defer = useMenuAction(open)
  const close = () => setOpen(false)
  useOverlay(open, close, { containerRef: menuRef })
  useEffect(() => {
    if (!open) return
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    ;(Array.from(items ?? []).find(item => item.getAttribute("aria-checked") === "true") ?? items?.[0])?.focus({ preventScroll: false })
  }, [open])
  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setAnchor({ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(width, window.innerWidth - 16) - 8)), top: rect.bottom + 6 })
    setOpen(current => !current)
  }
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    items[next]?.focus()
  }
  return <div className={`relative ${className}`}>
    <button ref={triggerRef} type="button" aria-label={label} aria-describedby={textId} aria-haspopup="dialog" aria-expanded={open} data-value={value}
      disabled={options.length === 0 && !action} onClick={show}
      className={`flex h-9 w-full min-w-0 items-center gap-1 rounded-lg border border-border bg-muted/50 pl-2.5 pr-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60 ${textClassName}`}>
      <span id={textId} className="min-w-0 flex-1 truncate">{valueLabel}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
    {open && <>
      <div className="fixed inset-0 z-40" data-overlay-backdrop aria-hidden onClick={close} />
      <div ref={menuRef} role="dialog" aria-modal="true" aria-label={menuLabel} style={{ left: anchor.left, top: anchor.top, width, maxHeight: `calc(100dvh - ${anchor.top}px - var(--dock-clearance) - 0.5rem)` }}
        className="fixed z-50 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-1.5 shadow-xl outline-none">
        <div className="flex shrink-0 items-center justify-between pl-3">
          <p className="text-sm font-semibold">{heading}</p>
          <button type="button" onClick={close} aria-label={`Close ${heading.toLowerCase()}`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div role="menu" aria-label={menuLabel} onKeyDown={move} className="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1 text-sm">
          {options.map(option => {
            const selected = option.value === value
            return <button key={option.value} type="button" role="menuitemradio" aria-checked={selected} data-value={option.value} onClick={() => { defer(() => onSelect(option.value)); close() }}
              className={`flex min-h-11 w-full shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left leading-snug hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none ${selected ? "bg-muted font-semibold" : "font-medium"}`}>
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
            </button>
          })}
        </div>
        {action && <div className="shrink-0 border-t border-border/60 p-1 pt-1.5">
          <button type="button" disabled={action.disabled} onClick={() => { defer(action.onSelect); close() }}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none disabled:opacity-45">
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block">{action.label}</span>{action.hint && <span className="block text-xs font-normal text-muted-foreground">{action.hint}</span>}</span>
          </button>
        </div>}
      </div>
    </>}
  </div>
}
