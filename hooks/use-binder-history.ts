'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isBinderId } from '@/lib/binders/model';
import {
  emptyHistory,
  historyStorageKey,
  normalizeHistoryCard,
  normalizeHistorySearch,
  parseHistorySnapshot,
  queueHistoryAction,
  syncBinderHistory,
  type HistoryKind,
  type HistoryScope,
  type HistorySnapshot,
} from '@/lib/binder-history';
import { historyStorage } from '@/lib/binder-history-storage';
import { addRecentCard, readRecentCards, writeRecentCards, type RecentCard } from '@/lib/recent-cards';
import { addRecentQuickSearch, readRecentQuickSearches, writeRecentQuickSearches } from '@/lib/quick-mode';

export interface BinderHistory extends HistorySnapshot {
  shared: boolean;
  status: string | null;
  rememberCard: (card: RecentCard) => void;
  rememberSearch: (query: string) => void;
  clear: (kind: HistoryKind) => void;
  refresh: () => void;
}

/** undefined = anonymous device history; null = disabled (read-only share or identity still resolving). */
export function useBinderHistory(scope: HistoryScope | null | undefined): BinderHistory {
  const key = scope ? historyStorageKey(scope) : scope === undefined ? 'local' : 'disabled';
  const [view, setView] = useState<{ key: string; snapshot: HistorySnapshot; status: string | null }>({
    key,
    snapshot: emptyHistory(),
    status: null,
  });
  const active = useRef<{
    key: string;
    refresh: () => void;
    change: (kind: HistoryKind, op: 'add' | 'clear', value?: RecentCard | string) => void;
  } | null>(null);

  useEffect(() => {
    const currentScope = scope;
    if (currentScope === null) {
      active.current = null;
      return;
    }
    let cancelled = false;
    const canSync = Boolean(currentScope && isBinderId(currentScope.binderId));
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const storage = historyStorage(key);
    const channel = currentScope && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(key) : null;
    const display = async () => {
      const store = await storage.update((current) => current);
      if (!cancelled)
        setView({
          key,
          snapshot: store,
          status: canSync && store.pending.length ? 'History saved on this device, waiting to sync' : null,
        });
    };
    const failed = (message: string) => {
      if (!cancelled)
        setView((view) =>
          view.key === key ? { ...view, status: message } : { key, snapshot: emptyHistory(), status: message },
        );
    };
    const readLocal = () => ({
      ...emptyHistory(),
      cards: readRecentCards(window.localStorage),
      searches: readRecentQuickSearches(window.localStorage),
    });
    const frame = window.requestAnimationFrame(() => {
      if (currentScope) void display().catch(() => failed('History storage unavailable on this device'));
      else setView({ key, snapshot: readLocal(), status: null });
    });

    const refresh = () => {
      if (cancelled) return;
      if (!currentScope) {
        setView({ key, snapshot: readLocal(), status: null });
        return;
      }
      if (!isBinderId(currentScope.binderId) || !navigator.onLine) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      void (async () => {
        try {
          const pending = await syncBinderHistory(
            storage,
            {
              async sync(clientId, actions) {
                const { data, error } = await createClient().rpc('sync_binder_history', {
                  target_binder: currentScope.binderId,
                  expected_owner: currentScope.ownerId,
                  expected_account: currentScope.accountId,
                  device_id: clientId,
                  actions,
                });
                if (error) throw error;
                const snapshot = parseHistorySnapshot(data);
                if (!snapshot) throw new Error('Invalid history response');
                return snapshot;
              },
            },
            () => !cancelled,
          );
          if (!cancelled) {
            await display();
            if (!cancelled) channel?.postMessage('updated');
          }
          if (pending) again = true;
        } catch {
          failed('Shared history unavailable, saved changes will retry');
        } finally {
          running = false;
          if (again && !cancelled) {
            again = false;
            refresh();
          }
        }
      })();
    };
    const change = (kind: HistoryKind, op: 'add' | 'clear', value?: RecentCard | string) => {
      if (cancelled) return;
      if (currentScope) {
        // Publish only after commit: a visible edit is durable even if this tab closes
        // while another tab's sync request is stalled.
        void storage
          .update((current) => {
            const next = queueHistoryAction(current, kind, op, value);
            if (!canSync) next.pending = [];
            return next;
          })
          .then(async () => {
            if (cancelled) return;
            await display();
            if (cancelled) return;
            channel?.postMessage('changed');
            clearTimeout(timer);
            timer = setTimeout(refresh, 300);
          })
          .catch(() => failed('History could not be saved on this device'));
      } else {
        const snapshot = readLocal();
        if (kind === 'card')
          writeRecentCards(
            window.localStorage,
            op === 'clear' ? [] : addRecentCard(snapshot.cards, value as RecentCard),
          );
        else
          writeRecentQuickSearches(
            window.localStorage,
            op === 'clear' ? [] : addRecentQuickSearch(snapshot.searches, value as string),
          );
        setView({ key, snapshot: readLocal(), status: null });
      }
    };
    active.current = { key, refresh, change };
    const onFocus = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    if (channel)
      channel.onmessage = (event) => {
        void display()
          .then(() => {
            if (event.data === 'changed') refresh();
          })
          .catch(() => failed('History storage unavailable on this device'));
      };
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', onFocus);
      channel?.close();
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [key, scope]);

  const change = useCallback(
    (kind: HistoryKind, op: 'add' | 'clear', value?: RecentCard | string) => {
      if (active.current?.key === key) active.current.change(kind, op, value);
    },
    [key],
  );
  const rememberCard = useCallback(
    (card: RecentCard) => {
      const value = normalizeHistoryCard(card);
      if (value) change('card', 'add', value);
    },
    [change],
  );
  const rememberSearch = useCallback(
    (query: string) => {
      const value = normalizeHistorySearch(query);
      if (value) change('search', 'add', value);
    },
    [change],
  );
  const clear = useCallback((kind: HistoryKind) => change(kind, 'clear'), [change]);
  const refresh = useCallback(() => {
    if (active.current?.key === key) active.current.refresh();
  }, [key]);
  return {
    ...(view.key === key ? view.snapshot : emptyHistory()),
    status: view.key === key ? view.status : null,
    shared: Boolean(scope && isBinderId(scope.binderId)),
    rememberCard,
    rememberSearch,
    clear,
    refresh,
  };
}
