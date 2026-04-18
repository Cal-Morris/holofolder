"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { addLocalCollectedId, readLocalCollectedIds, removeLocalCollectedId, writeLocalCollectedIds } from "@/lib/local-collection"
import type { User } from "@supabase/supabase-js"

export type SlotStatus = 'collected' | 'finalized' | 'considering'

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
}

export function useCollection(options: UseCollectionOptions = {}) {
  const { initialUser = null, initialCollection = [] } = options
  const [user, setUser] = useState<User | null>(initialUser)
  const [collection, setCollection] = useState<CollectedPokemon[]>(initialCollection)
  const [localCollectedCount, setLocalCollectedCount] = useState(0)
  const supabase = createClient()
  const didMount = useRef(false)

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
          const { data, error } = await supabase
            .from("pokemon_collection")
            .select("*")
            .eq("user_id", currentUser.id)
            .order("pokemon_id", { ascending: true })

          if (error) throw error
          setCollection(data || [])
        }
      } catch (error) {
        console.error("[binderdex] Error loading collection:", error)
      }
    }

    reloadCollection()
  }, [supabase])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)

      if (session?.user) {
        const { data } = await supabase
          .from("pokemon_collection")
          .select("*")
          .eq("user_id", session.user.id)
          .order("pokemon_id", { ascending: true })

        setCollection(data || [])
      } else {
        setCollection([])
      }
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  const addToCollection = useCallback(async (
    pokemonId: number,
    pokemonName: string,
    cardId?: string,
    cardName?: string,
    cardImage?: string,
    cardSet?: string,
    status: SlotStatus = 'collected'
  ) => {
    if (!user) return { error: "Not logged in" }

    try {
      const { data, error } = await supabase
        .from("pokemon_collection")
        .upsert({
          user_id: user.id,
          pokemon_id: pokemonId,
          pokemon_name: pokemonName,
          card_id: cardId,
          card_name: cardName,
          card_image: cardImage,
          card_set: cardSet,
          status,
        }, {
          onConflict: "user_id,pokemon_id"
        })
        .select()
        .single()

      if (error) throw error

      setCollection(prev => {
        const existing = prev.findIndex(p => p.pokemon_id === pokemonId)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = data
          return updated
        }
        return [...prev, data].sort((a, b) => a.pokemon_id - b.pokemon_id)
      })

      addLocalCollectedId(pokemonId)
      refreshLocalCollectedCount()

      return { data }
    } catch (error) {
      console.error("[binderdex] Error adding to collection:", error)
      return { error }
    }
  }, [refreshLocalCollectedCount, supabase, user])

  const removeFromCollection = useCallback(async (pokemonId: number) => {
    if (!user) return { error: "Not logged in" }

    try {
      const { error } = await supabase
        .from("pokemon_collection")
        .delete()
        .eq("user_id", user.id)
        .eq("pokemon_id", pokemonId)

      if (error) throw error

      setCollection(prev => prev.filter(p => p.pokemon_id !== pokemonId))
      removeLocalCollectedId(pokemonId)
      refreshLocalCollectedCount()

      return { success: true }
    } catch (error) {
      console.error("[binderdex] Error removing from collection:", error)
      return { error }
    }
  }, [refreshLocalCollectedCount, supabase, user])

  const syncLocalCollectionToDatabase = useCallback(async (
    pokemonCatalog: PokemonCatalogEntry[],
    options: SyncLocalCollectionOptions = {}
  ): Promise<{ data?: SyncLocalCollectionResult; error?: unknown }> => {
    if (!user) return { error: "Not logged in" }

    const localIds = readLocalCollectedIds()
    const localSet = new Set(localIds)
    const remoteById = new Map(collection.map((item) => [item.pokemon_id, item] as const))
    const catalogNames = new Map(pokemonCatalog.map((pokemon) => [pokemon.id, pokemon.name] as const))
    const replaceRemote = options.replaceRemote === true

    const idsToAdd = localIds.filter((pokemonId) => !remoteById.has(pokemonId))
    const idsToRemove = replaceRemote
      ? collection
          .filter((item) => !localSet.has(item.pokemon_id))
          .map((item) => item.pokemon_id)
      : []

    try {
      if (replaceRemote && idsToRemove.length > 0) {
        const { error } = await supabase
          .from("pokemon_collection")
          .delete()
          .eq("user_id", user.id)
          .in("pokemon_id", idsToRemove)

        if (error) throw error
      }

      let syncedRows: CollectedPokemon[] = []

      if (replaceRemote && localIds.length > 0) {
        const rowsToReplace = localIds.map((pokemonId) => ({
          user_id: user.id,
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
        syncedRows = data || []
      } else if (idsToAdd.length > 0) {
        const rowsToInsert = idsToAdd.map((pokemonId) => ({
          user_id: user.id,
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
        syncedRows = data || []
      }

      const keptRows = replaceRemote
        ? []
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
  }, [collection, refreshLocalCollectedCount, supabase, user])

  const updateStatus = useCallback(async (pokemonId: number, status: SlotStatus) => {
    if (!user) return { error: "Not logged in" }

    try {
      const { data, error } = await supabase
        .from("pokemon_collection")
        .update({ status })
        .eq("user_id", user.id)
        .eq("pokemon_id", pokemonId)
        .select()
        .single()

      if (error) throw error

      setCollection(prev => prev.map(p =>
        p.pokemon_id === pokemonId ? { ...p, status } : p
      ))
      return { data }
    } catch (error) {
      console.error("[binderdex] Error updating status:", error)
      return { error }
    }
  }, [supabase, user])

  const cycleStatus = useCallback(async (pokemonId: number) => {
    const item = collection.find(p => p.pokemon_id === pokemonId)
    if (!item) return { error: "Not in collection" }

    const statusOrder: SlotStatus[] = ['collected', 'considering', 'finalized']
    const currentIndex = statusOrder.indexOf(item.status || 'collected')
    const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length]

    return updateStatus(pokemonId, nextStatus)
  }, [collection, updateStatus])

  const isCollected = useCallback((pokemonId: number) => {
    return collection.some(p => p.pokemon_id === pokemonId)
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
    getCollectedCard,
    getCollectionItem,
    signOut,
    syncLocalCollectionToDatabase,
    localCollectedCount,
    collectionCount: collection.length,
  }
}
