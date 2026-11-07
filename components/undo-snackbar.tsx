"use client"

import { useEffect, useEffectEvent } from "react"
import { X } from "lucide-react"

export interface UndoAction {
  message: string
  run: () => Promise<void>
}

interface UndoSnackbarProps {
  message: string
  onUndo: () => void
  onDismiss: () => void
  /** Auto-dismiss delay; the undo stays available until then. */
  placement?: "top" | "bottom"
  busy?: boolean
  durationMs?: number
}

/** A small, non-modal snackbar above the dock with an Undo action. */
export default function UndoSnackbar({ message, onUndo, onDismiss, placement = "bottom", busy = false, durationMs = 10_000 }: UndoSnackbarProps) {
  const dismiss = useEffectEvent(onDismiss)
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(), durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, message])

  return (
    <div className={`pointer-events-none fixed inset-x-0 ${placement === "top" ? "top-[calc(var(--top-inset,0px)+3.5rem)]" : "bottom-[calc(var(--dock-clearance,1rem)+0.5rem)]"} z-[60] flex justify-center px-3`}>
      <div
        role="status"
        aria-live="polite"
        data-testid="undo-snackbar"
        className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-border/70 bg-foreground py-1 pl-3.5 pr-1 text-background shadow-[0_18px_44px_-20px_rgba(15,23,42,0.6)]"
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{message}</span>
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          className="h-11 min-w-14 shrink-0 rounded-xl px-3 text-xs font-bold uppercase tracking-wide text-sky-300 hover:bg-background/10 dark:text-sky-700"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss undo"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl opacity-70 hover:bg-background/10 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
