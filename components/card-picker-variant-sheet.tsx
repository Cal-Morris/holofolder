'use client';

import CardPickerSheet, { cardPickerSheetChoice } from '@/components/card-picker-sheet';
import CardImage from '@/components/card-image';
import type { CardPickerStandardFinish } from '@/lib/card-picker-filters';

interface CardPickerVariantSheetProps {
  cardName: string;
  setName: string;
  /** The tapped printing's artwork, so the finish is chosen with the card in view. */
  image?: string;
  /** "Add" or "Want": what picking does. */
  actionLabel: string;
  choices: Array<{ finish: CardPickerStandardFinish; label: string; price: string | null }>;
  suggested: CardPickerStandardFinish | null;
  onChoose: (finish: CardPickerStandardFinish) => void;
  onClose: () => void;
}

/**
 * Asked after a card is tapped, only when its printing comes in more than one finish, so the variant is
 * chosen for the card in hand instead of up front.
 */
export default function CardPickerVariantSheet({
  cardName,
  setName,
  image,
  actionLabel,
  choices,
  suggested,
  onChoose,
  onClose,
}: CardPickerVariantSheetProps) {
  return (
    <CardPickerSheet title="Which variant?" subtitle={`${cardName} · ${setName}`} onClose={onClose}>
      {image && (
        <div className="trading-card border-border/60 bg-muted relative mx-auto mb-3 w-40 shrink-0 overflow-hidden rounded-xl border">
          <CardImage src={image} alt={`${cardName}, ${setName}`} fill sizes="160px" className="object-cover" />
        </div>
      )}
      <div className="grid gap-2">
        {choices.map((choice) => (
          <button
            key={choice.finish}
            type="button"
            onClick={() => onChoose(choice.finish)}
            data-suggested={choice.finish === suggested ? 'true' : undefined}
            aria-label={`${actionLabel} ${choice.label}${choice.price ? `, ${choice.price}` : ''}`}
            className={cardPickerSheetChoice(choice.finish === suggested)}
          >
            <span className="flex items-center gap-2">
              {choice.label}
              {choice.finish === suggested && (
                <span className="bg-primary/15 text-primary rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] uppercase">
                  Likely
                </span>
              )}
            </span>
            <span className="text-muted-foreground text-xs font-medium tabular-nums">
              {choice.price ?? 'No price yet'}
            </span>
          </button>
        ))}
      </div>
    </CardPickerSheet>
  );
}
