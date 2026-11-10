"use client"

import CardPickerSheet, { cardPickerSheetChoice } from "@/components/card-picker-sheet"
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
 * chosen for the card in hand instead of up front.
 */
export default function CardPickerVariantSheet({ cardName, setName, actionLabel, choices, suggested, onChoose, onClose }: CardPickerVariantSheetProps) {
  return <CardPickerSheet title="Which variant?" subtitle={`${cardName} · ${setName}`} onClose={onClose}>
    <div className="grid gap-2">
      {choices.map((choice) => (
        <button
          key={choice.finish}
          type="button"
          onClick={() => onChoose(choice.finish)}
          data-suggested={choice.finish === suggested ? "true" : undefined}
          aria-label={`${actionLabel} ${choice.label}${choice.price ? `, ${choice.price}` : ""}`}
          className={cardPickerSheetChoice(choice.finish === suggested)}
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
  </CardPickerSheet>
}
