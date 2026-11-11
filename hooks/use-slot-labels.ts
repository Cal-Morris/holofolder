'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Device-local display preference: the A1/B4 pocket coordinates on the binder grid. On unless turned off.
const KEY = 'binderdex:slot-labels:v1';
const EVENT = 'binderdex:slot-labels';

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT, onChange);
  };
}

function read() {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function useSlotLabels() {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const setOn = useCallback((value: boolean) => {
    try {
      if (value) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, 'off');
    } catch {
      // Storage blocked: the switch just won't stick.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, setOn] as const;
}
