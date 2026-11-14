'use client';

import { useEffect, useRef } from 'react';

import { mergePingRevision, pingRevision } from '@/lib/collection/collection-changed';

/** Bursts of edits (a page move, a bulk add) arrive as several pings; read once after they settle. */
const SETTLE_MS = 400;

/**
 * Calls `onChange` when any writer (a partner, another device, the REST API or MCP) changes the
 * owner's collection. The database pings the private topic `collection:<owner id>` with the inventory
 * revision the write produced (migration 127; null when unknown or before 127), and the caller re-reads
 * through the normal API unless it already holds that revision. Missed pings are covered by the caller's
 * focus and reconnect refresh.
 */
export function useCollectionChanged(ownerUserId: string | null, onChange: (revision: number | null) => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (!ownerUserId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let burst: number | null | undefined;
    let cleanup = () => {};
    void (async () => {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      await supabase.realtime.setAuth();
      if (stopped) return;
      const channel = supabase
        .channel(`collection:${ownerUserId}`, { config: { private: true } })
        .on('broadcast', { event: 'collection_changed' }, (message) => {
          clearTimeout(timer);
          burst = mergePingRevision(burst, pingRevision(message.payload));
          timer = setTimeout(() => {
            const revision = burst ?? null;
            burst = undefined;
            latest.current(revision);
          }, SETTLE_MS);
        })
        .subscribe();
      cleanup = () => void supabase.removeChannel(channel);
    })().catch(() => undefined);
    return () => {
      stopped = true;
      clearTimeout(timer);
      cleanup();
    };
  }, [ownerUserId]);
}
