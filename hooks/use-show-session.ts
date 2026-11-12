'use client';

// Show mode's purchase tally (lib/show-session.ts), shared by every component and tab on this device.
// hooks/use-show-purchase-sync.ts fills it from the account.
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { setItemMakingRoom } from '@/lib/storage/make-room';
import {
  SHOW_SESSION_EVENT,
  SHOW_SESSION_KEY,
  clearedShowSession,
  parseShowSession,
  type ShowSession,
} from '@/lib/show-session';
import type { ShowPurchaseStore } from '@/lib/show-purchase-sync';

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHOW_SESSION_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SHOW_SESSION_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SHOW_SESSION_EVENT, onChange);
  };
}

function readRaw() {
  try {
    return window.localStorage.getItem(SHOW_SESSION_KEY);
  } catch {
    return null;
  }
}

function write(next: ShowSession) {
  try {
    setItemMakingRoom(window.localStorage, SHOW_SESSION_KEY, JSON.stringify(next));
  } catch {
    // Full or blocked storage: the tally just isn't kept on this device.
  }
  window.dispatchEvent(new Event(SHOW_SESSION_EVENT));
}

export const showPurchaseStore: ShowPurchaseStore = {
  readSession: (now) => parseShowSession(readRaw(), now),
  writeSession: write,
};

export function useShowSession() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  // Read once per mount: the age check only has to start a new session on the next visit.
  const [openedAt] = useState(() => Date.now());
  const session = useMemo(() => parseShowSession(raw, openedAt), [openedAt, raw]);

  // Clearing resets the tally on this device; the purchase log on the account is kept.
  const clear = useCallback(() => {
    write(clearedShowSession(Date.now()));
  }, []);

  return { session, clear };
}
