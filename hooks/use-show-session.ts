"use client"

// Show mode's purchase tally (lib/show-session.ts), shared by every component and tab on this device.
import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import {
  SHOW_SESSION_EVENT,
  SHOW_SESSION_KEY,
  addShowPurchase,
  parseShowSession,
  removeShowPurchases,
  type ShowPurchase,
} from "@/lib/show-session"

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHOW_SESSION_KEY) onChange()
  }
  window.addEventListener("storage", onStorage)
  window.addEventListener(SHOW_SESSION_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener(SHOW_SESSION_EVENT, onChange)
  }
}

function readRaw() {
  try {
    return window.localStorage.getItem(SHOW_SESSION_KEY)
  } catch {
    return null
  }
}

function write(next: ReturnType<typeof parseShowSession>) {
  try {
    window.localStorage.setItem(SHOW_SESSION_KEY, JSON.stringify(next))
  } catch {
    // Full or blocked storage: the purchase still went into the binder.
  }
  window.dispatchEvent(new Event(SHOW_SESSION_EVENT))
}

export function useShowSession() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null)
  // Read once per mount: the age check only has to start a new session on the next visit.
  const [openedAt] = useState(() => Date.now())
  const session = useMemo(() => parseShowSession(raw, openedAt), [openedAt, raw])

  const logPurchases = useCallback((purchases: Array<Omit<ShowPurchase, "id" | "at">>) => {
    const now = Date.now()
    let next = parseShowSession(readRaw(), now)
    const ids: string[] = []
    for (const purchase of purchases) {
      const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      ids.push(id)
      next = addShowPurchase(next, { ...purchase, id, at: now }, now)
    }
    write(next)
    return ids
  }, [])

  const removePurchases = useCallback((ids: readonly string[]) => {
    write(removeShowPurchases(parseShowSession(readRaw(), Date.now()), ids))
  }, [])

  const clear = useCallback(() => {
    write({ startedAt: Date.now(), purchases: [] })
  }, [])

  return { session, logPurchases, removePurchases, clear }
}
