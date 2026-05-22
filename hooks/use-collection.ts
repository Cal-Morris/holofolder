"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { addLocalCollectedId, readLocalCollectedIds, removeLocalCollectedId, writeLocalCollectedIds } from "@/lib/local-collection"
import type { User } from "@supabase/supabase-js"

export type SlotStatus = 'collected' | 'finalized' | 'considering' | 'wishlisted'
export type CardLanguage = "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko"
export type CardFinish =
  | "normal"
  | "holo"
  | "reverse_holo"
  | "double_rare"
  | "ultra_rare"
  | "illustration_rare"
  | "special_illustration_rare"
  | "secret_rare"
  | "hyper_rare"
  | "radiant_rare"
  | "ace_spec"
  | "amazing_rare"
  | "shiny_rare"

export interface WantedCard {
  card_id: string
  card_name: string
  card_image?: string
  card_set?: string
  card_language?: CardLanguage
  card_finish?: CardFinish
  rarity?: string
  local_id?: string
  set_total?: number
  added_at: string
}

export interface CollectedPokemon {
  id: string
  pokemon_id: number
  pokemon_name: string
  card_id?: string
  card_name?: string
  card_image?: string
  card_set?: string
  card_language?: CardLanguage
  card_finish?: CardFinish
  wanted_cards: WantedCard[]
  status: SlotStatus
  collected_at: string
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

interface LocalCollectionSnapshot {
  ownerUserId: string | null
  savedAt: string
  collection: CollectedPokemon[]
}

const LOCAL_COLLECTION_SNAPSHOT_KEY = "pokemon_collection_snapshot_v1"

function isSlotStatus(value: unknown): value is SlotStatus {
  return value === "collected" || value === "finalized" || value === "considering" || value === "wishlisted"
}

function normalizeCardLanguage(value: unknown): CardLanguage {
  if (typeof value !== "string") return "en"
  const normalized = value.trim().toLowerCase()
  return normalized === "en" ||
    normalized === "fr" ||
    normalized === "de" ||
    normalized === "es" ||
    normalized === "it" ||
    normalized === "pt-br" ||
    normalized === "ja" ||
    normalized === "ko"
      ? normalized
      : "en"
}

function normalizeCardFinish(value: unknown): CardFinish {
  if (typeof value !== "string") return "normal"
  return value === "normal" ||
    value === "holo" ||
    value === "reverse_holo" ||
    value === "double_rare" ||
    value === "ultra_rare" ||
    value === "illustration_rare" ||
    value === "special_illustration_rare" ||
    value === "secret_rare" ||
    value === "hyper_rare" ||
    value === "radiant_rare" ||
    value === "ace_spec" ||
    value === "amazing_rare" ||
    value === "shiny_rare"
      ? value
      : "normal"
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

export function useCollection(options: UseCollectionOptions = {}) {
  const { initialUser = null, initialCollection = [], initialCollectionOwnerUserId = null, readOnly = false } = options
  const [user, setUser] = useState<User | null>(initialUser)
  const [collection, setCollection] = useState<CollectedPokemon[]>(normalizeCollectionItems(initialCollection))
  const [collectionOwnerUserId, setCollectionOwnerUserId] = useState<string | null>(initialCollectionOwnerUserId)
  const [localCollectedCount, setLocalCollectedCount] = useState(0)
  const supabase = createClient()
  const didMount = useRef(false)

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

  useEffect(() => {
    refreshLocalCollectedCount()

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "pokemon_collected") {
        refreshLocalCollectedCount()
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [refreshLocalCollectedCount])

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

  useEffect(() => {
    if (readOnly) return

    // Skip the initial load — server already provided initial data.
    if (!didMount.current) {
      didMount.current = true
      return
    }

    const reloadCollection = async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        setUser(currentUser)

        if (currentUser) {
          const ownerUserId = await resolveCollectionOwnerUserId(currentUser)
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
    }

    reloadCollection()
  }, [readOnly, resolveCollectionOwnerUserId, supabase])

  useEffect(() => {
    if (readOnly) return

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)

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
    if (readOnly) return
    if (!collectionOwnerUserId || collection.length === 0) return

    writeLocalCollectionSnapshot({
      ownerUserId: collectionOwnerUserId,
      savedAt: new Date().toISOString(),
      collection,
    })
  }, [collection, collectionOwnerUserId, readOnly])

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
    if (!user || !collectionOwnerUserId) return { error: "Not logged in" }

    try {
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
        collected_at: existingItem?.collected_at,
      })

      const response = await fetch("/api/collection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          pokemonId,
          pokemonName,
          cardId,
          cardName,
          cardImage,
          cardSet,
          cardLanguage,
          cardFinish: options.cardFinish ?? existingItem?.card_finish ?? "normal",
          wantedCards: options.wantedCards ?? existingItem?.wanted_cards ?? [],
          status,
        })
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
      const savedItem = normalizeCollectionItem(payload?.item ?? nextItem)

