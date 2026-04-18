"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
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

export function useCollection() {
  const [user, setUser] = useState<User | null>(null)
  const [collection, setCollection] = useState<CollectedPokemon[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  // Load user and collection on mount
  useEffect(() => {
    const loadUserAndCollection = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        setUser(user)

        if (user) {
          const { data, error } = await supabase
            .from("pokemon_collection")
            .select("*")
            .eq("user_id", user.id)
            .order("pokemon_id", { ascending: true })

          if (error) throw error
          setCollection(data || [])
        }
      } catch (error) {
        console.error("[v0] Error loading collection:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadUserAndCollection()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
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

      return { data }
    } catch (error) {
      console.error("[v0] Error adding to collection:", error)
      return { error }
    }
  }, [user, supabase])

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
      return { success: true }
    } catch (error) {
      console.error("[v0] Error removing from collection:", error)
      return { error }
    }
  }, [user, supabase])

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
      console.error("[v0] Error updating status:", error)
      return { error }
    }
  }, [user, supabase])

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
    isLoading,
    addToCollection,
    removeFromCollection,
    updateStatus,
    cycleStatus,
    isCollected,
    getCollectedCard,
    getCollectionItem,
    signOut,
    collectionCount: collection.length,
  }
}
