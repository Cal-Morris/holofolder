"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { readLocalCollectedIds, writeLocalCollectedIds } from "@/lib/local-collection"
import {
  COLLECTION_CHANGED_EVENT,
  createCollectionChangedPayload,
  getCollectionRealtimeTopic,
} from "@/lib/collection-realtime"
import type { User } from "@supabase/supabase-js"

import {
  isSlotStatus,
  normalizeCardFinish,
  normalizeCardLanguage,
  type CardFinish,
  type CardLanguage,
  type CollectedPokemon,
  type SlotStatus,
  type WantedCard,
} from "@/lib/domain/cards"

export type { CardFinish, CardLanguage, CollectedPokemon, SlotStatus, WantedCard } from "@/lib/domain/cards"

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

interface LocalCollectionSnapshot {
  ownerUserId: string | null
  savedAt: string
  collection: CollectedPokemon[]
}

type PendingCollectionOperation =
  | {
      id: string
      type: "upsert"
      pokemonId: number
      item: CollectedPokemon
      queuedAt: string
    }
  | {
      id: string
      type: "delete"
      pokemonId: number
      queuedAt: string
    }

type PendingCollectionOperationInput =
  | {
      type: "upsert"
      pokemonId: number
      item: CollectedPokemon
    }
  | {
      type: "delete"
      pokemonId: number
    }

const LOCAL_COLLECTION_SNAPSHOT_KEY = "pokemon_collection_snapshot_v1"
const LOCAL_COLLECTION_PENDING_OPS_KEY = "pokemon_collection_pending_ops_v1"
/** Poll cadence while realtime is unavailable (the original behaviour). */
export const COLLECTION_AUTO_REFRESH_INTERVAL_MS = 5000
/** Safety-net poll while the realtime channel is subscribed and delivers changes itself. */
export const COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS = 60_000

interface ShouldAutoRefreshCollectionInput {
  readOnly: boolean
  hasUser: boolean
  isOnline: boolean
  pendingOperationCount: number
  isFlushingPendingOperations: boolean
  isWritingRemoteCollection: boolean
  /** Defaults to true. Hidden tabs never poll; they refresh when they become visible again. */
  isVisible?: boolean
}

export function keepStableUserById<TUser extends { id: string }>(currentUser: TUser | null, nextUser: TUser | null) {
  return currentUser?.id === nextUser?.id ? currentUser : nextUser
}

export function getRemoteCollectionRefreshPlan<TUser extends { id: string }>(
  currentUser: TUser | null,
  knownOwnerUserId: string | null,
) {
  if (!currentUser) return null

  return {
    user: currentUser,
    knownOwnerUserId,
    shouldResolveOwner: !knownOwnerUserId,
  }
}

export function shouldAutoRefreshCollection(input: ShouldAutoRefreshCollectionInput) {
  return input.isVisible !== false &&
    !input.readOnly &&
    input.hasUser &&
    input.isOnline &&
    input.pendingOperationCount === 0 &&
    !input.isFlushingPendingOperations &&
    !input.isWritingRemoteCollection
}

export function getCollectionAutoRefreshIntervalMs(isRealtimeConnected: boolean) {
  return isRealtimeConnected ? COLLECTION_REALTIME_SAFETY_REFRESH_INTERVAL_MS : COLLECTION_AUTO_REFRESH_INTERVAL_MS
}

export function isCollectionAutoRefreshDue(input: {
  now: number
  lastRefreshAt: number
  isRealtimeConnected: boolean
}) {
  return input.now - input.lastRefreshAt >= getCollectionAutoRefreshIntervalMs(input.isRealtimeConnected)
}

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden"
}