      setCollection(prev => {
        const existing = prev.findIndex(p => p.pokemon_id === pokemonId)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = savedItem
          return updated
        }
        return [...prev, savedItem].sort((a, b) => a.pokemon_id - b.pokemon_id)
      })

      if (status === "wishlisted") {
        removeLocalCollectedId(pokemonId)
      } else {
        addLocalCollectedId(pokemonId)
      }
      refreshLocalCollectedCount()

      return { data: savedItem }
    } catch (error) {
      console.error("[binderdex] Error adding to collection:", {
        message: extractErrorMessage(error),
        raw: error,
        pokemonId,
        status,
      })
      return { error: extractErrorMessage(error) }
    }
  }, [collectionOwnerUserId, readOnly, refreshLocalCollectedCount, supabase, user])

  const removeFromCollection = useCallback(async (pokemonId: number) => {
    if (readOnly) return { error: "Read-only binder" }
    if (!user || !collectionOwnerUserId) return { error: "Not logged in" }

    try {
      const response = await fetch(`/api/collection?pokemonId=${pokemonId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const payload = await readJsonResponse(response)
        throw new Error(payload?.error || `Failed to delete collection item (${response.status})`)
      }

      setCollection(prev => prev.filter(p => p.pokemon_id !== pokemonId))
      removeLocalCollectedId(pokemonId)
      refreshLocalCollectedCount()

      return { success: true }
    } catch (error) {
      console.error("[binderdex] Error removing from collection:", error)
      return { error }
    }
  }, [collectionOwnerUserId, readOnly, refreshLocalCollectedCount, supabase, user])

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
        const { error } = await supabase
          .from("pokemon_collection")
          .delete()
          .eq("user_id", collectionOwnerUserId)
          .in("pokemon_id", idsToRemove)

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

        const { data, error } = await supabase
          .from("pokemon_collection")
          .upsert(rowsToReplace, {
            onConflict: "user_id,pokemon_id",
          })
          .select()

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

        const { data, error } = await supabase
          .from("pokemon_collection")
          .upsert(rowsToInsert, {
            onConflict: "user_id,pokemon_id",
          })
          .select()

        if (error) throw error
        syncedRows = normalizeCollectionItems(data)
      }

      const keptRows = replaceRemote
        ? wishlistedRows
        : collection.filter((item) => !idsToRemove.includes(item.pokemon_id))
      const nextCollection = [...keptRows, ...syncedRows].sort((a, b) => a.pokemon_id - b.pokemon_id)

      setCollection(nextCollection)
      writeLocalCollectedIds(
        nextCollection
          .filter((item) => item.status !== "wishlisted")
          .map((item) => item.pokemon_id),
      )
      refreshLocalCollectedCount()

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
  }, [collection, collectionOwnerUserId, getSanitizedLocalCollectedIds, readOnly, refreshLocalCollectedCount, supabase, user])

  const updateStatus = useCallback(async (pokemonId: number, status: SlotStatus) => {
    if (readOnly) return { error: "Read-only binder" }
    if (!user || !collectionOwnerUserId) return { error: "Not logged in" }

    try {
      const existingItem = collection.find((item) => item.pokemon_id === pokemonId)
      const response = await fetch("/api/collection", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ pokemonId, status }),
      })

      if (!response.ok) {
        const payload = await readJsonResponse(response)
        throw new Error(payload?.error || `Failed to update collection item (${response.status})`)
      }

      const payload = await readJsonResponse(response)
      const savedItem = payload?.item ? normalizeCollectionItem(payload.item) : (existingItem ? { ...existingItem, status } : null)

      setCollection(prev => prev.map(p =>
        p.pokemon_id === pokemonId ? (savedItem ?? { ...p, status }) : p
      ))
      return { data: savedItem ?? (existingItem ? { ...existingItem, status } : { pokemon_id: pokemonId, status }) }
    } catch (error) {
      console.error("[binderdex] Error updating status:", error)
      return { error }
    }
  }, [collection, collectionOwnerUserId, readOnly, supabase, user])

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
    await supabase.auth.signOut()
    setUser(null)
    setCollectionOwnerUserId(null)
    setCollection([])
  }, [readOnly, supabase])

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
    collectionCount: collection.filter((item) => item.status !== "wishlisted").length,
    collectionOwnerUserId,
  }
}
