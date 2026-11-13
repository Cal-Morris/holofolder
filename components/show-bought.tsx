'use client';

// Show mode's Bought: adds each card to the collection (into the pocket that wanted it, else unassigned) and logs
// what was paid to this show's tally. Both go through queues on the device, so it works with no signal.
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { toast } from '@/components/ui/toast';
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
  /** What to buy and what the confirmation toast leads with, or null when there is nothing to log. */
  purchases: () => { entries: BoughtEntry[]; message: string } | null;
  onLogged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const log = async () => {
    const next = purchases();
    if (!next || busy) return;
    setBusy(true);
    try {
      const { added, undo } = await tally.buy(next.entries);
      navigator.vibrate?.([12, 40, 12]);
      toast(`${next.message} · ${added}`, {
        action: {
          label: 'Undo',
          onAction: () => void undo().catch(() => toast('Couldn’t undo that. Open Activity to check it.', 'error')),
        },
      });
      onLogged();
    } catch {
      toast('Couldn’t add it to your collection, so nothing was logged. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={disabled || busy} onClick={() => void log()} className={className}>
      <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
