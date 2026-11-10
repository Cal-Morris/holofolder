"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Archive, X } from "lucide-react"
import { runAfterOverlayHistory, useOverlay } from "@/hooks/use-overlay"
import { useActivityOpener } from "@/components/collection-activity-context"

export interface StorageMenuAction { label: string; disabled?: boolean; onSelect: () => void; /** Opens its own overlay via closeAllOverlays, like the binder switcher's Activity. */ immediate?: boolean }

/** Secondary storage actions, out of the way of the collection. An action runs after the menu has closed
 * and its history entry is gone, so the dialog it opens owns Back. */
export function StorageMenu({ actions, children, attention = false }: { actions: StorageMenuAction[]; children?: ReactNode; attention?: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<{ run: () => void } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const openActivity = useActivityOpener()
  const close = () => setOpen(false)
  useOverlay(open, close, { containerRef: menuRef })
  useEffect(() => {
    if (open || !pending) return
    runAfterOverlayHistory(pending.run)
    queueMicrotask(() => setPending(null))
  }, [open, pending])
  const items: StorageMenuAction[] = [...(openActivity ? [{ label: "Activity", immediate: true, onSelect: () => openActivity({}) }] : []), ...actions]
  return <div className="relative shrink-0">
    <button type="button" aria-label="Storage" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60">
      <Archive className="h-4 w-4" aria-hidden />
      {attention && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
    </button>
    {open && <>
      <div className="fixed inset-0 z-40" data-overlay-backdrop aria-hidden onClick={close} />
      <div ref={menuRef} role="dialog" aria-modal="true" aria-label="Storage" className="fixed right-[max(0.5rem,var(--right-inset))] top-[calc(var(--top-inset)+3.5rem)] z-50 flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-4rem)] w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-1.5 shadow-xl outline-none md:right-4">
        <div className="flex shrink-0 items-center justify-between pl-3">
          <p className="text-sm font-semibold">Storage</p>
          <button type="button" onClick={close} aria-label="Close storage" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain p-1 text-sm">
          {items.map(item => <button key={item.label} type="button" disabled={item.disabled} onClick={() => { if (item.immediate) { close(); item.onSelect(); return } setPending({ run: item.onSelect }); close() }}
            className="flex min-h-11 w-full items-center rounded-xl px-3 text-left font-medium hover:bg-muted/70 disabled:opacity-40">{item.label}</button>)}
          {children}
        </div>
      </div>
    </>}
  </div>
}
