'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { parseRevisitCards, revisitKey, saveRevisitCard, type RevisitCard } from '@/lib/show-revisit';

const EVENT = 'holofolder:show-revisit';
const subscribe = (notify: () => void) => {
  window.addEventListener('storage', notify);
  window.addEventListener(EVENT, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(EVENT, notify);
  };
};

export function useShowRevisit(key: string | null) {
  const read = useCallback(() => {
    try {
      return key ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const cards = useMemo(() => parseRevisitCards(raw), [raw]);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const write = (next: RevisitCard[]) => {
    if (!key) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      setFailure(null);
      window.dispatchEvent(new Event(EVENT));
      return true;
    } catch {
      setFailure({
        key,
        message: 'Not saved. Device storage is full or unavailable. Keep this note elsewhere before leaving.',
      });
      return false;
    }
  };
  return {
    cards,
    error: failure?.key === key ? failure.message : null,
    save: (entry: RevisitCard) => write(saveRevisitCard(parseRevisitCards(read()), entry)),
    remove: (entry: RevisitCard) =>
      write(parseRevisitCards(read()).filter((card) => revisitKey(card.card) !== revisitKey(entry.card))),
  };
}
