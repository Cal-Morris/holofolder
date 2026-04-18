"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { addLocalCollectedId, readLocalCollectedIds, removeLocalCollectedId, writeLocalCollectedIds } from "@/lib/local-collection"
import type { User } from "@supabase/supabase-js"

export type SlotStatus = 'collected' | 'finalized' | 'considering' | 'wishlisted'

interface CollectedPokemon {
  id: string
  pokemon_id: number
  pokemon_name: string
  card_id?: string
  card_name?: string
  card_image?: string
  card_set?: string
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
  mode: "merge" | "replace"
}

interface UseCollectionOptions {
  initialUser?: User | null
  initialCollection?: CollectedPokemon[]
  initialCollectionOwnerUserId?: string | null
}

function isSlotStatus(value: unknown): value is SlotStatus {
  return value === "collected" || value === "finalized" || value === "considering" || value === "wishlisted"
}

function normalizeCollectionItem(item: Partial<CollectedPokemon>): CollectedPokemon {
  return {
    id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
    pokemon_id: typeof item.pokemon_id === "number" ? item.pokemon_id : 0,
    pokemon_name: typeof item.pokemon_name === "string" ? item.pokemon_name : "Unknown Pokemon",
    card_id: typeof item.card_id === "string" ? item.card_id : undefined,
    card_name: typeof item.card_name === "string" ? item.card_name : undefined,
    card_image: typeof item.card_image === "string" ? item.card_image : undefined,
    card_set: typeof item.card_set === "string" ? item.card_set : undefined,
    status: isSlotStatus(item.status) ? item.status : "collected",
    collected_at: typeof item.collected_at === "string" ? item.collected_at : new Date().toISOString(),
  }
}

function normalizeCollectionItems(items: Partial<CollectedPokemon>[] | null | undefined) {
  return Array.isArray(items) ? items.map((item) => normalizeCollectionItem(item)) : []
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

export function useCollection(options: UseCollectionOptions = {}) {
  const { initialUser = null, initialCollection = [], initialCollectionOwnerUserId = null } = options
  const [user, setUser] = useState<User | null>(initialUser)
  const [collection, setCollection] = useState<CollectedPokemon[]>(normalizeCollectionItems(initialCollection))
  const [collectionOwnerUserId, setCollectionOwnerUserId] = useState<string | null>(initialCollectionOwnerUserId)
  const [localCollectedCount, setLocalCollectedCount] = useState(0)
  const supabase = createClient()
  const didMount = useRef(false)

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
    setLocalCollectedCount(readLocalCollectedIds().length)
  }, [])

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
  }, [resolveCollectionOwnerUserId, supabase])

  useEffect(() => {
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
  }, [resolveCollectionOwnerUserId, supabase])

  const addToCollection = useCallback(async (
    pokemonId: number,
    pokemonName: string,
    cardId?: string,
    cardName?: string,
    cardImage?: string,
    cardSet?: string,
    status: SlotStatus = 'collected'
  ) => {
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
  }, [collectionOwnerUserId, refreshLocalCollectedCount, supabase, user])

  const removeFromCollection = useCallback(async (pokemonId: number) => {
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
  }, [collectionOwnerUserId, refreshLocalCollectedCount, supabase, user])

  const syncLocalCollectionToDatabase = useCallback(async (
    pokemonCatalog: PokemonCatalogEntry[],
    options: SyncLocalCollectionOptions = {}
  ): Promise<{ data?: SyncLocalCollectionResult; error?: unknown }> => {
    if (!user || !collectionOwnerUserId) return { error: "Not logged in" }

    const localIds = readLocalCollectedIds()
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
      writeLocalCollectedIds(nextCollection.map((item) => item.pokemon_id))
      refreshLocalCollectedCount()

      return {
        data: {
          added: syncedRows.length,
          removed: idsToRemove.length,
          localCount: localIds.length,
          mode: replaceRemote ? "replace" : "merge",
        },
      }
    } catch (error) {
      console.error("[binderdex] Error syncing local collection:", error)
      return { error }
    }
  }, [collection, collectionOwnerUserId, refreshLocalCollectedCount, supabase, user])

  const updateStatus = useCallback(async (pokemonId: number, status: SlotStatus) => {
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
  }, [collection, collectionOwnerUserId, supabase, user])

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
    return collection.some((p) => p.pokemon_id === pokemonId && p.status === "wishlisted")
  }, [collection])

  const getCollectedCard = useCallback((pokemonId: number) => {
    return collection.find(p => p.pokemon_id === pokemonId)
  }, [collection])

  const getCollectionItem = useCallback((pokemonId: number) => {
    return collection.find(p => p.pokemon_id === pokemonId)
  }, [collection])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setCollectionOwnerUserId(null)
    setCollection([])
  }, [supabase])

  return {
    user,
    collection,
    isLoading: false,
    addToCollection,
    removeFromCollection,
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
