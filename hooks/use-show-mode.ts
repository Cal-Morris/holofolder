'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { setItemMakingRoom } from '@/lib/storage/make-room';
import { trackGoogleEvent } from '@/lib/google-analytics';
import { SHOW_MODE_EVENT, SHOW_MODE_KEY, isStoredOn, parseShowMode, serializeShowMode } from '@/lib/show-mode';

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHOW_MODE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SHOW_MODE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SHOW_MODE_EVENT, onChange);
  };
}

/**
 * The switch as set in this page when saving it failed (a full or blocked localStorage: an installed
 * app's offline caches can fill it). Without this a tap on Show would write nothing, read the old
 * value back and look dead. Null once a save succeeds, so storage is the source of truth again.
 */
let unsavedOn: boolean | null = null;

function readOn() {
  if (unsavedOn !== null) return unsavedOn;
  try {
    return parseShowMode(window.localStorage.getItem(SHOW_MODE_KEY)).on;
  } catch {
    return false;
  }
}

/** Marks Show mode as seen now, or clears an "on" that expired while the app was closed. */
function touchShowMode() {
  try {
    const raw = window.localStorage.getItem(SHOW_MODE_KEY);
    const state = parseShowMode(raw);
    if (state.on) {
      window.localStorage.setItem(SHOW_MODE_KEY, serializeShowMode(true, new Date(), state.since));
    } else if (isStoredOn(raw)) {
      window.localStorage.setItem(SHOW_MODE_KEY, serializeShowMode(false));
      window.dispatchEvent(new Event(SHOW_MODE_EVENT));
    }
  } catch {
    // Storage unavailable: nothing to refresh.
  }
}

const TOUCH_EVERY_MS = 60 * 1000;

interface WakeLockLike {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
}

/** Device-local Show mode, shared by every component and tab, holding a screen Wake Lock while on. */
export function useShowMode() {
  const isOn = useSyncExternalStore(subscribe, readOn, () => false);

  const setShowMode = useCallback((on: boolean) => {
    trackGoogleEvent('show_mode_toggled', { on });
    try {
      // A full storage gives up other binders' offline copies first, so the switch survives a reload.
      setItemMakingRoom(window.localStorage, SHOW_MODE_KEY, serializeShowMode(on));
      unsavedOn = null;
    } catch {
      // Private mode or full storage: the switch still works for this page view.
      unsavedOn = on;
    }
    window.dispatchEvent(new Event(SHOW_MODE_EVENT));
    navigator.vibrate?.(on ? [15, 40, 15] : 15);
  }, []);

  // Show mode lasts while the app is in use: keep it fresh while open, and let it lapse after a few
  // hours away (lib/show-mode.ts SHOW_MODE_IDLE_MS) so a later launch doesn't open in Show mode.
  useEffect(() => {
    touchShowMode();
    if (!isOn) return;
    const onVisibility = () => touchShowMode();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') touchShowMode();
    }, TOUCH_EVERY_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
    };
  }, [isOn]);

  // Keep the screen awake at the table. The lock drops whenever the page is hidden, so re-take it on return.
  useEffect(() => {
    if (!isOn) return;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockLike> } })
      .wakeLock;
    if (!wakeLock) return;
    let lock: WakeLockLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || lock || document.visibilityState !== 'visible') return;
      try {
        const next = await wakeLock.request('screen');
        if (cancelled) {
          void next.release().catch(() => {});
          return;
        }
        lock = next;
        next.addEventListener?.('release', () => {
          if (lock === next) lock = null;
        });
      } catch {
        // Battery saver or an unsupported browser: Show mode still works, the screen may just dim.
      }
    };
    const onVisibility = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [isOn]);

  return { isShowModeOn: isOn, setShowMode };
}
