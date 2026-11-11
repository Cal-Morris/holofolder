'use client';

import { useState } from 'react';
import type { RecentCard } from '@/lib/recent-cards';
import type { RevisitCard } from '@/lib/show-revisit';
import type { DisplayCurrency } from '@/lib/pricing-region';

export default function ShowRevisitForm({
  card,
  entry,
  askingPrice,
  currency,
  onSave,
  error,
}: {
  card: RecentCard;
  entry?: RevisitCard;
  askingPrice: number | null;
  currency: DisplayCurrency;
  onSave: (entry: RevisitCard) => boolean;
  error: string | null;
}) {
  const [note, setNote] = useState(entry?.note ?? '');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const signature = JSON.stringify([askingPrice, currency, note]);
  return (
    <section aria-label="Save this deal" className="border-border/60 space-y-2 rounded-xl border p-3">
      <label className="block text-sm font-semibold">
        Stall or condition note
        <textarea
          aria-label="Stall or condition note"
          value={note}
          maxLength={500}
          onChange={(event) => {
            setNote(event.target.value);
            setSavedNotice(null);
          }}
          placeholder="Table 14, corner whitening"
          rows={2}
          className="border-border bg-background mt-1 w-full rounded-lg border p-2 text-base"
        />
      </label>
      <button
        type="button"
        className="bg-muted min-h-10 rounded-xl px-3 text-sm font-semibold"
        onClick={() =>
          setSavedNotice(
            onSave({ card, askingPrice, currency, note: note.trim(), savedAt: new Date().toISOString() })
              ? signature
              : null,
          )
        }
      >
        {entry ? 'Update saved deal' : 'Save for later'}
      </button>
      <p role="status" className="text-muted-foreground text-xs">
        {error ?? (savedNotice === signature ? 'Saved on this device' : 'Notes and asking price stay on this device.')}
      </p>
    </section>
  );
}
