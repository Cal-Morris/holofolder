'use client';

// Pulls the account's show purchases (public.show_purchases, lib/show-purchase-sync.ts) into this device's
// tally (hooks/use-show-session.ts). The log belongs to the collection owner, so a shared partner sees the same tally.
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SHOW_PURCHASE_COLUMNS, pullShowPurchases, type ShowPurchaseRemote } from '@/lib/show-purchase-sync';
import { showPurchaseStore } from '@/hooks/use-show-session';

/** How often a partner's purchases are picked up while Show mode is on. */
const SHOW_MODE_POLL_MS = 60_000;

function supabaseRemote(ownerUserId: string): ShowPurchaseRemote {
  return {
    async listSince(sinceIso) {
      const { data, error } = await createClient()
        .from('show_purchases')
        .select(SHOW_PURCHASE_COLUMNS)
        .eq('owner_user_id', ownerUserId)
        .gte('bought_at', sinceIso)
        .order('bought_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  };
}

export function useShowPurchaseSync({
  ownerUserId,
  isOnline,
  isShowModeOn,
}: {
  /** The collection owner (yourself, or the partner whose binders you share); null when signed out or read-only. */
  ownerUserId: string | null;
  isOnline: boolean;
  isShowModeOn: boolean;
}) {
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  useEffect(() => {
    if (!ownerUserId || !isOnline) return;
    let cancelled = false;
    const remote = supabaseRemote(ownerUserId);
    const run = () => {
      if (cancelled) return;
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = (async () => {
        try {
          await pullShowPurchases({ remote, store: showPurchaseStore });
        } catch {
          // Offline, signed out or the table isn't there yet: the tally stays and the next pull retries.
        } finally {
          running.current = null;
          if (again.current && !cancelled) {
            again.current = false;
            run();
          }
        }
      })();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    run();
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const poll = isShowModeOn
      ? setInterval(() => document.visibilityState === 'visible' && run(), SHOW_MODE_POLL_MS)
      : undefined;
    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isOnline, isShowModeOn, ownerUserId]);
}
