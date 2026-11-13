'use client';

// Show mode's Bought: logs what was paid to this show's tally (hooks/use-show-session.ts), queued on the device
// and synced to the collection owner's account. It records spend only; adding the copy to the collection stays
// a separate, explicit step.
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { ShowPurchase } from '@/lib/show-session';

export interface ShowTally {
  logPurchases: (purchases: Array<Omit<ShowPurchase, 'id' | 'at'>>) => string[];
  removePurchases: (ids: readonly string[]) => void;
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
  /** What to log and the confirmation to show, or null when there is nothing to log. */
  purchases: () => { entries: Array<Omit<ShowPurchase, 'id' | 'at'>>; message: string } | null;
  onLogged: () => void;
}) {
  const [logged, setLogged] = useState<{ ids: string[]; message: string } | null>(null);
  const log = () => {
    const next = purchases();
    if (!next) return;
    const ids = tally.logPurchases(next.entries);
    navigator.vibrate?.([12, 40, 12]);
    setLogged({ ids, message: next.message });
    onLogged();
  };
  return (
    <>
      <button type="button" disabled={disabled} onClick={log} className={className}>
        <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden />
        {label}
      </button>
      {logged && (
        <div
          role="status"
          className="bg-muted/60 col-span-full flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm"
        >
          <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{logged.message}</span>
          <button
            type="button"
            onClick={() => {
              tally.removePurchases(logged.ids);
              setLogged(null);
            }}
            className="text-primary min-h-9 shrink-0 px-2 font-semibold"
          >
            Undo
          </button>
        </div>
      )}
    </>
  );
}
