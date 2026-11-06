"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { isBinderId } from "@/lib/binders/model"
import { emptyHistory, historyStorageKey, normalizeHistoryCard, normalizeHistorySearch, parseHistorySnapshot, parseHistoryStore, queueHistoryAction, syncBinderHistory, type HistoryKind, type HistoryScope, type HistorySnapshot, type HistoryStore } from "@/lib/binder-history"
import { addRecentCard, readRecentCards, writeRecentCards, type RecentCard } from "@/lib/recent-cards"
import { addRecentQuickSearch, readRecentQuickSearches, writeRecentQuickSearches } from "@/lib/quick-mode"

export interface BinderHistory extends HistorySnapshot {
  shared: boolean
  status: string | null
  rememberCard: (card: RecentCard) => void
  rememberSearch: (query: string) => void
  clear: (kind: HistoryKind) => void
  refresh: () => void
}

/** undefined = anonymous device history; null = disabled (read-only share or identity still resolving). */
export function useBinderHistory(scope: HistoryScope | null | undefined): BinderHistory {
  const key = scope ? historyStorageKey(scope) : scope === undefined ? "local" : "disabled"
  const [view, setView] = useState<{ key: string; snapshot: HistorySnapshot; status: string | null }>({ key, snapshot: emptyHistory(), status: null })
  const active = useRef<{ key: string; refresh: () => void; change: (kind: HistoryKind, op: "add" | "clear", value?: RecentCard | string) => void } | null>(null)

  useEffect(() => {
    const currentScope = scope
    if (currentScope === null) { active.current = null; return }
    let cancelled = false
    const canSync = Boolean(currentScope && isBinderId(currentScope.binderId))
    let storageAvailable = true
    let running = false
    let again = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let memory: HistoryStore = { ...emptyHistory(), clientId: crypto.randomUUID(), sequence: 0, pending: [] }
    const read = () => {
      if (!storageAvailable) return memory
      try { return parseHistoryStore(localStorage.getItem(key)) ?? memory } catch { storageAvailable = false; return memory }
    }
    const write = (store: HistoryStore) => {
      memory = store
      try { localStorage.setItem(key, JSON.stringify(store)) } catch { storageAvailable = false }
      if (!cancelled) setView({ key, snapshot: store, status: canSync && store.pending.length ? "History saved on this device, waiting to sync" : null })
    }
    const readLocal = () => ({ ...emptyHistory(), cards: readRecentCards(window.localStorage), searches: readRecentQuickSearches(window.localStorage) })
    if (currentScope) memory = read()
    const frame = window.requestAnimationFrame(() => {
      if (currentScope) write(read())
      else setView({ key, snapshot: readLocal(), status: null })
    })

    const refresh = () => {
      if (cancelled) return
      if (!currentScope) { setView({ key, snapshot: readLocal(), status: null }); return }
      if (!isBinderId(currentScope.binderId) || !navigator.onLine) return
      if (running) { again = true; return }
      running = true
      void (async () => {
        try {
          const pending = await syncBinderHistory({ read, write }, {
            async sync(clientId, actions) {
              const { data, error } = await createClient().rpc("sync_binder_history", {
                target_binder: currentScope.binderId, expected_owner: currentScope.ownerId,
                expected_account: currentScope.accountId, device_id: clientId, actions,
              })
              if (error) throw error
              const snapshot = parseHistorySnapshot(data)
              if (!snapshot) throw new Error("Invalid history response")
              return snapshot
            },
          })
          if (pending) again = true
        } catch {
          if (!cancelled) setView({ key, snapshot: read(), status: "Shared history unavailable, saved on this device" })
        } finally {
          running = false
          if (again && !cancelled) { again = false; refresh() }
        }
      })()
    }
    const change = (kind: HistoryKind, op: "add" | "clear", value?: RecentCard | string) => {
      if (cancelled) return
      if (currentScope) {
        const next = queueHistoryAction(read(), kind, op, value)
        if (!canSync) next.pending = []
        write(next)
        clearTimeout(timer)
        timer = setTimeout(refresh, 300)
      } else {
        const snapshot = readLocal()
        if (kind === "card") writeRecentCards(window.localStorage, op === "clear" ? [] : addRecentCard(snapshot.cards, value as RecentCard))
        else writeRecentQuickSearches(window.localStorage, op === "clear" ? [] : addRecentQuickSearch(snapshot.searches, value as string))
        setView({ key, snapshot: readLocal(), status: null })
      }
    }
    active.current = { key, refresh, change }
    const onFocus = () => { if (document.visibilityState === "visible") refresh() }
    const onStorage = (event: StorageEvent) => { if (event.key === key) { setView({ key, snapshot: read(), status: null }); refresh() } }
    refresh()
    window.addEventListener("online", refresh)
    window.addEventListener("focus", onFocus)
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      clearTimeout(timer)
      window.removeEventListener("online", refresh)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [key, scope])

  const change = useCallback((kind: HistoryKind, op: "add" | "clear", value?: RecentCard | string) => {
    if (active.current?.key === key) active.current.change(kind, op, value)
  }, [key])
  const rememberCard = useCallback((card: RecentCard) => {
    const value = normalizeHistoryCard(card)
    if (value) change("card", "add", value)
  }, [change])
  const rememberSearch = useCallback((query: string) => {
    const value = normalizeHistorySearch(query)
    if (value) change("search", "add", value)
  }, [change])
  const clear = useCallback((kind: HistoryKind) => change(kind, "clear"), [change])
  const refresh = useCallback(() => { if (active.current?.key === key) active.current.refresh() }, [key])
  return { ...(view.key === key ? view.snapshot : emptyHistory()), status: view.key === key ? view.status : null, shared: Boolean(scope && isBinderId(scope.binderId)), rememberCard, rememberSearch, clear, refresh }
}