function normalizeWantedCard(value: unknown): WantedCard | null {
  if (!value || typeof value !== "object") return null
  const item = value as Partial<WantedCard>
  if (typeof item.card_id !== "string" || typeof item.card_name !== "string") return null

  return {
    card_id: item.card_id,
    card_name: item.card_name,
    card_image: typeof item.card_image === "string" ? item.card_image : undefined,
    card_set: typeof item.card_set === "string" ? item.card_set : undefined,
    card_language: normalizeCardLanguage(item.card_language),
    card_finish: normalizeCardFinish(item.card_finish),
    rarity: typeof item.rarity === "string" ? item.rarity : undefined,
    local_id: typeof item.local_id === "string" ? item.local_id : undefined,
    set_total: typeof item.set_total === "number" && Number.isFinite(item.set_total) ? item.set_total : undefined,
    added_at: typeof item.added_at === "string" ? item.added_at : new Date().toISOString(),
  }
}

function normalizeWantedCards(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const cards: WantedCard[] = []

  for (const rawCard of value) {
    const card = normalizeWantedCard(rawCard)
    if (!card) continue
    const key = `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`
    if (seen.has(key)) continue
    seen.add(key)
    cards.push(card)
  }

  return cards
}

function normalizeCollectionItem(item: Partial<CollectedPokemon>): CollectedPokemon {
  const wantedCards = normalizeWantedCards(item.wanted_cards)
  const cardLanguage = normalizeCardLanguage(item.card_language)
  const cardFinish = normalizeCardFinish(item.card_finish)
  const status = isSlotStatus(item.status) ? item.status : "collected"
  const legacyWantedCards = status === "wishlisted" && typeof item.card_id === "string" && typeof item.card_name === "string" && wantedCards.length === 0
    ? [{
        card_id: item.card_id,
        card_name: item.card_name,
        card_image: typeof item.card_image === "string" ? item.card_image : undefined,
        card_set: typeof item.card_set === "string" ? item.card_set : undefined,
        card_language: cardLanguage,
        card_finish: cardFinish,
        added_at: typeof item.collected_at === "string" ? item.collected_at : new Date().toISOString(),
      }]
    : wantedCards

  return {
    id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
    pokemon_id: typeof item.pokemon_id === "number" ? item.pokemon_id : 0,
    pokemon_name: typeof item.pokemon_name === "string" ? item.pokemon_name : "Unknown Pokemon",
    card_id: status === "wishlisted" ? undefined : typeof item.card_id === "string" ? item.card_id : undefined,
    card_name: status === "wishlisted" ? undefined : typeof item.card_name === "string" ? item.card_name : undefined,
    card_image: status === "wishlisted" ? undefined : typeof item.card_image === "string" ? item.card_image : undefined,
    card_set: status === "wishlisted" ? undefined : typeof item.card_set === "string" ? item.card_set : undefined,
    card_language: cardLanguage,
    card_finish: cardFinish,
    wanted_cards: legacyWantedCards,
    status,
    collected_at: typeof item.collected_at === "string" ? item.collected_at : new Date().toISOString(),
  }
}

function normalizeCollectionItems(items: Partial<CollectedPokemon>[] | null | undefined) {
  return Array.isArray(items) ? items.map((item) => normalizeCollectionItem(item)) : []
}

function upsertCollectionItem(items: CollectedPokemon[], item: CollectedPokemon) {
  const existing = items.findIndex((currentItem) => currentItem.pokemon_id === item.pokemon_id)
  if (existing >= 0) {
    const updated = [...items]
    updated[existing] = item
    return updated.sort((a, b) => a.pokemon_id - b.pokemon_id)
  }

  return [...items, item].sort((a, b) => a.pokemon_id - b.pokemon_id)
}

function removeCollectionItem(items: CollectedPokemon[], pokemonId: number) {
  return items.filter((item) => item.pokemon_id !== pokemonId)
}

function numberArraysEqual(a: number[], b: number[]) {
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }

  return true
}

function extractErrorMessage(error: unknown) {
  if (!error) return "Unknown error"
  if (error instanceof Error) return error.message
  if (typeof error === "object") {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [candidate.message, candidate.details, candidate.hint, candidate.code].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    if (parts.length > 0) {
      return parts.join(" | ")
    }
  }
  return String(error)
}

