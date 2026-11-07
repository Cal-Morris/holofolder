"use client"

import { useRef, useState, type ReactNode } from "react"
import { MoreHorizontal, X } from "lucide-react"
import { useOverlay } from "@/hooks/use-overlay"

export type HeaderMoreItem = {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  keepOpen?: boolean
}

export function HeaderMoreMenu({ items, message }: { items: HeaderMoreItem[]; message?: string | null }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  useOverlay(open, close, { containerRef: menuRef })

  return (
    <div className="relative shrink-0">
      <button ref={buttonRef} type="button" aria-label="More" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)} className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-muted/70">
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && <>
        <div className="fixed inset-0 z-40" data-overlay-backdrop aria-hidden onClick={close} />
        <div ref={menuRef} role="dialog" aria-modal="true" aria-label="More" className="fixed right-[max(0.5rem,var(--right-inset))] top-[calc(var(--top-inset)+0.5rem)] z-50 flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] w-64 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-1.5 shadow-xl outline-none md:right-4">
          <div className="flex shrink-0 items-center justify-between pl-3">
            <p className="text-sm font-semibold">More</p>
            <button type="button" onClick={close} aria-label="Close more" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <div role="menu" aria-label="More" className="min-h-0 overflow-y-auto overscroll-contain">
            {items.map(item => <button key={item.id} role="menuitem" type="button" disabled={item.disabled} onClick={() => {
              if (!item.keepOpen) {
                close()
                buttonRef.current?.focus()
              }
              item.onSelect()
            }} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-muted/70 disabled:opacity-40">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{item.icon}</span>
              {item.label}
            </button>)}
            {message && <p role="status" className="px-3 py-2 text-xs text-primary">{message}</p>}
          </div>
        </div>
      </>}
    </div>
  )
}
