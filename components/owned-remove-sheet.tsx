"use client"

import { useRef } from "react"
import { createPortal } from "react-dom"
import { Heart, Trash2, X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import type { OwnedRemovalMode } from "@/lib/collection/owned-removal"

interface OwnedRemoveSheetProps {
  pokemonName: string
  /** Name of the owned printing, when the slot has one. */
  cardName?: string
  onChoose: (mode: OwnedRemovalMode) => void
  onClose: () => void
}

/**
 * Confirm sheet for removing an owned card. "Move back to Wanted" is the primary choice; "Remove completely"
 * is secondary. Built on the shared overlay primitive (Escape/back closes it, focus is trapped and returned).
 */
export default function OwnedRemoveSheet({ pokemonName, cardName, onChoose, onClose }: OwnedRemoveSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useOverlay(true, onClose, { containerRef: sheetRef })
  const swipe = useSwipeToDismiss(sheetRef, onClose)

  if (typeof document === "undefined") return null

  return createPortal(
    <div data-overlay-backdrop className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Remove ${pokemonName}`}
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[1.6rem] border-t border-border/65 bg-card/97 px-4 pb-[calc(var(--dock-clearance)+0.75rem)] pt-3 outline-none shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] sm:bottom-4 sm:rounded-[1.6rem] sm:border sm:pb-4 dark:border-border/50 dark:bg-background/97"
        onClick={(event) => event.stopPropagation()}
      >
        <div data-sheet-grabber className="-mx-4 -mt-3 px-4 pt-3" {...swipe}>
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold capitalize">Remove {pokemonName}?</p>
              <p className="truncate text-xs text-muted-foreground">
                {cardName ? `${cardName} is marked as owned.` : "This slot is marked as owned."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cancel"
              className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onChoose("to-wanted")}
            className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/12 px-3 py-2 text-left text-amber-700 hover:bg-amber-500/18 dark:text-amber-200"
          >
            <Heart className="h-4 w-4 shrink-0 fill-current" />
            <span className="min-w-0">
              <span className="block text-sm font-bold">Move back to Wanted</span>
              <span className="block text-[11px] font-medium opacity-80">
                {cardName ? "Not owned any more; the card goes back on your wanted list." : "Not owned any more; the slot stays on your wanted list."}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onChoose("remove")}
            className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-destructive/25 bg-destructive/8 px-3 py-2 text-left text-destructive hover:bg-destructive/12"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Remove completely</span>
              <span className="block text-[11px] font-medium opacity-80">Clears the slot, including its wanted cards.</span>
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
