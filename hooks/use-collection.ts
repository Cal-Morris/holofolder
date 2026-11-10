"use client"

import { useDurableLegacyQueue } from "@/hooks/use-durable-legacy-queue"
import { guestCollectionOrigin, sameCollectionOrigin, type CollectionOrigin } from "@/lib/collection/recipient"

import { clearActivityCache } from "@/lib/collection-activity"
import { countSavedCards, pendingCardDelta, canGrowCollection, resolveBillingAccess, savedCardWeight, FREE_CARD_LIMIT } from "@/lib/billing"
import { BILLING_CHANGED, readBillingCache } from "@/lib/billing-cache"

import { captureAcquisition, mergeQueuedAcquisition, readPushMembership, writePushMembership, type AcquisitionIntent } from "@/lib/partner-push"

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { readLocalCollectedIds, writeLocalCollectedIds } from "@/lib/local-collection"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { loadCollectionRecord } from "@/lib/offline-store/records"
import { collectionRecordKey, hasOwnOfflineKeys } from "@/lib/binders/offline"
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
  pauseLegacyCollectionOperation,
  readPendingCollectionOperationRaw,
  hasPendingCollectionOperation as hasOldPendingCollectionOperation,
  readLocalCollectionSnapshot,
  restorePendingCollectionOperations,
  readPendingCollectionOperations as readOldPendingCollectionOperations,
  queuePendingCollectionOperation,
  pauseReviewedCollectionBatch,
  rebasePendingCollectionOperation,
  removePendingCollectionOperation,
  replacePendingCollectionOperation,
  persistLocalCollectionState,
  pendingOperationBinderId,
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
  getResolvedCollectionOwner,
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
import { isOwnedCollectionItem, planOwnedRemoval, type OwnedRemovalMode } from "@/lib/collection/owned-removal"
import { resolveWantedCardsAfterOwnedAdd } from "@/lib/collection/owned-add"
import { editWantedCards } from "@/lib/collection/wanted-card-edit"
import { loadCollectionRows, syncCollectionRows } from "@/lib/collection/load"
import { collectionBaselineRows, createCollectionBaseline, type CollectionSyncBaseline } from "@/lib/collection/delta-sync"

/** idle: nothing to send · syncing: sending queued edits · waiting: a send failed, retrying with backoff */
export type CollectionSyncStatus = "idle" | "syncing" | "waiting" | "compatibility"

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
  /** The binder this screen shows; null before migration 039 (every row of the owner). */
  binderId?: string | null
  /** Whether that binder is the owner's default, which also receives edits queued before binders existed. */
  isDefaultBinder?: boolean
  readOnly?: boolean
  stagedDurableQueue?: boolean
}

export interface SaveCollectionOptions {
  cardFinish?: CardFinish
  wantedCards?: WantedCard[]
  /** Other ids the added card is known by (catalog canonical id and aliases), so a wanted alias is fulfilled too. */
  cardIds?: readonly string[]
}

