"use client"

// Card and illustrator search shared by the Search sheet and Quick mode: debounced card search against the TCG
// mirror (grouped by Pokémon), falling back to the cards on this device when offline, plus fuzzy illustrator
// matches from the directory (saved on the device after the first load).
import { useEffect, useMemo, useRef, useState } from "react"
import { getPokemonSummary } from "@/lib/pokemon-catalog"
import { groupCardResultsByPokemon, parseCardSearchQuery, type CardSearchGroup, type SearchCardResult } from "@/lib/pokemon-card-browse"
import { searchOfflineCards } from "@/lib/offline-card-index"
import { loadIllustratorDirectory } from "@/lib/illustrator-client"
import { normalizeIllustratorText, searchIllustrators, type IllustratorSummary } from "@/lib/illustrators"

const CARD_SEARCH_DEBOUNCE_MS = 250

type CardSearchState = { key: string; groups: CardSearchGroup[]; loading: boolean; offline: boolean }

const groupCards = (cards: SearchCardResult[]) =>
  groupCardResultsByPokemon(cards, (dexId) => getPokemonSummary(dexId)?.name ?? null, { maxGroups: 10, maxCardsPerGroup: 6 })

/**
 * Debounced card search against the TCG mirror, grouped by Pokémon. Offline (or when the API can't be
 * reached) it searches the cards on this device instead and says so.
 */
export function useCardSearch(query: string, enabled: boolean, getOfflineCards?: () => Promise<SearchCardResult[]>) {
  const [state, setState] = useState<CardSearchState>({ key: "", groups: [], loading: false, offline: false })
  const parsed = parseCardSearchQuery(query)
  const key = enabled && (parsed.text.length >= 2 || parsed.cardId) ? query.trim().toLowerCase() : ""
  const offlineCardsRef = useRef<Promise<SearchCardResult[]> | null>(null)
  const getOfflineCardsRef = useRef(getOfflineCards)
  useEffect(() => {
    getOfflineCardsRef.current = getOfflineCards
    offlineCardsRef.current = null
  }, [getOfflineCards])

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const searchOnDevice = async () => {
      const loader = getOfflineCardsRef.current
      if (!loader) return null
      offlineCardsRef.current ??= loader().catch(() => [])
      const cards = await offlineCardsRef.current
      return groupCards(searchOfflineCards(cards, key))
    }
    const showOffline = async () => {
      const groups = await searchOnDevice()
      if (controller.signal.aborted) return
      setState({ key, groups: groups ?? [], loading: false, offline: groups !== null })
    }

    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, key, loading: true }))
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        void showOffline()
        return
      }
      fetch(`/api/tcg-card-search?q=${encodeURIComponent(key)}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`Card search failed (${response.status})`)
          return response.json()
        })
        .then((payload: { cards?: SearchCardResult[] }) => {
          const cards = Array.isArray(payload?.cards) ? payload.cards : []
          setState({ key, groups: groupCards(cards), loading: false, offline: false })
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name === "AbortError" || controller.signal.aborted) return
          void showOffline()
        })
    }, CARD_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  if (!key) return { groups: [] as CardSearchGroup[], loading: false, offline: false }
  return state.key === key
    ? { groups: state.groups, loading: state.loading, offline: state.offline }
    : { groups: [] as CardSearchGroup[], loading: true, offline: false }
}

/** Fuzzy illustrator matches from the directory (loaded once; offline it uses the copy saved on this device). */
export function useIllustratorSearch(query: string, enabled: boolean) {
  const [directory, setDirectory] = useState<IllustratorSummary[] | null>(null)
  const active = enabled && normalizeIllustratorText(query).length >= 2

  useEffect(() => {
    if (!active || directory) return
    let cancelled = false
    void loadIllustratorDirectory().then((result) => {
      if (!cancelled && result.data) setDirectory(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [active, directory])

  return useMemo(() => (active && directory ? searchIllustrators(directory, query, 5) : []), [active, directory, query])
}

