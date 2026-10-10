"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { readLocalCollectedIds, writeLocalCollectedIds } from "@/lib/local-collection"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { loadCollectionRecord } from "@/lib/offline-store/records"
import {
  COLLECTION_CHANGED_EVENT,
  createCollectionChangedPayload,
  getCollectionRealtimeTopic,
} from "@/lib/collection-realtime"
import type { User } from "@supabase/supabase-js"

import {
  type CardFinish,
  type CardLanguage,
  type CollectedPokemon,
  type SlotStatus,
  type WantedCard,
} from "@/lib/domain/cards"

export type { CardFinish, CardLanguage, CollectedPokemon, SlotStatus, WantedCard } from "@/lib/domain/cards"
export {
  COLLECTION_AUTO_REFRESH_INTERVAL_MS,
  COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS,
  getCollectionAutoRefreshIntervalMs,
  getRemoteCollectionRefreshPlan,
  isCollectionAutoRefreshDue,
  keepStableUserById,
  shouldAutoRefreshCollection,
} from "@/lib/collection/refresh-policy"

import {
  normalizeCollectionItem,
  normalizeCollectionItems,
  upsertCollectionItem,
  removeCollectionItem,
  numberArraysEqual,
} from "@/lib/collection/normalize"
import {
  LOCAL_COLLECTION_PENDING_OPS_KEY,
  hasPendingCollectionOperation,
  readLocalCollectionSnapshot,
  restorePendingCollectionOperations,
  readPendingCollectionOperations,
  queuePendingCollectionOperation,
  rebasePendingCollectionOperation,
  removePendingCollectionOperation,
  replacePendingCollectionOperation,
  persistLocalCollectionState,
  isOffline,
} from "@/lib/collection/offline-queue"
import type { PendingCollectionOperation, PendingCollectionOperationInput } from "@/lib/collection/offline-queue"
import {
  applyPendingEdits,
  classifyWriteFailure,
  collectionFingerprint,
  nextSyncRetryDelay,
  resolveConflict,
} from "@/lib/collection/sync"
import {
  COLLECTION_AUTO_REFRESH_INTERVAL_MS,
  keepStableUserById,
  getRemoteCollectionRefreshPlan,
  shouldAutoRefreshCollection,
  isCollectionAutoRefreshDue,
  isDocumentVisible,
} from "@/lib/collection/refresh-policy"
import {
  CollectionWriteError,
  extractErrorMessage,
  saveRemoteCollectionItem,
  deleteRemoteCollectionItem,
} from "@/lib/collection/remote"

/** idle: nothing to send · syncing: sending queued edits · waiting: a send failed, retrying with backoff */
export type CollectionSyncStatus = "idle" | "syncing" | "waiting"

function describeEdit(operation: Pick<PendingCollectionOperation, "pokemonId"> & { item?: CollectedPokemon; base?: CollectedPokemon | null }) {
  const name = operation.item?.pokemon_name ?? operation.base?.pokemon_name ?? `#${operation.pokemonId}`
  return name.charAt(0).toUpperCase() + name.slice(1)
}

interface PokemonCatalogEntry {
  id: number
  name: string
}

interface SyncLocalCollectionOptions {
  replaceRemote?: boolean
}

interface SyncLocalCollectionResult {
  added: number
  removed: number
  localCount: number
  remoteCountBefore: number
  remoteCountAfter: number
  mode: "merge" | "replace"
}

interface UseCollectionOptions {
  initialUser?: User | null
  initialCollection?: Partial<CollectedPokemon>[]
  initialCollectionOwnerUserId?: string | null
  readOnly?: boolean
}

interface SaveCollectionOptions {
  cardFinish?: CardFinish
  wantedCards?: WantedCard[]
}

