"use client"

// Show mode's purchase tally (lib/show-session.ts), shared by every component and tab on this device.
import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import { setItemMakingRoom } from "@/lib/storage/make-room"
import {
  SHOW_SESSION_EVENT,
  SHOW_SESSION_KEY,
  addShowPurchase,
  clearedShowSession,
  parseShowSession,
  removeShowPurchases,
  type ShowPurchase,
  type ShowSession,
} from "@/lib/show-session"
import {
  SHOW_PURCHASE_QUEUE_KEY,
  parseShowPurchaseQueue,
  queueShowPurchaseAdds,
  queueShowPurchaseRemovals,
  type ShowPurchaseOp,
  type ShowPurchaseStore,
} from "@/lib/show-purchase-sync"

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

function write(next: ShowSession) {
  try {
    setItemMakingRoom(window.localStorage, SHOW_SESSION_KEY, JSON.stringify(next))
  } catch {
    // Full or blocked storage: the purchase still went into the binder.
  }
  window.dispatchEvent(new Event(SHOW_SESSION_EVENT))
}

function readQueueRaw() {
  try {
    return window.localStorage.getItem(SHOW_PURCHASE_QUEUE_KEY)
  } catch {
    return null
  }
}

function writeQueue(queue: ShowPurchaseOp[]) {
  try {
    setItemMakingRoom(window.localStorage, SHOW_PURCHASE_QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Blocked storage: the purchase is still in the tally; it syncs from the next one that is queued.
  }
}

/**
 * This device's tally and sync queue (hooks/use-show-purchase-sync.ts syncs them with the account).
 * The first time, purchases logged before syncing existed are queued so they reach the account too.
 */
export const showPurchaseStore: ShowPurchaseStore & { ensureQueue(now: number): void } = {
  readQueue: () => parseShowPurchaseQueue(readQueueRaw()),
  writeQueue,
  readSession: (now) => parseShowSession(readRaw(), now),
  writeSession: write,
  ensureQueue(now) {
    if (readQueueRaw() === null) writeQueue(queueShowPurchaseAdds([], parseShowSession(readRaw(), now).purchases))
  },
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
      // Also the purchase's id on the account, so it must be unique across devices.
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      ids.push(id)
      next = addShowPurchase(next, { ...purchase, id, at: now }, now)
    }
    showPurchaseStore.ensureQueue(now)
    writeQueue(queueShowPurchaseAdds(showPurchaseStore.readQueue(), next.purchases.filter((entry) => ids.includes(entry.id))))
    write(next)
    return ids
  }, [])

  const removePurchases = useCallback((ids: readonly string[]) => {
    const now = Date.now()
    showPurchaseStore.ensureQueue(now)
    writeQueue(queueShowPurchaseRemovals(showPurchaseStore.readQueue(), ids))
    write(removeShowPurchases(parseShowSession(readRaw(), now), ids))
  }, [])

  // Clearing resets the tally on this device; the purchase log on the account is kept.
  const clear = useCallback(() => {
    write(clearedShowSession(Date.now()))
  }, [])

  return { session, logPurchases, removePurchases, clear }
}
