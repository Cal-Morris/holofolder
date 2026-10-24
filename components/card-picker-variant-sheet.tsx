"use client"

import { useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import type { CardPickerStandardFinish } from "@/lib/card-picker-filters"

interface CardPickerVariantSheetProps {
  cardName: string
  setName: string
  /** "Add" or "Want": what picking does. */
  actionLabel: string
  choices: Array<{ finish: CardPickerStandardFinish; label: string; price: string | null }>
  suggested: CardPickerStandardFinish | null
  onChoose: (finish: CardPickerStandardFinish) => void
  onClose: () => void
}

/**
 * Asked after a card is tapped, only when its printing comes in more than one finish, so the variant is
 * chosen for the card in hand instead of up front. Built on the shared overlay primitive.
 */
export default function CardPickerVariantSheet({ cardName, setName, actionLabel, choices, suggested, onChoose, onClose }: CardPickerVariantSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useOverlay(true, onClose, { containerRef: sheetRef })
  const swipe = useSwipeToDismiss(sheetRef, onClose)

  if (typeof document === "undefined") return null

  return createPortal(
    <div data-overlay-backdrop className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Which variant?"
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[1.6rem] border-t border-border/65 bg-card px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-3 outline-none shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] sm:bottom-4 sm:rounded-[1.6rem] sm:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div data-sheet-grabber className="-mx-4 -mt-3 px-4 pt-3" {...swipe}>
          <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Which variant?</p>
              <p className="truncate text-xs text-muted-foreground">{cardName} · {setName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to cards"
              className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid gap-2">
          {choices.map((choice) => (
            <button
              key={choice.finish}
              type="button"
              onClick={() => onChoose(choice.finish)}
              data-suggested={choice.finish === suggested ? "true" : undefined}
              aria-label={`${actionLabel} ${choice.label}${choice.price ? `, ${choice.price}` : ""}`}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left text-sm font-semibold transition-colors ${
                choice.finish === suggested
                  ? "border-primary/45 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/70 text-foreground hover:bg-muted/60"
              }`}
            >
              <span className="flex items-center gap-2">
                {choice.label}
                {choice.finish === suggested && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-primary">Likely</span>
                )}
              </span>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{choice.price ?? "No price yet"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