function isMissingStatusColumnError(error: unknown) {
  const message = extractErrorMessage(error).toLowerCase()
  return message.includes("status") && (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  )
}

async function readJsonResponse(response: Response) {
  return response.json().catch(() => null)
}

function readLocalCollectionSnapshot() {
  if (typeof window === "undefined") return null

  try {
    const stored = window.localStorage.getItem(LOCAL_COLLECTION_SNAPSHOT_KEY)
    if (!stored) return null

    const parsed = JSON.parse(stored) as Partial<LocalCollectionSnapshot> | null
    if (!parsed || !Array.isArray(parsed.collection)) {
      return null
    }

    return {
      ownerUserId: typeof parsed.ownerUserId === "string" ? parsed.ownerUserId : null,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
      collection: normalizeCollectionItems(parsed.collection),
    }
  } catch {
    return null
  }
}

function writeLocalCollectionSnapshot(snapshot: LocalCollectionSnapshot) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(LOCAL_COLLECTION_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore quota failures
  }
}

function readPendingCollectionOperations(): PendingCollectionOperation[] {
  if (typeof window === "undefined") return []

  try {
    const stored = window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
    if (!stored) return []

    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((operation): PendingCollectionOperation[] => {
      if (!operation || typeof operation !== "object") return []
      const item = operation as Partial<PendingCollectionOperation>
      if (typeof item.id !== "string" || typeof item.type !== "string") return []
      if (typeof item.pokemonId !== "number" || !Number.isInteger(item.pokemonId) || item.pokemonId <= 0) return []

      if (item.type === "delete") {
        return [{
          id: item.id,
          type: "delete",
          pokemonId: item.pokemonId,
          queuedAt: typeof item.queuedAt === "string" ? item.queuedAt : new Date().toISOString(),
        }]
      }

      if (item.type === "upsert" && "item" in item && item.item) {
        return [{
          id: item.id,
          type: "upsert",
          pokemonId: item.pokemonId,
          item: normalizeCollectionItem(item.item),
          queuedAt: typeof item.queuedAt === "string" ? item.queuedAt : new Date().toISOString(),
        }]
      }

      return []
    })
  } catch {
    return []
  }
}

function writePendingCollectionOperations(operations: PendingCollectionOperation[]) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify(operations))
  } catch {
    // ignore quota failures
  }
}

function createPendingOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function queuePendingCollectionOperation(operation: PendingCollectionOperationInput) {
  const nextOperation = {
    ...operation,
    id: createPendingOperationId(),
    queuedAt: new Date().toISOString(),
  } as PendingCollectionOperation
  const operations = readPendingCollectionOperations()
    .filter((queuedOperation) => queuedOperation.pokemonId !== operation.pokemonId)

  writePendingCollectionOperations([...operations, nextOperation])
}

function removePendingCollectionOperation(operationId: string) {
  writePendingCollectionOperations(
    readPendingCollectionOperations().filter((operation) => operation.id !== operationId),
  )
}

function persistLocalCollectionState(collection: CollectedPokemon[], ownerUserId: string | null) {
  writeLocalCollectionSnapshot({
    ownerUserId,
    savedAt: new Date().toISOString(),
    collection,
  })
  writeLocalCollectedIds(
    collection
      .filter((item) => item.status !== "wishlisted")
      .map((item) => item.pokemon_id),
  )
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

function getCollectionRequestBody(item: CollectedPokemon) {
  return {
    pokemonId: item.pokemon_id,
    pokemonName: item.pokemon_name,
    cardId: item.card_id,
    cardName: item.card_name,
    cardImage: item.card_image,
    cardSet: item.card_set,
    cardLanguage: item.card_language ?? "en",
    cardFinish: item.card_finish ?? "normal",
    wantedCards: item.wanted_cards ?? [],
    status: item.status,
  }
}

async function saveRemoteCollectionItem(item: CollectedPokemon) {
  const response = await fetch("/api/collection", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(getCollectionRequestBody(item)),
  })

  if (!response.ok) {
    const payload = await readJsonResponse(response)
    const message = payload?.error || `Failed to save collection item (${response.status})`
    if (isMissingStatusColumnError(message)) {
      throw new Error(
        "The database is missing pokemon_collection.status. Run scripts/008_add_collection_status.sql against Supabase, then retry.",
      )
    }
    throw new Error(message)
  }

  const payload = await readJsonResponse(response)
  return normalizeCollectionItem(payload?.item ?? item)
}

