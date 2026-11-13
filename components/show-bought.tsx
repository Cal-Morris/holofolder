'use client';

// Show mode's Bought: adds each card to the collection (into the pocket that wanted it, else unassigned) and logs
// what was paid to this show's tally. Both go through queues on the device, so it works with no signal.
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { ShowPurchase } from '@/lib/show-session';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

export type BoughtEntry = Omit<ShowPurchase, 'id' | 'at'> & { card: SearchCardResult };

export interface ShowTally {
  /** Adds the cards and logs the purchases; resolves once both are saved on this device. Rejects when nothing was saved. */
  buy: (entries: BoughtEntry[]) => Promise<{ added: string; undo: () => Promise<void> }>;
}

export function ShowBought({
  tally,
  label,
  className,
  disabled,
  purchases,
  onLogged,
}: {
  tally: ShowTally;
  label: string;
  className: string;
  disabled: boolean;
  /** What to buy and the confirmation to show, or null when there is nothing to log. */
  purchases: () => { entries: BoughtEntry[]; message: string } | null;
  onLogged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState<{ message: string; undo: () => Promise<void> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const log = async () => {
    const next = purchases();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { added, undo } = await tally.buy(next.entries);
      navigator.vibrate?.([12, 40, 12]);
      setLogged({ message: `${next.message} · ${added}`, undo });
      onLogged();
    } catch {
      setError('Couldn’t add it to your collection, so nothing was logged. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!logged || busy) return;
    setBusy(true);
    try {
      await logged.undo();
      setLogged(null);
    } catch {
      setError('Couldn’t undo that. Open Activity to check it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" disabled={disabled || busy} onClick={() => void log()} className={className}>
        <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden />
        {label}
      </button>
      {(logged || error) && (
        <div
          role="status"
          className="bg-muted/60 order-last col-span-full flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm"
        >
          <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{error ?? logged?.message}</span>
          {logged && !error && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void undo()}
              className="text-primary min-h-9 shrink-0 px-2 font-semibold"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}
