'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { parseShowBudget, type ShowBudget } from '@/lib/show-budget';

const EVENT = 'holofolder:show-budget';
const subscribe = (notify: () => void) => {
  window.addEventListener('storage', notify);
  window.addEventListener(EVENT, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(EVENT, notify);
  };
};

export function useShowBudget(key: string | null) {
  const read = useCallback(() => {
    try {
      return key ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const budget = useMemo(() => parseShowBudget(raw), [raw]);
  const [failure, setFailure] = useState<string | null>(null);
  const write = (next: ShowBudget | null) => {
    if (!key) return false;
    try {
      if (next) window.localStorage.setItem(key, JSON.stringify(next));
      else window.localStorage.removeItem(key);
      setFailure(null);
      window.dispatchEvent(new Event(EVENT));
      return true;
    } catch {
      setFailure(key);
      return false;
    }
  };
  return {
    budget,
    write,
    error: failure === key && key ? 'Budget not saved. Device storage is full or unavailable.' : null,
  };
}
