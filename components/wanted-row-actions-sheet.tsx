"use client"

import { useRef } from "react"
import { createPortal } from "react-dom"
import { BookOpen, Check, Trash2 } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"

interface WantedRowActionsSheetProps {
  cardName: string
  detail: string
  readOnlyMode: boolean
  onGot: () => void
  onShowInBinder: (() => void) | null
  onRemove: () => void
  onClose: () => void
}

/** The small per-card menu on the want list, as a bottom sheet so every action is a 44px+ row. */
export default function WantedRowActionsSheet(props: WantedRowActionsSheetProps) {
  const { onClose } = props
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useOverlay(true, onClose, { containerRef: sheetRef })
  const swipe = useSwipeToDismiss(sheetRef, onClose)

  if (typeof document === "undefined") return null

  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  const rowClass = "flex min-h-12 w-full items-center gap-3 border-b border-border/50 px-4 text-left text-sm font-semibold last:border-b-0 active:bg-muted/60 dark:border-white/10"

  return createPortal(
    <div data-overlay-backdrop className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${props.cardName}`}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[1.6rem] border-t border-border/65 bg-card pb-[calc(var(--safe-bottom)+0.75rem)] pl-[calc(env(safe-area-inset-left)+1rem)] pr-[calc(env(safe-area-inset-right)+1rem)] pt-3 outline-none shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] sm:bottom-4 sm:rounded-[1.6rem] sm:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div data-sheet-grabber className="-mx-4 -mt-3 px-4 pt-3" {...swipe}>
          <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <p className="truncate text-sm font-semibold">{props.cardName}</p>
          <p className="mb-3 truncate text-xs text-muted-foreground">{props.detail}</p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border/60 dark:border-white/10">
          {props.readOnlyMode ? null : (
            <button type="button" onClick={run(props.onGot)} className={`${rowClass} text-emerald-700 dark:text-emerald-300`}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Got it, move to my binder
            </button>
          )}
          {props.onShowInBinder ? (
            <button type="button" onClick={run(props.onShowInBinder)} className={rowClass}>
              <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Show in binder
            </button>
          ) : null}
          {props.readOnlyMode ? null : (
            <button type="button" onClick={run(props.onRemove)} className={`${rowClass} text-destructive`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Remove from want list
            </button>
          )}
        </div>
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-2xl border border-border/60 text-sm font-semibold text-muted-foreground dark:border-white/10">
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