async function deleteRemoteCollectionItem(pokemonId: number) {
  const response = await fetch(`/api/collection?pokemonId=${pokemonId}`, {
    method: "DELETE",
  })

  if (!response.ok) {
    const payload = await readJsonResponse(response)
    throw new Error(payload?.error || `Failed to delete collection item (${response.status})`)
  }
}

export function useCollection(options: UseCollectionOptions = {}) {
  const { initialUser = null, initialCollection = [], initialCollectionOwnerUserId = null, readOnly = false } = options
  const [user, setUser] = useState<User | null>(initialUser)
  const [collection, setCollection] = useState<CollectedPokemon[]>(normalizeCollectionItems(initialCollection))
  const [collectionOwnerUserId, setCollectionOwnerUserId] = useState<string | null>(initialCollectionOwnerUserId)
  const [localCollectedCount, setLocalCollectedCount] = useState(0)
  const [localPendingSyncCount, setLocalPendingSyncCount] = useState(0)
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

  const queueLocalCollectionOperation = useCallback((operation: PendingCollectionOperationInput) => {
    queuePendingCollectionOperation(operation)
    refreshLocalPendingSyncCount()
  }, [refreshLocalPendingSyncCount])

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

    const snapshot = readLocalCollectionSnapshot()
    if (!snapshot || snapshot.collection.length === 0) {
      return
    }

    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false
    const ownerMatches = Boolean(collectionOwnerUserId && snapshot.ownerUserId === collectionOwnerUserId)

    if (!isOffline && !ownerMatches) {
      return
    }

    setCollection((current) => current.length > 0 ? current : snapshot.collection)

    if (!collectionOwnerUserId && snapshot.ownerUserId) {
      setCollectionOwnerUserId(snapshot.ownerUserId)
    }
  }, [collectionOwnerUserId, readOnly])

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
        setCollection(normalizeCollectionItems(data))
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

        setCollection(normalizeCollectionItems(data))
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

  const flushPendingCollectionOperations = useCallback(async () => {
    if (readOnly || !user || !collectionOwnerUserId || isOffline()) return
    if (isFlushingPendingOperationsRef.current) return

    const operations = readPendingCollectionOperations()
    if (operations.length === 0) {
      if (localPendingSyncCount !== 0) {
        setLocalPendingSyncCount(0)
      }
      return
    }

    isFlushingPendingOperationsRef.current = true

    try {
      let nextCollection = collection
      let didWriteRemoteCollection = false

      for (const operation of operations) {
        try {
          if (operation.type === "upsert") {
            const savedItem = await saveRemoteCollectionItem(operation.item)
            nextCollection = upsertCollectionItem(nextCollection, savedItem)
          } else {
            await deleteRemoteCollectionItem(operation.pokemonId)
            nextCollection = removeCollectionItem(nextCollection, operation.pokemonId)
          }

          didWriteRemoteCollection = true
          removePendingCollectionOperation(operation.id)
          refreshLocalPendingSyncCount()
        } catch (error) {
          console.error("[binderdex] Pending collection sync paused:", {
            message: extractErrorMessage(error),
            pokemonId: operation.pokemonId,
            operation: operation.type,
          })
          break
        }
      }

      if (nextCollection !== collection) {
        applyLocalCollection(nextCollection)
      }

      if (didWriteRemoteCollection) {
        void broadcastCollectionChanged()
      }
    } finally {
      isFlushingPendingOperationsRef.current = false
    }
  }, [
    applyLocalCollection,
    broadcastCollectionChanged,
    collection,
    collectionOwnerUserId,
    localPendingSyncCount,
    readOnly,
    refreshLocalPendingSyncCount,
    user,
  ])

  useEffect(() => {
    flushPendingCollectionOperations()
  }, [flushPendingCollectionOperations, localPendingSyncCount])

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

  useEffect(() => {
    if (readOnly || typeof window === "undefined") return

    window.addEventListener("online", flushPendingCollectionOperations)
    return () => window.removeEventListener("online", flushPendingCollectionOperations)
  }, [flushPendingCollectionOperations, readOnly])

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
  ) => {
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
    const nextCollection = upsertCollectionItem(collection, nextItem)

    applyLocalCollection(nextCollection)

    if (!user || !collectionOwnerUserId || isOffline()) {
      queueLocalCollectionOperation({ type: "upsert", pokemonId, item: nextItem })
      return { data: nextItem, queued: true }
    }

    try {
      const savedItem = await writeRemoteCollection(() => saveRemoteCollectionItem(nextItem))
      const syncedCollection = upsertCollectionItem(nextCollection, savedItem)

      applyLocalCollection(syncedCollection)
      void broadcastCollectionChanged()

      return { data: savedItem }
    } catch (error) {
      queueLocalCollectionOperation({ type: "upsert", pokemonId, item: nextItem })
      console.error("[binderdex] Error adding to collection:", {
        message: extractErrorMessage(error),
        raw: error,
        pokemonId,
        status,
      })
      return { data: nextItem, queued: true, error: extractErrorMessage(error) }
    }
  }, [applyLocalCollection, broadcastCollectionChanged, collection, collectionOwnerUserId, queueLocalCollectionOperation, readOnly, user, writeRemoteCollection])

  const removeFromCollection = useCallback(async (pokemonId: number) => {
    if (readOnly) return { error: "Read-only binder" }
    const nextCollection = removeCollectionItem(collection, pokemonId)

    applyLocalCollection(nextCollection)

    if (!user || !collectionOwnerUserId || isOffline()) {
      queueLocalCollectionOperation({ type: "delete", pokemonId })
      return { success: true, queued: true }
    }

    try {
      await writeRemoteCollection(() => deleteRemoteCollectionItem(pokemonId))
      void broadcastCollectionChanged()

      return { success: true }
    } catch (error) {
      queueLocalCollectionOperation({ type: "delete", pokemonId })
      console.error("[binderdex] Error removing from collection:", error)
      return { success: true, queued: true, error }
    }
  }, [applyLocalCollection, broadcastCollectionChanged, collection, collectionOwnerUserId, queueLocalCollectionOperation, readOnly, user, writeRemoteCollection])

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
    const nextCollection = upsertCollectionItem(collection, nextItem)

    applyLocalCollection(nextCollection)

    if (!user || !collectionOwnerUserId || isOffline()) {
      queueLocalCollectionOperation({ type: "upsert", pokemonId, item: nextItem })
      return { data: nextItem, queued: true }
    }

    try {
      const savedItem = await writeRemoteCollection(() => saveRemoteCollectionItem(nextItem))
      const syncedCollection = upsertCollectionItem(nextCollection, savedItem)

      applyLocalCollection(syncedCollection)
      void broadcastCollectionChanged()
      return { data: savedItem }
    } catch (error) {
      queueLocalCollectionOperation({ type: "upsert", pokemonId, item: nextItem })
      console.error("[binderdex] Error updating status:", error)
      return { data: nextItem, queued: true, error }
    }
  }, [applyLocalCollection, broadcastCollectionChanged, collection, collectionOwnerUserId, queueLocalCollectionOperation, readOnly, user, writeRemoteCollection])

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
    collectionCount: collection.filter((item) => item.status !== "wishlisted").length,
    collectionOwnerUserId,
  }
}
