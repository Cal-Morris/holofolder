"use client"

import { useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"

/** In-app confirm for big runs (engine asks at CHECK_COMPS_CONFIRM_AT+). Matches owned-remove sheet chrome. */
export default function CheckCompsConfirm({
  cardsNeedingSoldcomps,
  onConfirm,
  onCancel,
}: {
  cardsNeedingSoldcomps: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useOverlay(true, onCancel, { containerRef: sheetRef })

  const swipe = useSwipeToDismiss(sheetRef, onCancel)

  if (typeof document === "undefined") return null

  const n = cardsNeedingSoldcomps
  const title = `${n} card${n === 1 ? "" : "s"} need a sold comps refresh. Check them now?`

  return createPortal(
    <div
      data-overlay-backdrop
      data-testid="check-comps-confirm-backdrop"
      className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-comps-confirm-title"
        data-testid="check-comps-confirm"
        className="absolute inset-x-0 bottom-[var(--dock-clearance)] mx-auto w-full max-w-md rounded-t-[1.6rem] border-t border-border/65 bg-card/97 px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-3 outline-none shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] max-h-[calc(100dvh-var(--dock-clearance)-var(--safe-top)-1rem)] overflow-y-auto sm:bottom-4 sm:rounded-[1.6rem] sm:border sm:pb-4 dark:border-border/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div {...swipe} className="flex items-center justify-between pb-2">
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          <button type="button" aria-label="Close price check confirmation" onClick={onCancel} className="flex h-9 w-9 items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        <p id="check-comps-confirm-title" className="mb-4 text-sm font-semibold leading-snug">
          {title}
        </p>
        <p className="mb-4 text-xs text-muted-foreground">Up to {n} sold comps lookups use the provider allowance. eBay asking prices are checked too. Checks under 12 hours old are reused.</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            Check now
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-border/60 px-3 text-sm font-semibold text-muted-foreground dark:border-white/10"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