export function useCollection(options: UseCollectionOptions = {}) {
  const { initialUser = null, initialCollection = [], initialCollectionOwnerUserId = null, readOnly = false } = options
  const [user, setUser] = useState<User | null>(initialUser)
  const [collection, setCollection] = useState<CollectedPokemon[]>(normalizeCollectionItems(initialCollection))
  const [collectionOwnerUserId, setCollectionOwnerUserId] = useState<string | null>(initialCollectionOwnerUserId)
  const [localCollectedCount, setLocalCollectedCount] = useState(0)
  const [localPendingSyncCount, setLocalPendingSyncCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState<CollectionSyncStatus>("idle")
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const syncRetryAttemptRef = useRef(0)
  const syncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushPendingCollectionOperationsRef = useRef<() => Promise<void>>(async () => undefined)
  const supabase = createClient()
  const isFlushingPendingOperationsRef = useRef(false)
  const activeRemoteCollectionWriteCountRef = useRef(0)
  const collectionRealtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null)
  const isCollectionRealtimeConnectedRef = useRef(false)
  const lastCollectionAutoRefreshAtRef = useRef(0)

  const getSanitizedLocalCollectedIds = useCallback(() => {
    const rawIds = readLocalCollectedIds()
    const wishlistedIds = new Set(
      collection
        .filter((item) => item.status === "wishlisted")
        .map((item) => item.pokemon_id),
    )
    const sanitizedIds = rawIds.filter((pokemonId) => !wishlistedIds.has(pokemonId))

    if (sanitizedIds.length !== rawIds.length) {
      writeLocalCollectedIds(sanitizedIds)
    }

    return sanitizedIds
  }, [collection])

  const resolveCollectionOwnerUserId = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setCollectionOwnerUserId(null)
      return null
    }

    const { data: partnership, error } = await supabase
      .from("partnerships")
      .select("owner_user_id")
      .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
      .limit(1)
      .maybeSingle()

    if (error) throw error

    const ownerUserId = partnership?.owner_user_id || currentUser.id
    setCollectionOwnerUserId(ownerUserId)
    return ownerUserId
  }, [supabase])

  const refreshLocalCollectedCount = useCallback(() => {
    setLocalCollectedCount(getSanitizedLocalCollectedIds().length)
  }, [getSanitizedLocalCollectedIds])

  const refreshLocalPendingSyncCount = useCallback(() => {
    setLocalPendingSyncCount(readPendingCollectionOperations().length)
  }, [])

  const applyLocalCollection = useCallback((nextCollection: CollectedPokemon[]) => {
    setCollection(nextCollection)
    persistLocalCollectionState(nextCollection, collectionOwnerUserId)
    refreshLocalCollectedCount()
  }, [collectionOwnerUserId, refreshLocalCollectedCount])

  const cancelSyncRetry = useCallback(() => {
    if (syncRetryTimerRef.current) {
      clearTimeout(syncRetryTimerRef.current)
      syncRetryTimerRef.current = null
    }
    syncRetryAttemptRef.current = 0
  }, [])

  /** Try the queue again after the next backoff delay. */
  const scheduleSyncRetry = useCallback(() => {
    if (syncRetryTimerRef.current) clearTimeout(syncRetryTimerRef.current)
    const delay = nextSyncRetryDelay(syncRetryAttemptRef.current)
    syncRetryAttemptRef.current += 1
    setSyncStatus("waiting")
    syncRetryTimerRef.current = setTimeout(() => {
      syncRetryTimerRef.current = null
      void flushPendingCollectionOperationsRef.current()
    }, delay)
  }, [])

  const queueLocalCollectionOperation = useCallback((operation: PendingCollectionOperationInput, options: { afterFailure?: boolean } = {}) => {
    queuePendingCollectionOperation(operation)
    if (options.afterFailure) {
      // The server or network just failed this edit: back off before trying again.
      scheduleSyncRetry()
    } else {
      // A new edit is a good moment to try again straight away.
      cancelSyncRetry()
      void Promise.resolve().then(() => flushPendingCollectionOperationsRef.current())
    }
    refreshLocalPendingSyncCount()
  }, [cancelSyncRetry, refreshLocalPendingSyncCount, scheduleSyncRetry])

  useEffect(() => {
    refreshLocalCollectedCount()
    refreshLocalPendingSyncCount()

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "pokemon_collected" || event.key === LOCAL_COLLECTION_PENDING_OPS_KEY) {
        refreshLocalCollectedCount()
        refreshLocalPendingSyncCount()
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [refreshLocalCollectedCount, refreshLocalPendingSyncCount])

  useEffect(() => {
    if (readOnly || !user) {
      return
    }

    const cloudCollectedIds = collection
      .filter((item) => item.status !== "wishlisted")
      .map((item) => item.pokemon_id)
      .sort((a, b) => a - b)
    const localIds = readLocalCollectedIds()

    if (!numberArraysEqual(localIds, cloudCollectedIds)) {
      writeLocalCollectedIds(cloudCollectedIds)
    }

    if (localCollectedCount !== cloudCollectedIds.length) {
      setLocalCollectedCount(cloudCollectedIds.length)
    }
  }, [collection, localCollectedCount, readOnly, user])

  useEffect(() => {
    if (readOnly) return

    const applySnapshot = (snapshot: { ownerUserId: string | null; collection: CollectedPokemon[] }) => {
      const isOffline = typeof navigator !== "undefined" && navigator.onLine === false
      const ownerMatches = Boolean(collectionOwnerUserId && snapshot.ownerUserId === collectionOwnerUserId)

      if (!isOffline && !ownerMatches) {
        return
      }

      setCollection((current) => current.length > 0 ? current : snapshot.collection)

      if (!collectionOwnerUserId && snapshot.ownerUserId) {
        setCollectionOwnerUserId(snapshot.ownerUserId)
      }
    }

    const snapshot = readLocalCollectionSnapshot()
    if (snapshot && snapshot.collection.length > 0) {
      applySnapshot(snapshot)
      return
    }

    // localStorage has nothing (cleared, or too full to write): fall back to the IndexedDB copy.
    const store = getOfflineStore()
    if (!store) return

    let cancelled = false
    void loadCollectionRecord(store)
      .then((record) => {
        if (cancelled || !record) return
        if (restorePendingCollectionOperations(record.pendingOperations) > 0) {
          refreshLocalPendingSyncCount()
        }
        if (record.collection.length > 0) {
          applySnapshot(record)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [collectionOwnerUserId, readOnly, refreshLocalPendingSyncCount])

  const reloadRemoteCollection = useCallback(async () => {
    if (readOnly) return

    try {
      const refreshPlan = getRemoteCollectionRefreshPlan(user, collectionOwnerUserId)

      if (refreshPlan) {
        const ownerUserId = refreshPlan.knownOwnerUserId ?? await resolveCollectionOwnerUserId(refreshPlan.user)
        const { data, error } = await supabase
          .from("pokemon_collection")
          .select("*")
          .eq("user_id", ownerUserId)
          .order("pokemon_id", { ascending: true })

        if (error) throw error
        // Queued edits stay visible until they are synced.
        setCollection(applyPendingEdits(normalizeCollectionItems(data), readPendingCollectionOperations()))
      } else {
        setCollection([])
      }
    } catch (error) {
      console.error("[binderdex] Error loading collection:", error)
    }
  }, [collectionOwnerUserId, readOnly, resolveCollectionOwnerUserId, supabase, user])

  const writeRemoteCollection = useCallback(async <T,>(operation: () => PromiseLike<T>) => {
    activeRemoteCollectionWriteCountRef.current += 1

    try {
      return await operation()
    } finally {
      activeRemoteCollectionWriteCountRef.current = Math.max(0, activeRemoteCollectionWriteCountRef.current - 1)
    }
  }, [])

  const broadcastCollectionChanged = useCallback(async () => {
    if (readOnly || !collectionOwnerUserId || isOffline()) return

    const existingChannel = collectionRealtimeChannelRef.current
    const channel = existingChannel ?? supabase.channel(getCollectionRealtimeTopic(collectionOwnerUserId))

    try {
      await channel.send({
        type: "broadcast",
        event: COLLECTION_CHANGED_EVENT,
        payload: createCollectionChangedPayload(),
      })
    } catch (error) {
      console.error("[binderdex] Error broadcasting collection refresh:", error)
    } finally {
      if (!existingChannel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [collectionOwnerUserId, readOnly, supabase])

  useEffect(() => {
    if (readOnly) return

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser((existingUser) => keepStableUserById(existingUser, session?.user ?? null))

      if (session?.user) {
        const ownerUserId = await resolveCollectionOwnerUserId(session.user)
        const { data } = await supabase
          .from("pokemon_collection")
          .select("*")
          .eq("user_id", ownerUserId)
          .order("pokemon_id", { ascending: true })

        setCollection(applyPendingEdits(normalizeCollectionItems(data), readPendingCollectionOperations()))
      } else {
        setCollectionOwnerUserId(null)
        setCollection([])
      }
    })

    return () => subscription.unsubscribe()
  }, [readOnly, resolveCollectionOwnerUserId, supabase])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (readOnly || !user || !collectionOwnerUserId) return

    const channel = supabase.channel(getCollectionRealtimeTopic(collectionOwnerUserId), {
      config: {
        broadcast: { self: false },
      },
    })

    collectionRealtimeChannelRef.current = channel

    channel
      .on("broadcast", { event: COLLECTION_CHANGED_EVENT }, () => {
        const pendingOperationCount = readPendingCollectionOperations().length

        if (pendingOperationCount !== localPendingSyncCount) {
          setLocalPendingSyncCount(pendingOperationCount)
        }

        if (!shouldAutoRefreshCollection({
          readOnly,
          hasUser: Boolean(user),
          isOnline: !isOffline(),
          pendingOperationCount,
          isFlushingPendingOperations: isFlushingPendingOperationsRef.current,
          isWritingRemoteCollection: activeRemoteCollectionWriteCountRef.current > 0,
        })) {
          return
        }

        void reloadRemoteCollection()
      })
      .subscribe((status, error) => {
        isCollectionRealtimeConnectedRef.current = status === "SUBSCRIBED"

        if (error) {
          console.error("[binderdex] Collection realtime subscription failed:", { status, error })
        }
      })

    return () => {
      if (collectionRealtimeChannelRef.current === channel) {
        collectionRealtimeChannelRef.current = null
        isCollectionRealtimeConnectedRef.current = false
      }

      void supabase.removeChannel(channel)
    }
  }, [collectionOwnerUserId, localPendingSyncCount, readOnly, reloadRemoteCollection, supabase, user])

  useEffect(() => {
    if (readOnly) return
    if (!collectionOwnerUserId && collection.length === 0) return

    persistLocalCollectionState(collection, collectionOwnerUserId)
  }, [collection, collectionOwnerUserId, readOnly])

  /** Show the outcome of a write unless a newer local edit of the same Pokémon is still queued. */
  const settleLocalItem = useCallback((pokemonId: number, item: CollectedPokemon | null) => {
    if (hasPendingCollectionOperation(pokemonId)) {
      // The newer edit is now based on what the server has.
      rebasePendingCollectionOperation(pokemonId, item)
      return
    }
    setCollection((current) => (item ? upsertCollectionItem(current, item) : removeCollectionItem(current, pokemonId)))
  }, [])

  /** Undo an edit the server will never accept, and say so. */
  const rollBackEdit = useCallback((operation: { pokemonId: number; item?: CollectedPokemon; base?: CollectedPokemon | null }, error: unknown) => {
    console.error("[binderdex] Collection change rejected, rolled back:", {
      pokemonId: operation.pokemonId,
      message: extractErrorMessage(error),
    })
    if ("base" in operation && operation.base !== undefined) {
      settleLocalItem(operation.pokemonId, operation.base)
    } else {
      // Legacy edit without a known base: the next refresh brings back the server row.
      lastCollectionAutoRefreshAtRef.current = 0
    }
    setSyncNotice(`Couldn't save your change to ${describeEdit(operation)}. It was undone.`)
  }, [settleLocalItem])

  const flushPendingCollectionOperations = useCallback(async () => {
    if (readOnly || !user || !collectionOwnerUserId || isOffline()) return
    if (isFlushingPendingOperationsRef.current) return
    // Backing off after a failure: only the retry timer, reconnecting, the app becoming visible or a new
    // edit start the next attempt (they clear the timer first).
    if (syncRetryTimerRef.current) return

    const operations = readPendingCollectionOperations()
    if (operations.length === 0) {
      if (localPendingSyncCount !== 0) {
        setLocalPendingSyncCount(0)
      }
      setSyncStatus("idle")
      return
    }

    isFlushingPendingOperationsRef.current = true
    setSyncStatus("syncing")
    let didWriteRemoteCollection = false
    let shouldRetry = false

    try {
      for (const queuedOperation of operations) {
        let operation = queuedOperation
        let conflictRounds = 0

        // Each edit: write it; on 409 merge with the server row and try again (bounded); on a hard
        // failure roll it back; on a network/server failure stop and retry the whole queue later.
        while (true) {
          const edit = operation
          const baseFingerprint = "base" in edit ? collectionFingerprint(edit.base) : undefined
          try {
            if (edit.type === "upsert") {
              const savedItem = await writeRemoteCollection(() => saveRemoteCollectionItem(edit.item, { baseFingerprint }))
              removePendingCollectionOperation(edit.id)
              settleLocalItem(edit.pokemonId, savedItem)
            } else {
              await writeRemoteCollection(() => deleteRemoteCollectionItem(edit.pokemonId, { baseFingerprint }))
              removePendingCollectionOperation(edit.id)
              settleLocalItem(edit.pokemonId, null)
            }
            didWriteRemoteCollection = true
            break
          } catch (error) {
            const kind = classifyWriteFailure(error)

            if (kind === "conflict" && conflictRounds < 2) {
              conflictRounds += 1
              const serverItem = error instanceof CollectionWriteError ? error.serverItem : null
              const resolution = resolveConflict(operation, serverItem)
              if (resolution.action === "drop") {
                removePendingCollectionOperation(operation.id)
                settleLocalItem(operation.pokemonId, resolution.serverItem)
                break
              }
              const merged: PendingCollectionOperation = resolution.action === "write"
                ? { id: operation.id, type: "upsert", pokemonId: operation.pokemonId, item: resolution.item, base: resolution.base, queuedAt: operation.queuedAt }
                : { id: operation.id, type: "delete", pokemonId: operation.pokemonId, base: resolution.base, queuedAt: operation.queuedAt }
              replacePendingCollectionOperation(operation.id, merged)
              operation = merged
              continue
            }

            if (kind === "hard" || kind === "conflict") {
              removePendingCollectionOperation(operation.id)
              rollBackEdit(operation, error)
              break
            }

            console.error("[binderdex] Pending collection sync paused:", {
              message: extractErrorMessage(error),
              pokemonId: operation.pokemonId,
              operation: operation.type,
            })
            shouldRetry = true
            break
          }
        }

        refreshLocalPendingSyncCount()
        if (shouldRetry) break
      }

      if (didWriteRemoteCollection) {
        void broadcastCollectionChanged()
      }
    } finally {
      isFlushingPendingOperationsRef.current = false
      refreshLocalPendingSyncCount()
    }

    if (shouldRetry) {
      scheduleSyncRetry()
      return
    }

    syncRetryAttemptRef.current = 0
    if (readPendingCollectionOperations().length > 0) {
      // Edits made while we were sending: go again.
      void Promise.resolve().then(() => flushPendingCollectionOperationsRef.current())
    } else {
      setSyncStatus("idle")
    }
  }, [
    broadcastCollectionChanged,
    collectionOwnerUserId,
    localPendingSyncCount,
    readOnly,
    refreshLocalPendingSyncCount,
    rollBackEdit,
    scheduleSyncRetry,
    settleLocalItem,
    user,
    writeRemoteCollection,
  ])

  useEffect(() => {
    flushPendingCollectionOperationsRef.current = flushPendingCollectionOperations
  }, [flushPendingCollectionOperations])

  useEffect(() => {
    if (!syncNotice) return
    const timer = setTimeout(() => setSyncNotice(null), 10_000)
    return () => clearTimeout(timer)
  }, [syncNotice])

  useEffect(() => {
    flushPendingCollectionOperations()
  }, [flushPendingCollectionOperations, localPendingSyncCount])

  // Queued edits made before a reload stay visible on top of whatever collection the page started with.
  useEffect(() => {
    if (readOnly) return
    const operations = readPendingCollectionOperations()
    if (operations.length > 0) {
      setCollection((current) => applyPendingEdits(current, operations))
    }
  }, [readOnly])

  // Sync triggers besides new edits: coming back online and the app becoming visible again. Both reset the
  // backoff so a reconnect syncs straight away.
  useEffect(() => {
    if (readOnly || typeof window === "undefined") return

    const syncNow = () => {
      cancelSyncRetry()
      void flushPendingCollectionOperationsRef.current()
    }
    const handleVisibility = () => {
      if (isDocumentVisible()) syncNow()
    }

    window.addEventListener("online", syncNow)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.removeEventListener("online", syncNow)
      document.removeEventListener("visibilitychange", handleVisibility)
      cancelSyncRetry()
    }
  }, [cancelSyncRetry, readOnly])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (readOnly || !user) return

    const refreshIfSafe = (force: boolean) => {
      const pendingOperationCount = readPendingCollectionOperations().length

      if (pendingOperationCount !== localPendingSyncCount) {
        setLocalPendingSyncCount(pendingOperationCount)
      }

      if (!shouldAutoRefreshCollection({
        readOnly,
        hasUser: Boolean(user),
        isOnline: !isOffline(),
        isVisible: isDocumentVisible(),
        pendingOperationCount,
        isFlushingPendingOperations: isFlushingPendingOperationsRef.current,
        isWritingRemoteCollection: activeRemoteCollectionWriteCountRef.current > 0,
      })) {
        return
      }

      const now = Date.now()
      if (!force && !isCollectionAutoRefreshDue({
        now,
        lastRefreshAt: lastCollectionAutoRefreshAtRef.current,
        isRealtimeConnected: isCollectionRealtimeConnectedRef.current,
      })) {
        return
      }

      lastCollectionAutoRefreshAtRef.current = now
      void reloadRemoteCollection()
    }

    // Tick at the fast cadence; each tick decides whether a refresh is due (5 s without
    // realtime, 60 s safety net while the realtime channel is subscribed, never while hidden).
    const intervalId = window.setInterval(() => refreshIfSafe(false), COLLECTION_AUTO_REFRESH_INTERVAL_MS)
    const handleVisibilityChange = () => {
      if (isDocumentVisible()) refreshIfSafe(true)
    }
    const handleOnline = () => {
      // Let the pending-operation flush go first; the next tick then refreshes.
      lastCollectionAutoRefreshAtRef.current = 0
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("online", handleOnline)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("online", handleOnline)
    }
  }, [localPendingSyncCount, readOnly, reloadRemoteCollection, user])

  /**
   * Optimistic write shared by every edit: update the UI now, then send it. Offline, signed out, or with an
   * older edit of the same Pokémon still queued, the edit is queued instead (and keeps per-Pokémon order).
   * A hard server rejection rolls the edit back; network/server failures and conflicts go to the queue.
   */
  const commitItemChange = useCallback(async (pokemonId: number, nextItem: CollectedPokemon | null) => {
    const existingItem = collection.find((item) => item.pokemon_id === pokemonId) ?? null
    applyLocalCollection(nextItem ? upsertCollectionItem(collection, nextItem) : removeCollectionItem(collection, pokemonId))

    const edit: PendingCollectionOperationInput = nextItem
      ? { type: "upsert", pokemonId, item: nextItem, base: existingItem }
      : { type: "delete", pokemonId, base: existingItem }

    if (!user || !collectionOwnerUserId || isOffline() || hasPendingCollectionOperation(pokemonId)) {
      queueLocalCollectionOperation(edit)
      return { item: nextItem, queued: true as const }
    }

    const baseFingerprint = collectionFingerprint(existingItem)
    try {
      if (nextItem) {
        const savedItem = await writeRemoteCollection(() => saveRemoteCollectionItem(nextItem, { baseFingerprint }))
        settleLocalItem(pokemonId, savedItem)
        void broadcastCollectionChanged()
        return { item: savedItem, queued: false as const }
      }
      await writeRemoteCollection(() => deleteRemoteCollectionItem(pokemonId, { baseFingerprint }))
      void broadcastCollectionChanged()
      return { item: null, queued: false as const }
    } catch (error) {
      if (classifyWriteFailure(error) === "hard") {
        rollBackEdit({ pokemonId, item: nextItem ?? undefined, base: existingItem }, error)
        return { item: existingItem, queued: false as const, error, rolledBack: true as const }
      }
      // Conflicts are resolved by the queue right away; network/server failures wait for the backoff.
      queueLocalCollectionOperation(edit, { afterFailure: classifyWriteFailure(error) === "retry" })
      return { item: nextItem, queued: true as const, error }
    }
  }, [applyLocalCollection, broadcastCollectionChanged, collection, collectionOwnerUserId, queueLocalCollectionOperation, rollBackEdit, settleLocalItem, user, writeRemoteCollection])

  const addToCollection = useCallback(async (
    pokemonId: number,
    pokemonName: string,
    cardId?: string,
    cardName?: string,
    cardImage?: string,
    cardSet?: string,
    cardLanguage: CardLanguage = "en",
    status: SlotStatus = 'collected',
    options: SaveCollectionOptions = {},
  ): Promise<{ data?: CollectedPokemon; queued?: boolean; error?: string }> => {
    if (readOnly) return { error: "Read-only binder" }

    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    const nextItem = normalizeCollectionItem({
      id: existingItem?.id,
      pokemon_id: pokemonId,
      pokemon_name: pokemonName,
      card_id: cardId,
      card_name: cardName,
      card_image: cardImage,
      card_set: cardSet,
      card_language: cardLanguage,
      card_finish: options.cardFinish ?? existingItem?.card_finish ?? "normal",
      wanted_cards: options.wantedCards ?? existingItem?.wanted_cards ?? [],
      status,
      collected_at: existingItem?.collected_at ?? new Date().toISOString(),
    })
    const result = await commitItemChange(pokemonId, nextItem)
    if ("rolledBack" in result) {
      console.error("[binderdex] Error adding to collection:", { message: extractErrorMessage(result.error), pokemonId, status })
      return { error: extractErrorMessage(result.error) }
    }
    if (result.queued) {
      return { data: nextItem, queued: true, ...("error" in result ? { error: extractErrorMessage(result.error) } : {}) }
    }
    return { data: result.item ?? nextItem }
  }, [commitItemChange, collection, readOnly])

  const removeFromCollection = useCallback(async (pokemonId: number) => {
    if (readOnly) return { error: "Read-only binder" }

    const result = await commitItemChange(pokemonId, null)
    if ("rolledBack" in result) {
      console.error("[binderdex] Error removing from collection:", result.error)
      return { error: result.error }
    }
    return result.queued ? { success: true, queued: true, ...("error" in result ? { error: result.error } : {}) } : { success: true }
  }, [commitItemChange, readOnly])

  const addWantedCard = useCallback(async (
    pokemonId: number,
    pokemonName: string,
    wantedCard: WantedCard,
  ) => {
    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    const existingWantedCards = existingItem?.wanted_cards ?? []
    const wantedKey = `${wantedCard.card_id}:${wantedCard.card_language ?? "en"}:${wantedCard.card_finish ?? "normal"}`
    const nextWantedCards = [
      wantedCard,
      ...existingWantedCards.filter((card) => `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}` !== wantedKey),
    ]
    const existingIsOwned = existingItem?.status !== undefined && existingItem.status !== "wishlisted"

    return addToCollection(
      pokemonId,
      pokemonName,
      existingIsOwned ? existingItem?.card_id : undefined,
      existingIsOwned ? existingItem?.card_name : undefined,
      existingIsOwned ? existingItem?.card_image : undefined,
      existingIsOwned ? existingItem?.card_set : undefined,
      existingItem?.card_language ?? "en",
      existingIsOwned && existingItem ? existingItem.status : "wishlisted",
      {
        cardFinish: existingItem?.card_finish ?? "normal",
        wantedCards: nextWantedCards,
      },
    )
  }, [addToCollection, collection])

  const removeWantedCard = useCallback(async (pokemonId: number, cardId: string) => {
    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    if (!existingItem) return { error: "Not in collection" }

    const nextWantedCards = existingItem.wanted_cards.filter((card) => card.card_id !== cardId)
    const existingIsOwned = existingItem.status !== "wishlisted"

    if (!existingIsOwned && nextWantedCards.length === 0) {
      return removeFromCollection(pokemonId)
    }

    return addToCollection(
      pokemonId,
      existingItem.pokemon_name,
      existingIsOwned ? existingItem.card_id : undefined,
      existingIsOwned ? existingItem.card_name : undefined,
      existingIsOwned ? existingItem.card_image : undefined,
      existingIsOwned ? existingItem.card_set : undefined,
      existingItem.card_language ?? "en",
      existingIsOwned ? existingItem.status : "wishlisted",
      {
        cardFinish: existingItem.card_finish ?? "normal",
        wantedCards: nextWantedCards,
      },
    )
  }, [addToCollection, collection, removeFromCollection])

  const syncLocalCollectionToDatabase = useCallback(async (
    pokemonCatalog: PokemonCatalogEntry[],
    options: SyncLocalCollectionOptions = {}
  ): Promise<{ data?: SyncLocalCollectionResult; error?: unknown }> => {
    if (readOnly) return { error: "Read-only binder" }
    if (!user || !collectionOwnerUserId) return { error: "Not logged in" }

    const localIds = getSanitizedLocalCollectedIds()
    const localSet = new Set(localIds)
    const collectedRows = collection.filter((item) => item.status !== "wishlisted")
    const wishlistedRows = collection.filter((item) => item.status === "wishlisted")
    const remoteById = new Map(collectedRows.map((item) => [item.pokemon_id, item] as const))
    const catalogNames = new Map(pokemonCatalog.map((pokemon) => [pokemon.id, pokemon.name] as const))
    const replaceRemote = options.replaceRemote === true

    const idsToAdd = localIds.filter((pokemonId) => !remoteById.has(pokemonId))
    const idsToRemove = replaceRemote
      ? collectedRows
          .filter((item) => !localSet.has(item.pokemon_id))
          .map((item) => item.pokemon_id)
      : []

    try {
      if (replaceRemote && idsToRemove.length > 0) {
        const { error } = await writeRemoteCollection(() => supabase
          .from("pokemon_collection")
          .delete()
          .eq("user_id", collectionOwnerUserId)
          .in("pokemon_id", idsToRemove))

        if (error) throw error
      }

      let syncedRows: CollectedPokemon[] = []

      if (replaceRemote && localIds.length > 0) {
        const rowsToReplace = localIds.map((pokemonId) => ({
          user_id: collectionOwnerUserId,
          pokemon_id: pokemonId,
          pokemon_name: catalogNames.get(pokemonId) || remoteById.get(pokemonId)?.pokemon_name || `Pokemon #${pokemonId}`,
          card_id: null,
          card_name: null,
          card_image: null,
          card_set: null,
          card_language: "en",
          card_finish: "normal",
          wanted_cards: [],
          status: "collected" as SlotStatus,
        }))

        const { data, error } = await writeRemoteCollection(() => supabase
          .from("pokemon_collection")
          .upsert(rowsToReplace, {
            onConflict: "user_id,pokemon_id",
          })
          .select())

        if (error) throw error
        syncedRows = normalizeCollectionItems(data)
      } else if (idsToAdd.length > 0) {
        const rowsToInsert = idsToAdd.map((pokemonId) => ({
          user_id: collectionOwnerUserId,
          pokemon_id: pokemonId,
          pokemon_name: catalogNames.get(pokemonId) || remoteById.get(pokemonId)?.pokemon_name || `Pokemon #${pokemonId}`,
          card_language: "en",
          card_finish: "normal",
          wanted_cards: [],
          status: "collected" as SlotStatus,
        }))

        const { data, error } = await writeRemoteCollection(() => supabase
          .from("pokemon_collection")
          .upsert(rowsToInsert, {
            onConflict: "user_id,pokemon_id",
          })
          .select())

        if (error) throw error
        syncedRows = normalizeCollectionItems(data)
      }

      const keptRows = replaceRemote
        ? wishlistedRows
        : collection.filter((item) => !idsToRemove.includes(item.pokemon_id))
      const nextCollection = [...keptRows, ...syncedRows].sort((a, b) => a.pokemon_id - b.pokemon_id)

      applyLocalCollection(nextCollection)
      void broadcastCollectionChanged()

      return {
        data: {
          added: syncedRows.length,
          removed: idsToRemove.length,
          localCount: localIds.length,
          remoteCountBefore: collectedRows.length,
          remoteCountAfter: nextCollection.filter((item) => item.status !== "wishlisted").length,
          mode: replaceRemote ? "replace" : "merge",
        },
      }
    } catch (error) {
      console.error("[binderdex] Error syncing local collection:", error)
      return { error }
    }
  }, [applyLocalCollection, broadcastCollectionChanged, collection, collectionOwnerUserId, getSanitizedLocalCollectedIds, readOnly, supabase, user, writeRemoteCollection])

  const updateStatus = useCallback(async (pokemonId: number, status: SlotStatus) => {
    if (readOnly) return { error: "Read-only binder" }
    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    if (!existingItem) return { error: "Not in collection" }
    const nextItem = normalizeCollectionItem({ ...existingItem, status })

    const result = await commitItemChange(pokemonId, nextItem)
    if ("rolledBack" in result) {
      console.error("[binderdex] Error updating status:", result.error)
      return { error: result.error }
    }
    if (result.queued) {
      return { data: nextItem, queued: true, ...("error" in result ? { error: result.error } : {}) }
    }
    return { data: result.item ?? nextItem }
  }, [collection, commitItemChange, readOnly])

  const cycleStatus = useCallback(async (pokemonId: number) => {
    const item = collection.find(p => p.pokemon_id === pokemonId)
    if (!item) return { error: "Not in collection" }
    if (item.status === "wishlisted") return { error: "Wishlisted cards do not have collection status" }

    const statusOrder: SlotStatus[] = ['collected', 'considering', 'finalized']
    const currentIndex = statusOrder.indexOf(item.status || 'collected')
    const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length]

    return updateStatus(pokemonId, nextStatus)
  }, [collection, updateStatus])

  const isCollected = useCallback((pokemonId: number) => {
    return collection.some((p) => p.pokemon_id === pokemonId && p.status !== "wishlisted")
  }, [collection])

  const isWishlisted = useCallback((pokemonId: number) => {
    return collection.some((p) => p.pokemon_id === pokemonId && (p.status === "wishlisted" || p.wanted_cards.length > 0))
  }, [collection])

  const getCollectedCard = useCallback((pokemonId: number) => {
    return collection.find(p => p.pokemon_id === pokemonId)
  }, [collection])

  const getCollectionItem = useCallback((pokemonId: number) => {
    return collection.find(p => p.pokemon_id === pokemonId)
  }, [collection])

  const signOut = useCallback(async () => {
    if (readOnly) return
    setUser(null)
    setCollectionOwnerUserId(null)
    setCollection([])
  }, [readOnly])

  return {
    user,
    collection,
    isLoading: false,
    addToCollection,
    addWantedCard,
    removeFromCollection,
    removeWantedCard,
    updateStatus,
    cycleStatus,
    isCollected,
    isWishlisted,
    getCollectedCard,
    getCollectionItem,
    signOut,
    syncLocalCollectionToDatabase,
    localCollectedCount,
    localPendingSyncCount,
    syncStatus,
    syncNotice,
    dismissSyncNotice: () => setSyncNotice(null),
    collectionCount: collection.filter((item) => item.status !== "wishlisted").length,
    collectionOwnerUserId,
  }
}
