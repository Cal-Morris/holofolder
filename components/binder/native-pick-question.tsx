'use client';

import { useState } from 'react';
import CardPickerSheet, { cardPickerSheetChoice } from '@/components/card-picker-sheet';
import type { useNativeSlotPick } from '@/hooks/use-native-slot-pick';

type Question = NonNullable<ReturnType<typeof useNativeSlotPick>['question']>;

/** The one follow-up a pick can need, in the picker's own sheet: which copy, whether it is a wanted card, or a failed save. */
export default function NativePickQuestion({ question, onClose }: { question: Question; onClose: () => void }) {
  const { card, plan, failed, retry, choose } = question;
  const [want, setWant] = useState<number | null>(null);
  const subtitle = `${card.name} · ${card.set.name}`;
  if (failed)
    return (
      <CardPickerSheet title="Couldn't add this card" subtitle={subtitle} onClose={onClose}>
        <p role="alert" className="text-muted-foreground mb-3 text-sm [overflow-wrap:anywhere] break-words">
          {failed}
        </p>
        <div className="grid gap-2">
          {retry && (
            <button type="button" className={cardPickerSheetChoice(true)} onClick={retry}>
              Try again
            </button>
          )}
          <button type="button" className={cardPickerSheetChoice()} onClick={onClose}>
            Back to cards
          </button>
        </div>
      </CardPickerSheet>
    );
  const graded = plan.choices.length > 0;
  return (
    <CardPickerSheet title={graded ? 'Which copy?' : 'Is this a wanted card?'} subtitle={subtitle} onClose={onClose}>
      {plan.wants.length > 0 && (
        <div className="mb-3 grid gap-2" role="group" aria-label="Wanted card">
          {plan.wants.map(({ index, name }) => (
            <button
              key={index}
              type="button"
              aria-pressed={want === index}
              className={cardPickerSheetChoice(want === index)}
              onClick={() => setWant(want === index ? null : index)}
            >
              <span className="min-w-0 [overflow-wrap:anywhere] break-words">
                Found my wanted {name}
                {plan.wants.length > 1 ? ` (${plan.wants.findIndex((w) => w.index === index) + 1})` : ''}
              </span>
              <span className="text-muted-foreground text-xs font-medium">{want === index ? 'Yes' : 'No'}</span>
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2">
        {graded ? (
          plan.choices.map((c, index) => (
            <button
              key={index}
              type="button"
              className={cardPickerSheetChoice()}
              onClick={() => choose(c.selection, want)}
            >
              <span className="min-w-0 [overflow-wrap:anywhere] break-words">
                {c.label === 'New copy'
                  ? 'Add as a new copy'
                  : c.label === 'Raw'
                    ? 'Use my raw copy'
                    : `Use my ${c.label}`}
              </span>
            </button>
          ))
        ) : (
          <button type="button" className={cardPickerSheetChoice(true)} onClick={() => choose(plan.base, want)}>
            Add card
          </button>
        )}
      </div>
    </CardPickerSheet>
  );
}
