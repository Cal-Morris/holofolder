"use client"

import { useRef, useState, type ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import { useOverlay } from "@/hooks/use-overlay"

export type HeaderMoreItem = {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
}

/** The phone header's single overflow menu: one 44px button instead of a row of small icons. */
export function HeaderMoreMenu({ items }: { items: HeaderMoreItem[] }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  useOverlay(open, close, { containerRef: menuRef, lockScroll: false, history: false })

  return (
    <div className="relative md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted/70"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" data-overlay-backdrop aria-hidden onClick={close} />
          <div
            ref={menuRef}
            role="menu"
            aria-label="More"
            className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 overflow-hidden rounded-2xl border border-border/60 bg-card/97 p-1.5 shadow-[0_18px_44px_-24px_rgba(15,23,42,0.34)] backdrop-blur-xl outline-none dark:border-border/45 dark:bg-background/97"
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close()
                  // Whatever opens next should hand focus back to the More button, not the vanished row.
                  buttonRef.current?.focus()
                  item.onSelect()
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-foreground hover:bg-muted/70 disabled:opacity-40"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