export function useCollection(options: UseCollectionOptions = {}) {
  const {
    initialUser = null,
    initialCollection = [],
    initialCollectionOwnerUserId = null,
    binderId = null,
    isDefaultBinder = true,
    readOnly = false,
    stagedDurableQueue = false,
  } = options
  const [user, setUser] = useState<User | null>(initialUser)
  const [collection, setCollection] = useState<CollectedPokemon[]>(normalizeCollectionItems(initialCollection))
  // Undo callbacks outlive the render that created them.
  const collectionRef = useRef(collection)
  useLayoutEffect(() => { collectionRef.current = collection }, [collection])
  const [collectionOwnerUserId, setCollectionOwnerUserId] = useState<string | null>(initialCollectionOwnerUserId)
  const [ownerResolvedForUserId, setOwnerResolvedForUserId] = useState<string | null>(initialCollectionOwnerUserId ? initialUser?.id ?? null : null)
  const [durableGuest, setDurableGuest] = useState<Extract<CollectionOrigin, { kind: "guest" }> | null>(null)
  const editOrigin = useMemo<CollectionOrigin | null>(() => user
    ? (ownerResolvedForUserId === user.id && collectionOwnerUserId && binderId
      ? { kind: "account", actorUserId: user.id, ownerUserId: collectionOwnerUserId, binderId } : null)
    : (stagedDurableQueue ? (durableGuest ? { ...durableGuest, localBinderId: binderId ?? "guest-default" } : null) : typeof window === "undefined" ? null : guestCollectionOrigin(window.localStorage, binderId)), [user, ownerResolvedForUserId, collectionOwnerUserId, binderId, stagedDurableQueue, durableGuest])
  const originKey = JSON.stringify(editOrigin)
  const isEditForThisBinder = useCallback((operation: { origin?: CollectionOrigin; binderId?: string | null }) =>
    sameCollectionOrigin(operation.origin, JSON.parse(originKey)), [originKey])
  const recoveryIdentity=JSON.stringify([user?.id??null,collectionOwnerUserId,binderId])
  const recoveryIdentityRef=useRef<string|null>(recoveryIdentity)
  const deliveryEpochRef = useRef(0)
  useLayoutEffect(()=>{deliveryEpochRef.current++;recoveryIdentityRef.current=recoveryIdentity;return()=>{recoveryIdentityRef.current=null}},[recoveryIdentity])
  const authenticatedUserId = useRef(initialUser?.id ?? null)
  const authEpochRef = useRef(0)
  const ownerLookupRef = useRef(0)
  const ownerScopeRef = useRef(initialCollectionOwnerUserId)
  useLayoutEffect(() => { ownerScopeRef.current = collectionOwnerUserId }, [collectionOwnerUserId])
  // Server rows last read, so refreshes can fetch only what changed (lib/collection/delta-sync.ts).
  // Seeded from the server-rendered rows; rows without updated_at (local snapshots) just mean a full first fetch.
  const collectionBaselineRef = useRef<CollectionSyncBaseline | null>(
    initialCollectionOwnerUserId && initialCollection.length > 0
      ? createCollectionBaseline(initialCollectionOwnerUserId, initialCollection as Record<string, unknown>[], binderId)
      : null,
  )
  const [localCollectedCount, setLocalCollectedCount] = useState(0)
  const [localPendingSyncCount, setLocalPendingSyncCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState<CollectionSyncStatus>("idle")
  const [unsavedDraft, setUnsavedDraft] = useState<{ pokemonId: number; nextItem: CollectedPokemon | null; acquisition?: AcquisitionIntent; expected: CollectedPokemon | null; importOnly: boolean; origin: CollectionOrigin; epoch: number } | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const durable = useDurableLegacyQueue(stagedDurableQueue && !readOnly, editOrigin, recoveryIdentity, authenticatedUserId, setSyncNotice)
  const durableRuntime = durable.runtime
  useEffect(() => { if (durable.guest) queueMicrotask(() => setDurableGuest(durable.guest)) }, [durable.guest])
  const readPendingCollectionOperations = useCallback(() => stagedDurableQueue
    ? (durableRuntime?.view()?.entries.filter(entry => entry.state !== "completed").map(entry => entry.operation) ?? [])
    : readOldPendingCollectionOperations(), [stagedDurableQueue, durableRuntime])
  const hasPendingCollectionOperation = useCallback((pokemonId: number, editBinder: string | null, origin: CollectionOrigin | null) => stagedDurableQueue
    ? readPendingCollectionOperations().some(operation => operation.pokemonId === pokemonId && sameCollectionOrigin(operation.origin, origin))
    : hasOldPendingCollectionOperation(pokemonId, editBinder, origin), [stagedDurableQueue, readPendingCollectionOperations])
  const readBinderPendingOperations = useCallback(
    () => readPendingCollectionOperations().filter(isEditForThisBinder).map(operation =>
      operation.compatibilityPause && operation.type === "upsert" ? { ...operation, item: normalizeCollectionItem(operation.item) } : operation),
    [isEditForThisBinder, readPendingCollectionOperations],
  )
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
    if (readOnly) return []
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
  }, [collection, readOnly])

  const resolveCollectionOwnerUserId = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setCollectionOwnerUserId(null)
      return null
    }

    const ownerEpoch = authEpochRef.current
    const lookup = ++ownerLookupRef.current
    const { data: partnership, error } = await supabase
      .from("partnerships")
      .select("id,owner_user_id,user1_id,user2_id")
      .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
      .limit(1)
      .maybeSingle()

    if (error) throw error

    let ownerUserId = partnership?.owner_user_id || currentUser.id
    if (partnership?.owner_user_id) {
      const { data: allowed, error: accessError } = await supabase.rpc("billing_partner_allowed", { owner_id: ownerUserId, actor_id: currentUser.id })
      if (accessError && !["PGRST202", "42883"].includes(accessError.code)) throw accessError
      if (!accessError && !allowed) ownerUserId = currentUser.id
    }
    if (authenticatedUserId.current === currentUser.id && ownerEpoch === authEpochRef.current && lookup === ownerLookupRef.current) {
      if (ownerScopeRef.current && ownerScopeRef.current !== ownerUserId) {
        deliveryEpochRef.current++; recoveryIdentityRef.current = null
        window.dispatchEvent(new Event("holofolder-legacy-scope-changed"))
        setCollection([]); setUnsavedDraft(null)
      }
      ownerScopeRef.current = ownerUserId
      setCollectionOwnerUserId(ownerUserId)
      const recipientId = partnership?.user1_id === currentUser.id ? partnership.user2_id : partnership?.user1_id
      writePushMembership(currentUser.id, partnership?.id && recipientId ? { actorId: currentUser.id, ownerId: ownerUserId, partnershipId: partnership.id, recipientId } : null)
      setOwnerResolvedForUserId(currentUser.id)
    }
    if (authenticatedUserId.current !== currentUser.id || ownerEpoch !== authEpochRef.current || lookup !== ownerLookupRef.current) throw new Error("Collection scope changed while resolving its owner.")
    return ownerUserId
  }, [supabase])

  const refreshLocalCollectedCount = useCallback(() => {
    setLocalCollectedCount(getSanitizedLocalCollectedIds().length)
  }, [getSanitizedLocalCollectedIds])

  const refreshLocalPendingSyncCount = useCallback(() => {
    setLocalPendingSyncCount(readPendingCollectionOperations().filter(isEditForThisBinder).length)
  }, [isEditForThisBinder, readPendingCollectionOperations])

  useEffect(() => {
    if (!stagedDurableQueue) return
    const entries = durable.view?.entries.filter(entry => entry.state !== "completed") ?? []
    queueMicrotask(() => {
      setLocalPendingSyncCount(entries.length)
      if (entries.some(entry => entry.operation.compatibilityPause || entry.settlement?.kind === "known-rejection" && entry.settlement.category === "compatibility")) setSyncStatus("compatibility")
      else if (entries.some(entry => entry.state === "unknown" || entry.state === "paused")) {
        setSyncStatus("waiting")
        setSyncNotice("Changes are retained on this device. Delivery may be unknown; do not repeat the upload.")
      } else setSyncStatus(entries.some(entry => entry.state === "sending") ? "syncing" : "idle")
    })
  }, [stagedDurableQueue, durable.view])

  const applyLocalCollection = useCallback((nextCollection: CollectedPokemon[]) => {
    collectionRef.current = nextCollection
    setCollection(nextCollection)
    persistLocalCollectionState(nextCollection, collectionOwnerUserId, binderId, isDefaultBinder, stagedDurableQueue)
    refreshLocalCollectedCount()
  }, [binderId, collectionOwnerUserId, isDefaultBinder, refreshLocalCollectedCount, stagedDurableQueue])

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

  useEffect(() => {
    if (readOnly) return
    queueMicrotask(() => { refreshLocalCollectedCount(); refreshLocalPendingSyncCount() })

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "pokemon_collected" || event.key === LOCAL_COLLECTION_PENDING_OPS_KEY) {
        refreshLocalCollectedCount()
        refreshLocalPendingSyncCount()
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [readOnly, refreshLocalCollectedCount, refreshLocalPendingSyncCount])

  useEffect(() => {
    if (readOnly || !user) {
      return
    }

    const cloudCollectedIds = collection
      .filter((item) => item.status !== "wishlisted")
      .map((item) => item.pokemon_id)
      .sort((a, b) => a - b)
    const localIds = readLocalCollectedIds()

    // The signed-out "collected ids" list mirrors the default binder only.
    if (isDefaultBinder && !numberArraysEqual(localIds, cloudCollectedIds)) {
      queueMicrotask(() => writeLocalCollectedIds(cloudCollectedIds))
    }

    if (localCollectedCount !== cloudCollectedIds.length) {
      queueMicrotask(() => setLocalCollectedCount(cloudCollectedIds.length))
    }
  }, [collection, isDefaultBinder, localCollectedCount, readOnly, user])

  useEffect(() => {
    if (readOnly) return

    const applySnapshot = (snapshot: { ownerUserId: string | null; binderId?: string | null; collection: CollectedPokemon[] }) => {
      const isOffline = typeof navigator !== "undefined" && navigator.onLine === false
      const ownerMatches = Boolean(collectionOwnerUserId && snapshot.ownerUserId === collectionOwnerUserId)
      if (stagedDurableQueue && (user ? !ownerMatches : snapshot.ownerUserId !== null)) return

      const sharedAccess = snapshot.ownerUserId && snapshot.ownerUserId !== user?.id ? readBillingCache(localStorage, user?.id ?? null, snapshot.ownerUserId) : null
      if (snapshot.ownerUserId && snapshot.ownerUserId !== user?.id && (!sharedAccess || (sharedAccess.enforced && sharedAccess.tier !== "paid"))) return
      if (!isOffline && !ownerMatches) {
        return
      }
      // Never show another binder's slots (an empty new binder would otherwise pick up the last snapshot).
      if (snapshot.binderId !== binderId && !(!snapshot.binderId && isDefaultBinder)) {
        return
      }

      setCollection((current) => current.length > 0 ? current : snapshot.collection)

      if (!collectionOwnerUserId && snapshot.ownerUserId) {
        setCollectionOwnerUserId(snapshot.ownerUserId)
      }
    }

    const snapshot = readLocalCollectionSnapshot(binderId, isDefaultBinder)
    if (snapshot && snapshot.collection.length > 0) {
      applySnapshot(snapshot)
      return
    }

    // localStorage has nothing (cleared, or too full to write): fall back to the IndexedDB copy.
    const store = getOfflineStore()
    if (!store) return

    let cancelled = false
    const ownKey = hasOwnOfflineKeys(binderId, isDefaultBinder) ? collectionRecordKey(binderId, isDefaultBinder) : null
    void Promise.all([loadCollectionRecord(store), ownKey ? loadCollectionRecord(store, ownKey) : Promise.resolve(null)])
      .then(([defaultRecord, ownRecord]) => {
        if (cancelled) return
        // Pending edits for every binder live in the default record.
        if (!stagedDurableQueue && defaultRecord && restorePendingCollectionOperations(defaultRecord.pendingOperations ?? []) > 0) {
          refreshLocalPendingSyncCount()
        }
        const record = ownKey ? ownRecord : defaultRecord
        if (record && record.collection.length > 0) {
          applySnapshot(record)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [binderId, collectionOwnerUserId, isDefaultBinder, readOnly, refreshLocalPendingSyncCount, stagedDurableQueue, user, user?.id])

  const reloadRemoteCollection = useCallback(async () => {
    if (readOnly) return

    try {
      const refreshPlan = getRemoteCollectionRefreshPlan(user, collectionOwnerUserId)

      if (refreshPlan) {
        // A refresh can still be in flight when the account changes (sign-out, account switch): drop its rows
        // so the previous account's cards never show under the new one.
        const refreshEpoch = deliveryEpochRef.current
        const isStale = () => authenticatedUserId.current !== refreshPlan.user.id || (deliveryEpochRef.current !== refreshEpoch)
        const ownerUserId = refreshPlan.knownOwnerUserId ?? await resolveCollectionOwnerUserId(refreshPlan.user)
        if (isStale()) return
        const baseline = await syncCollectionRows(supabase, ownerUserId, collectionBaselineRef.current, binderId)
        if (isStale()) return
        collectionBaselineRef.current = baseline
        // Queued edits stay visible until they are synced.
        setCollection(applyPendingEdits(normalizeCollectionItems(collectionBaselineRows(baseline)), readBinderPendingOperations()))
      } else {
        setCollection([])
      }
    } catch (error) {
      console.error("[holofolder] Error loading collection:", error)
    }
  }, [binderId, collectionOwnerUserId, readBinderPendingOperations, readOnly, resolveCollectionOwnerUserId, supabase, user])

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
      console.error("[holofolder] Error broadcasting collection refresh:", error)
    } finally {
      if (!existingChannel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [collectionOwnerUserId, readOnly, supabase])

  useEffect(() => {
    if (readOnly) return

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (authenticatedUserId.current !== (session?.user.id ?? null)) {
        authEpochRef.current++
        deliveryEpochRef.current++
        recoveryIdentityRef.current = null
        window.dispatchEvent(new Event("holofolder-legacy-scope-changed"))
        collectionBaselineRef.current = null
        setUnsavedDraft(null)
        setCollection([])
        setCollectionOwnerUserId(null)
        setOwnerResolvedForUserId(null)
      }
      authenticatedUserId.current = session?.user.id ?? null
      setUser((existingUser) => keepStableUserById(existingUser, session?.user ?? null))

      if (session?.user) {
        const sessionUser = session.user
        // Release Supabase's auth lock before making authenticated queries.
        window.setTimeout(() => {
          if (authenticatedUserId.current !== sessionUser.id) return
          void (async () => {
            const ownerUserId = await resolveCollectionOwnerUserId(sessionUser)
            if (authenticatedUserId.current !== sessionUser.id) return
            const baseline = await syncCollectionRows(supabase, ownerUserId, collectionBaselineRef.current, binderId)
            if (authenticatedUserId.current !== sessionUser.id || recoveryIdentityRef.current !== JSON.stringify([sessionUser.id, ownerUserId, binderId])) return
            collectionBaselineRef.current = baseline
            setCollection(applyPendingEdits(normalizeCollectionItems(collectionBaselineRows(baseline)), readPendingCollectionOperations().filter(op => op.origin?.kind === "account"
              && op.origin.actorUserId === sessionUser.id && op.origin.ownerUserId === ownerUserId && op.origin.binderId === binderId)))
          })().catch(error => console.error("[holofolder] Error refreshing signed-in collection:", error))
        }, 0)
      } else {
        setCollectionOwnerUserId(null)
        setCollection([])
      }
    })

    return () => subscription.unsubscribe()
  }, [binderId, readOnly, readPendingCollectionOperations, resolveCollectionOwnerUserId, supabase])

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
          console.error("[holofolder] Collection realtime subscription failed:", { status, error })
        }
      })

    return () => {
      if (collectionRealtimeChannelRef.current === channel) {
        collectionRealtimeChannelRef.current = null
        isCollectionRealtimeConnectedRef.current = false
      }

      void supabase.removeChannel(channel)
    }
  }, [collectionOwnerUserId, localPendingSyncCount, readOnly, readPendingCollectionOperations, reloadRemoteCollection, supabase, user])

  useEffect(() => {
    if (readOnly) return
    if (!collectionOwnerUserId && collection.length === 0) return

    if (!stagedDurableQueue || durableRuntime?.view()) persistLocalCollectionState(collection, collectionOwnerUserId, binderId, isDefaultBinder, stagedDurableQueue)
  }, [binderId, collection, collectionOwnerUserId, durableRuntime, isDefaultBinder, readOnly, stagedDurableQueue])

  /**
   * Show the outcome of a write unless a newer local edit of the same slot is still queued. Edits for another
   * binder (queued before switching) only rebase their queue entry; this screen shows a different binder.
   */
  const settleLocalItem = useCallback((pokemonId: number, item: CollectedPokemon | null, editBinderId: string | null = binderId, settledOrigin: CollectionOrigin | null = editOrigin) => {
    if (hasPendingCollectionOperation(pokemonId, editBinderId, settledOrigin)) {
      // The newer edit is now based on what the server has.
      rebasePendingCollectionOperation(pokemonId, item, editBinderId, settledOrigin)
      return
    }
    if (!isEditForThisBinder({ binderId: editBinderId, origin: settledOrigin ?? undefined })) return
    setCollection((current) => (item ? upsertCollectionItem(current, item) : removeCollectionItem(current, pokemonId)))
  }, [binderId, editOrigin, hasPendingCollectionOperation, isEditForThisBinder])

  /** Undo an edit the server will never accept, and say so. */
  const rollBackEdit = useCallback((operation: { pokemonId: number; item?: CollectedPokemon; base?: CollectedPokemon | null; binderId?: string | null; origin?: CollectionOrigin }, error: unknown) => {
    console.error("[holofolder] Collection change rejected, rolled back:", {
      pokemonId: operation.pokemonId,
      message: extractErrorMessage(error),
    })
    if ("base" in operation && operation.base !== undefined) {
      settleLocalItem(operation.pokemonId, operation.base, pendingOperationBinderId(operation), operation.origin ?? null)
    } else {
      // Legacy edit without a known base: the next refresh brings back the server row.
      lastCollectionAutoRefreshAtRef.current = 0
    }
    setSyncNotice(`Couldn't save your change to ${describeEdit(operation)}. It was undone.`)
  }, [settleLocalItem])

  const flushPendingCollectionOperations = useCallback(async () => {
    if (readOnly || !user || !collectionOwnerUserId || isOffline()) return
    if (stagedDurableQueue) {
      if (!durableRuntime?.view()) return
      const stagedEpoch = deliveryEpochRef.current
      try {
        await durableRuntime.flush((outcome, pokemonId, origin) => {
          const successors = durableRuntime.view()?.entries.some(entry => entry.state !== "completed" && entry.operation.pokemonId === pokemonId)
          if (!successors && sameCollectionOrigin(origin, editOrigin)) setCollection(current => outcome.item ? upsertCollectionItem(current, outcome.item) : removeCollectionItem(current, pokemonId))
          window.dispatchEvent(new Event("holofolder-refresh-billing"))
          void broadcastCollectionChanged()
        })
      } catch { if (stagedEpoch === deliveryEpochRef.current) setSyncNotice("Device storage could not record delivery. The original request is retained; it will not be resent.") }
      return
    }
    if (isFlushingPendingOperationsRef.current || activeRemoteCollectionWriteCountRef.current > 0) return
    // Backing off after a failure: only the retry timer, reconnecting, the app becoming visible or a new
    // edit start the next attempt (they clear the timer first).
    if (syncRetryTimerRef.current) return

    const operations = readPendingCollectionOperations().filter(op => op.origin?.kind === "account" && op.origin.actorUserId === user.id && op.origin.ownerUserId === collectionOwnerUserId)
    if (operations.length === 0) {
      if (localPendingSyncCount !== 0) {
        setLocalPendingSyncCount(0)
      }
      setSyncStatus("idle")
      return
    }

    const flushIdentity = recoveryIdentityRef.current
    const flushEpoch = deliveryEpochRef.current
    const isCurrentFlush = () => flushIdentity !== null && recoveryIdentityRef.current === flushIdentity && deliveryEpochRef.current === flushEpoch
    isFlushingPendingOperationsRef.current = true
    setSyncStatus("syncing")
    let didWriteRemoteCollection = false
    let shouldRetry = false
    let didPause = false
    let didPauseCompatibility = false

    try {
      for (const queuedSnapshot of operations) {
        if (!isCurrentFlush()) return
        const queuedOperation = readPendingCollectionOperations().find(op => op.id === queuedSnapshot.id)
        if (!queuedOperation) continue
        if (queuedOperation.origin?.kind !== "account" || queuedOperation.recipientPause) { didPause = true; continue }
        if (queuedOperation.compatibilityPause) { didPauseCompatibility = true; continue }
        // A later edit must not bypass retained incompatible intent for the same binder.
        if (readPendingCollectionOperations().some(edit => edit.compatibilityPause
          && pendingOperationBinderId(edit) === pendingOperationBinderId(queuedOperation))) {
          pauseLegacyCollectionOperation(queuedOperation.id)
          didPauseCompatibility = true
          continue
        }
        const access = readBillingCache(localStorage, user.id, collectionOwnerUserId)
        const accessKey = JSON.stringify(access)
        if (queuedOperation.billingPause === accessKey) { didPause = true; continue }
        let operation = queuedOperation
        let conflictRounds = 0
        const originalRaw = readPendingCollectionOperationRaw(operation.id)
        if (!originalRaw) continue

        // Each edit: write it; on 409 merge with the server row and try again (bounded); on a hard
        // failure roll it back; on a network/server failure stop and retry the whole queue later.
        while (true) {
          const edit = operation
          const baseFingerprint = "base" in edit ? collectionFingerprint(edit.base) : undefined
          const editBinderId = pendingOperationBinderId(edit)
          try {
            if (edit.recoverySource && edit.deliveryUnknown) { didPause = true; break }
            replacePendingCollectionOperation(edit.id, { ...edit, deliveryUnknown: true })
            if (edit.type === "upsert") {
              const savedItem = await writeRemoteCollection(() => saveRemoteCollectionItem(edit.item, { recipient: edit.origin, operationId: edit.id, baseFingerprint, binderId: editBinderId, acquisition: edit.acquisition, importOnly: edit.importOnly }))
              if (!isCurrentFlush()) return
              removePendingCollectionOperation(edit.id)
              settleLocalItem(edit.pokemonId, savedItem, editBinderId, edit.origin ?? null)
            } else {
              await writeRemoteCollection(() => deleteRemoteCollectionItem(edit.pokemonId, { recipient: edit.origin, operationId: edit.id, baseFingerprint, binderId: editBinderId }))
              if (!isCurrentFlush()) return
              removePendingCollectionOperation(edit.id)
              settleLocalItem(edit.pokemonId, null, editBinderId, edit.origin ?? null)
            }
            didWriteRemoteCollection = true
            break
          } catch (error) {
            if (!isCurrentFlush()) return
            const kind = classifyWriteFailure(error)

            if (edit.recoverySource && kind !== "compatibility") {
              replacePendingCollectionOperation(edit.id, { ...edit, deliveryUnknown: kind === "retry", recipientPause: kind === "retry" ? "delivery_unknown" : "review_changed" })
              pauseReviewedCollectionBatch(edit.id, kind === "retry" ? "delivery_unknown" : "review_changed")
              setSyncNotice("Review upload paused. Check the destination before making another change; cancelling cannot undo a request already sent.")
              didPause = true
              break
            }
            if (kind === "recipient") {
              replacePendingCollectionOperation(operation.id, { ...operation, recipientPause: error instanceof CollectionWriteError ? error.code ?? "recipient" : "recipient" })
              setSyncNotice("The original destination changed. Your changes are kept on this device.")
              didPause = true
              break
            }
            if (kind === "compatibility") {
              pauseLegacyCollectionOperation(operation.id, originalRaw)
              didPauseCompatibility = true
              break
            }
            if (kind === "paused") {
              replacePendingCollectionOperation(operation.id, { ...operation, billingPause: accessKey })
              setSyncNotice("Your changes are saved on this device. Upgrade or remove cards to sync them.")
              didPause = true
              break
            }
            if (kind === "conflict" && conflictRounds < 2) {
              conflictRounds += 1
              const serverItem = error instanceof CollectionWriteError ? error.serverItem : null
              const resolution = resolveConflict(operation, serverItem)
              if (resolution.action === "drop") {
                removePendingCollectionOperation(operation.id)
                settleLocalItem(operation.pokemonId, resolution.serverItem, editBinderId, operation.origin ?? null)
                break
              }
              const binderField = editBinderId ? { binderId: editBinderId } : {}
              const merged: PendingCollectionOperation = resolution.action === "write"
                ? { ...operation, id: operation.id, type: "upsert", pokemonId: operation.pokemonId, item: resolution.item, base: resolution.base, ...(operation.type === "upsert" && operation.importOnly ? { importOnly: true as const } : {}), acquisition: mergeQueuedAcquisition(resolution.base, resolution.item, undefined, operation.type === "upsert" ? operation.acquisition : undefined), queuedAt: operation.queuedAt, ...binderField }
                : { ...operation, id: operation.id, type: "delete", pokemonId: operation.pokemonId, base: resolution.base, queuedAt: operation.queuedAt, ...binderField }
              replacePendingCollectionOperation(operation.id, merged)
              operation = merged
              continue
            }

            if (kind === "hard" || kind === "conflict") {
              removePendingCollectionOperation(operation.id)
              rollBackEdit(operation, error)
              break
            }

            console.error("[holofolder] Pending collection sync paused:", {
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
        window.dispatchEvent(new Event("holofolder-refresh-billing"))
        void broadcastCollectionChanged()
      }
    } finally {
      isFlushingPendingOperationsRef.current = false
      refreshLocalPendingSyncCount()
    }

    if (!isCurrentFlush()) return
    if (shouldRetry) {
      scheduleSyncRetry()
      if (didPauseCompatibility) setSyncStatus("compatibility")
      return
    }

    syncRetryAttemptRef.current = 0
    if (didPauseCompatibility) { setSyncStatus("compatibility"); return }
    if (didPause) { setSyncStatus("waiting"); return }
    if (readPendingCollectionOperations().filter(isEditForThisBinder).some(op => !op.recipientPause && op.origin?.kind === "account")) {
      // Edits made while we were sending: go again.
      void Promise.resolve().then(() => flushPendingCollectionOperationsRef.current())
    } else {
      setSyncStatus("idle")
    }
  }, [readOnly, user, collectionOwnerUserId, stagedDurableQueue, readPendingCollectionOperations, isEditForThisBinder, durableRuntime, editOrigin, broadcastCollectionChanged, localPendingSyncCount, refreshLocalPendingSyncCount, writeRemoteCollection, settleLocalItem, rollBackEdit, scheduleSyncRetry])

  useEffect(() => {
    flushPendingCollectionOperationsRef.current = flushPendingCollectionOperations
  }, [flushPendingCollectionOperations])

  useEffect(() => {
    if (!syncNotice || stagedDurableQueue) return
    const timer = setTimeout(() => setSyncNotice(null), 10_000)
    return () => clearTimeout(timer)
  }, [syncNotice, stagedDurableQueue])

  useEffect(() => {
    queueMicrotask(() => { void flushPendingCollectionOperations() })
  }, [flushPendingCollectionOperations, localPendingSyncCount])

  // Queued edits made before a reload stay visible on top of whatever collection the page started with.
  useEffect(() => {
    if (readOnly) return
    const operations = readBinderPendingOperations()
    if (operations.length > 0) {
      queueMicrotask(() => setCollection((current) => applyPendingEdits(current, operations)))
    }
  }, [readBinderPendingOperations, readOnly, durable.view])

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

    window.addEventListener(BILLING_CHANGED, syncNow)
    window.addEventListener("holofolder-legacy-reviewed", syncNow)
    window.addEventListener("online", syncNow)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.removeEventListener(BILLING_CHANGED, syncNow)
      window.removeEventListener("holofolder-legacy-reviewed", syncNow)
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
  }, [localPendingSyncCount, readOnly, readPendingCollectionOperations, reloadRemoteCollection, user])

  /**
   * Optimistic write shared by every edit: update the UI now, then send it. Offline, signed out, or with an
   * older edit of the same Pokémon still queued, the edit is queued instead (and keeps per-Pokémon order).
   * A hard server rejection rolls the edit back; network/server failures and conflicts go to the queue.
   */
  const commitItemChange = useCallback(async (pokemonId: number, nextItem: CollectedPokemon | null, acquisition?: AcquisitionIntent, expected?: CollectedPokemon | null, importOnly = false) => {
    const origin = authenticatedUserId.current === (user?.id ?? null) ? editOrigin : null
    const identity = recoveryIdentityRef.current
    const editEpoch = deliveryEpochRef.current
    const isCurrentEdit = () => identity !== null && identity === recoveryIdentityRef.current && editEpoch === deliveryEpochRef.current
    const current = collectionRef.current
    const existingItem = current.find((item) => item.pokemon_id === pokemonId) ?? null
    if (importOnly && hasPendingCollectionOperation(pokemonId, binderId, origin)) {
      return { item: existingItem, queued: false as const, rolledBack: true as const, error: "This Pokémon has unsynced edits. Sync before importing." }
    }
    if (expected !== undefined && collectionFingerprint(existingItem) !== collectionFingerprint(expected)) {
      return { item: existingItem, queued: false as const, rolledBack: true as const, error: "This card changed since the action. Check your binder before undoing." }
    }
    const cachedAccess = typeof window === "undefined" ? null : readBillingCache(localStorage, user?.id ?? null, collectionOwnerUserId)
    const access = cachedAccess ?? resolveBillingAccess(collectionOwnerUserId ?? "guest", { enforced: true, ...(!user ? { free_card_limit: FREE_CARD_LIMIT } : {}) })
    const before = countSavedCards(current)
    const after = before - (existingItem ? savedCardWeight(existingItem) : 0) + (nextItem ? savedCardWeight(nextItem) : 0)
    const totalBefore = Math.max(before, access.savedCardCount + pendingCardDelta(readPendingCollectionOperations().filter(isEditForThisBinder)))
    if (!canGrowCollection(access, totalBefore, totalBefore + after - before)) {
      setSyncNotice(`Your free account holds ${access.cardLimit} entries. Upgrade to save more.`)
      window.dispatchEvent(new Event("holofolder-upgrade"))
      return { item: existingItem, queued: false as const, error: "Upgrade to add more cards.", rolledBack: true as const }
    }
    const binderField = binderId ? { binderId } : {}
    const input: PendingCollectionOperationInput = nextItem
      ? { origin: origin ?? undefined, type: "upsert", pokemonId, item: nextItem, base: existingItem, acquisition, ...(importOnly ? { importOnly: true as const } : {}), ...binderField }
      : { origin: origin ?? undefined, type: "delete", pokemonId, base: existingItem, ...binderField }

    if (stagedDurableQueue) {
      if (!origin || !durableRuntime?.view() || !isCurrentEdit()) return { item: existingItem, queued: false as const, rolledBack: true as const, error: "Device changes are loading. This edit was not saved or sent." }
      try {
        await durableRuntime.enqueue(input)
        if (!isCurrentEdit()) return { item: nextItem, queued: true as const }
        const committed = durableRuntime.view() ? applyPendingEdits(collectionRef.current, readBinderPendingOperations()) : nextItem ? upsertCollectionItem(collectionRef.current, nextItem) : removeCollectionItem(collectionRef.current, pokemonId)
        applyLocalCollection(committed)
        setUnsavedDraft(null)
        refreshLocalPendingSyncCount()
        void flushPendingCollectionOperationsRef.current()
        return { item: nextItem, queued: true as const }
      } catch (error) {
        if (isCurrentEdit()) {
          setUnsavedDraft({ pokemonId, nextItem, acquisition, expected: existingItem, importOnly, origin, epoch: editEpoch })
          setSyncNotice("This draft is unsaved. Retry when device storage is available; no new send was started here.")
        }
        return { item: existingItem, queued: false as const, rolledBack: true as const, error }
      }
    }

    const hadPending = hasPendingCollectionOperation(pokemonId, binderId, origin)
    let edit: PendingCollectionOperation
    try { edit = queuePendingCollectionOperation(input) } catch (error) {
      setSyncNotice("Device storage is full. This edit was not sent. Download your saved data or free storage before retrying.")
      return { item: existingItem, queued: false as const, rolledBack: true as const, error }
    }
    applyLocalCollection(nextItem ? upsertCollectionItem(current, nextItem) : removeCollectionItem(current, pokemonId))
    refreshLocalPendingSyncCount()
    if (!user || origin?.kind !== "account" || !collectionOwnerUserId || isOffline() || hadPending
      || readPendingCollectionOperations().some(edit => edit.compatibilityPause && isEditForThisBinder(edit))) {
      return { item: nextItem, queued: true as const }
    }

    const baseFingerprint = collectionFingerprint(existingItem)
    let activityEventId:string|undefined
    const onCommittedEvent=(id:string)=>{activityEventId=id}
    try {
      replacePendingCollectionOperation(edit.id, { ...edit, deliveryUnknown: true })
      if (nextItem) {
        const savedItem = await writeRemoteCollection(() => saveRemoteCollectionItem(nextItem, { recipient: origin ?? undefined, operationId: edit.id, baseFingerprint, binderId, acquisition, onCommittedEvent, ...(importOnly ? { importOnly: true } : {}) }))
        if (!isCurrentEdit()) return { item: nextItem, queued: true as const }
        removePendingCollectionOperation(edit.id)
        refreshLocalPendingSyncCount()
        settleLocalItem(pokemonId, savedItem)
        void broadcastCollectionChanged()
        window.dispatchEvent(new Event("holofolder-refresh-billing"))
        return { item: savedItem, queued: false as const, activityEventId }
      }
      await writeRemoteCollection(() => deleteRemoteCollectionItem(pokemonId, { recipient: origin ?? undefined, operationId: edit.id, baseFingerprint, binderId, onCommittedEvent }))
      if (!isCurrentEdit()) return { item: null, queued: true as const }
      removePendingCollectionOperation(edit.id)
      refreshLocalPendingSyncCount()
      void broadcastCollectionChanged()
      window.dispatchEvent(new Event("holofolder-refresh-billing"))
      return { item: null, queued: false as const, activityEventId }
    } catch (error) {
      if (!isCurrentEdit()) return { item: nextItem, queued: true as const, error }
      if (classifyWriteFailure(error) === "hard") { removePendingCollectionOperation(edit.id) }
      if (classifyWriteFailure(error) === "hard") {
        rollBackEdit({ origin: origin ?? undefined, pokemonId, item: nextItem ?? undefined, base: existingItem, ...binderField }, error)
        return { item: existingItem, queued: false as const, error, rolledBack: true as const }
      }
      // Conflicts are resolved by the queue right away; network/server failures wait for the backoff.
      if (classifyWriteFailure(error) === "compatibility") { pauseLegacyCollectionOperation(edit.id); setSyncStatus("compatibility") }
      else if (classifyWriteFailure(error) === "recipient") replacePendingCollectionOperation(edit.id, { ...edit, recipientPause: error instanceof CollectionWriteError ? error.code ?? "recipient" : "recipient" })
      else if (classifyWriteFailure(error) === "retry") { replacePendingCollectionOperation(edit.id, { ...edit, deliveryUnknown: true }); scheduleSyncRetry() }
      else void Promise.resolve().then(() => flushPendingCollectionOperationsRef.current())
      refreshLocalPendingSyncCount()
      return { item: nextItem, queued: true as const, error }
    }
  }, [user, editOrigin, hasPendingCollectionOperation, binderId, collectionOwnerUserId, readPendingCollectionOperations, isEditForThisBinder, stagedDurableQueue, applyLocalCollection, refreshLocalPendingSyncCount, durableRuntime, readBinderPendingOperations, writeRemoteCollection, broadcastCollectionChanged, settleLocalItem, rollBackEdit, scheduleSyncRetry])

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
  ): Promise<{ data?: CollectedPokemon; queued?: boolean; error?: string; activityEventId?:string }> => {
    if (readOnly) return { error: "Read-only binder" }

    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    const cardFinish = options.cardFinish ?? existingItem?.card_finish ?? "normal"
    const nextItem = normalizeCollectionItem({
      id: existingItem?.id,
      pokemon_id: pokemonId,
      pokemon_name: pokemonName,
      card_id: cardId,
      card_name: cardName,
      card_image: cardImage,
      card_set: cardSet,
      card_language: cardLanguage,
      card_finish: cardFinish,
      // Adding a card as owned fills a wanted slot; otherwise it would keep showing as wanted.
      wanted_cards: resolveWantedCardsAfterOwnedAdd({
        existing: existingItem,
        wantedCards: options.wantedCards ?? existingItem?.wanted_cards ?? [],
        status,
        cardId,
        cardIds: options.cardIds,
        cardLanguage,
        cardFinish,
      }),
      status,
      collected_at: existingItem?.collected_at ?? new Date().toISOString(),
    })
    const acquisition = user ? captureAcquisition(existingItem ?? null, nextItem, { actorId: user.id, ownerId: collectionOwnerUserId, membership: readPushMembership(user.id) }) : undefined
    const result = await commitItemChange(pokemonId, nextItem, acquisition)
    if ("rolledBack" in result) {
      console.error("[holofolder] Error adding to collection:", { message: extractErrorMessage(result.error), pokemonId, status })
      return { error: extractErrorMessage(result.error) }
    }
    if (result.queued) {
      return { data: nextItem, queued: true, ...("error" in result ? { error: extractErrorMessage(result.error) } : {}) }
    }
    return { data: result.item ?? nextItem, activityEventId: result.activityEventId }
  }, [commitItemChange, collection, collectionOwnerUserId, readOnly, user])

  const removeFromCollection = useCallback(async (pokemonId: number, expected?: CollectedPokemon | null) => {
    if (readOnly) return { error: "Read-only binder" }

    const result = await commitItemChange(pokemonId, null, undefined, expected)
    if ("rolledBack" in result) {
      console.error("[holofolder] Error removing from collection:", result.error)
      return { error: result.error }
    }
    return result.queued ? { success: true, queued: true, ...("error" in result ? { error: result.error } : {}) } : { success: true, activityEventId: result.activityEventId }
  }, [commitItemChange, readOnly])

  /**
   * Remove the owned card from a slot: "to-wanted" turns the slot back into a wanted slot (one row write),
   * "remove" deletes the row. Returns the previous row so the caller can offer an exact undo.
   */
  const removeOwnedCard = useCallback(async (pokemonId: number, mode: OwnedRemovalMode = "to-wanted") => {
    if (readOnly) return { error: "Read-only binder" }
    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    if (!isOwnedCollectionItem(existingItem)) return { error: "Not owned" }

    const { previous, next } = planOwnedRemoval(existingItem, mode)
    const result = await commitItemChange(pokemonId, next)
    if ("rolledBack" in result) {
      console.error("[holofolder] Error removing owned card:", result.error)
      return { error: extractErrorMessage(result.error) }
    }
    return { previous, data: next, queued: result.queued, activityEventId: "activityEventId" in result ? result.activityEventId : undefined }
  }, [collection, commitItemChange, readOnly])

  /** Write a previously saved row back exactly as it was (used by undo). */
  const restoreCollectionItem = useCallback(async (previous: CollectedPokemon, expected?: CollectedPokemon | null, options?: { importOnly: true }) => {
    if (readOnly) return { error: "Read-only binder" }
    const result = await commitItemChange(previous.pokemon_id, previous, undefined, expected, options?.importOnly)
    if ("rolledBack" in result) {
      console.error("[holofolder] Error restoring collection item:", result.error)
      return { error: extractErrorMessage(result.error) }
    }
    return { data: result.item ?? previous, queued: result.queued }
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
      { ...wantedCard, ...(wantedCard.wanted_by === undefined && user ? { wanted_by: [user.id] } : {}) },
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
  }, [addToCollection, collection, user])

  const editWantedCard = useCallback(async (pokemonId: number, card: WantedCard, replacement: WantedCard | null) => {
    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    if (!existingItem) return { error: "Not in collection" }

    const nextWantedCards = editWantedCards(existingItem.wanted_cards, card, replacement)
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
    _pokemonCatalog: PokemonCatalogEntry[],
    _options: SyncLocalCollectionOptions = {}
  ): Promise<{ data?: SyncLocalCollectionResult; error?: unknown }> => {
    return { error: "Use Review changes to choose an explicit binder. Older local IDs do not identify an upload recipient." }
  }, [])

  const updateStatus = useCallback(async (pokemonId: number, status: SlotStatus) => {
    if (readOnly) return { error: "Read-only binder" }
    const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
    if (!existingItem) return { error: "Not in collection" }
    const nextItem = normalizeCollectionItem({ ...existingItem, status })

    const result = await commitItemChange(pokemonId, nextItem)
    if ("rolledBack" in result) {
      console.error("[holofolder] Error updating status:", result.error)
      return { error: result.error }
    }
    if (result.queued) {
      return { data: nextItem, queued: true, ...("error" in result ? { error: result.error } : {}) }
    }
    return { data: result.item ?? nextItem, activityEventId: result.activityEventId }
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
    clearActivityCache(window.localStorage)
    authenticatedUserId.current = null
    authEpochRef.current++; deliveryEpochRef.current++; recoveryIdentityRef.current = null
    window.dispatchEvent(new Event("holofolder-legacy-scope-changed"))
    setUser(null)
    setCollectionOwnerUserId(null)
    setCollection([])
  }, [readOnly])

  const refreshAfterRecovery = async () => {
      const accountId = user?.id
      const ownerId = collectionOwnerUserId
      if (!accountId || !ownerId || readOnly || readPendingCollectionOperations().length) throw new Error('Sync your pending changes first.')
      const { data: rows, error } = await loadCollectionRows(supabase, ownerId, binderId)
      if (error) throw new Error('Could not refresh your collection. Retry to verify Undo.')
      if (authenticatedUserId.current !== accountId || recoveryIdentityRef.current!==recoveryIdentity) throw new Error('Your collection changed. Reopen Activity.')
      collectionBaselineRef.current = createCollectionBaseline(ownerId, rows, binderId)
      setCollection(applyPendingEdits(normalizeCollectionItems(rows), readBinderPendingOperations()))
      await broadcastCollectionChanged()
      window.dispatchEvent(new Event('holofolder-refresh-billing'))
  }

  return {
    durableQueue: stagedDurableQueue ? durableRuntime : undefined,
    retryUnsavedEdit: unsavedDraft && sameCollectionOrigin(unsavedDraft.origin, editOrigin)
      ? () => unsavedDraft.epoch === deliveryEpochRef.current
        ? commitItemChange(unsavedDraft.pokemonId, unsavedDraft.nextItem, unsavedDraft.acquisition, unsavedDraft.expected, unsavedDraft.importOnly)
        : Promise.resolve({ error: "The draft belongs to an earlier session. Reopen this binder before editing." }) : undefined,
    refreshAfterRecovery,
    undoActivityEvent: async (eventId:string) => {
      const accountId=user?.id,ownerId=collectionOwnerUserId
      if(!accountId||!ownerId||readPendingCollectionOperations().length) throw new Error('Sync your pending changes before undoing.')
      const {undoCommittedActivity}=await import('@/lib/undo-committed-activity')
      await undoCommittedActivity(eventId,accountId,ownerId,()=>authenticatedUserId.current===accountId&&recoveryIdentityRef.current===recoveryIdentity,refreshAfterRecovery)
    },
    user,
    collection,
    isLoading: stagedDurableQueue && !durable.view,
    addToCollection,
    addWantedCard,
    removeFromCollection,
    editWantedCard,
    removeOwnedCard,
    restoreCollectionItem,
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
    binderId,
    resolvedCollectionOwnerUserId: getResolvedCollectionOwner(user?.id ?? null, ownerResolvedForUserId, collectionOwnerUserId),
  }
}
