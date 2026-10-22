"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import { SHOW_MODE_EVENT, SHOW_MODE_KEY, parseShowMode, serializeShowMode } from "@/lib/show-mode"

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHOW_MODE_KEY) onChange()
  }
  window.addEventListener("storage", onStorage)
  window.addEventListener(SHOW_MODE_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener(SHOW_MODE_EVENT, onChange)
  }
}

function readOn() {
  try {
    return parseShowMode(window.localStorage.getItem(SHOW_MODE_KEY)).on
  } catch {
    return false
  }
}

interface WakeLockLike {
  release: () => Promise<void>
  addEventListener?: (type: "release", listener: () => void) => void
}

/** Device-local Show mode, shared by every component and tab, holding a screen Wake Lock while on. */
export function useShowMode() {
  const isOn = useSyncExternalStore(subscribe, readOn, () => false)

  const setShowMode = useCallback((on: boolean) => {
    try {
      window.localStorage.setItem(SHOW_MODE_KEY, serializeShowMode(on))
    } catch {
      // Private mode or full storage: the switch still works for this page view.
    }
    window.dispatchEvent(new Event(SHOW_MODE_EVENT))
    navigator.vibrate?.(on ? [15, 40, 15] : 15)
  }, [])

  // Keep the screen awake at the table. The lock drops whenever the page is hidden, so re-take it on return.
  useEffect(() => {
    if (!isOn) return
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> } }).wakeLock
    if (!wakeLock) return
    let lock: WakeLockLike | null = null
    let cancelled = false
    const acquire = async () => {
      if (cancelled || lock || document.visibilityState !== "visible") return
      try {
        const next = await wakeLock.request("screen")
        if (cancelled) {
          void next.release().catch(() => {})
          return
        }
        lock = next
        next.addEventListener?.("release", () => {
          if (lock === next) lock = null
        })
      } catch {
        // Battery saver or an unsupported browser: Show mode still works, the screen may just dim.
      }
    }
    const onVisibility = () => void acquire()
    void acquire()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      void lock?.release().catch(() => {})
      lock = null
    }
  }, [isOn])

  return { isShowModeOn: isOn, setShowMode }
}
