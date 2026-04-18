"use client"

import { useState, useEffect, useMemo } from "react"
import { useTCGdex, type TCGCard, type CardFilters } from "@/hooks/use-tcgdex"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X, Search, Check, Loader2 } from "lucide-react"

interface CardSelectorProps {
  pokemonId: number
  pokemonName: string
  onSelect: (card: TCGCard) => void
  onClose: () => void
  selectedCardId?: string
}

export default function CardSelector({
  pokemonId,
  pokemonName,
  onSelect,
  onClose,
  selectedCardId,
}: CardSelectorProps) {
  const { fetchCardsForPokemon, fetchSets, filterCards, isLoading, error } = useTCGdex()
  const [cards, setCards] = useState<TCGCard[]>([])
  const [sets, setSets] = useState<{ id: string; name: string }[]>([])
  const [filters, setFilters] = useState<CardFilters>({})

  useEffect(() => {
    const load = async () => {
      const [cardsData, setsData] = await Promise.all([
        fetchCardsForPokemon(pokemonId),
        fetchSets(),
      ])
      setCards(cardsData)
      setSets(setsData)
    }
    load()
  }, [pokemonId, fetchCardsForPokemon, fetchSets])

  const filteredCards = useMemo(() => filterCards(cards, filters), [cards, filters, filterCards])

  const uniqueSets = useMemo(() => {
    const setIds = new Set(cards.map((c) => c.set.id).filter(Boolean))
    return sets.filter((s) => setIds.has(s.id))
  }, [cards, sets])

  const uniqueRarities = useMemo(() => {
    return [...new Set(cards.map((c) => c.rarity).filter(Boolean))] as string[]
  }, [cards])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-4xl max-h-[90vh] bg-card rounded-xl border border-border overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
          <div>
            <h2 className="text-lg font-semibold">Select Card for {pokemonName}</h2>
            <p className="text-sm text-muted-foreground">
              {filteredCards.length} of {cards.length} cards
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, number, or set..."
              value={filters.searchQuery || ""}
              onChange={(e) => setFilters((f) => ({ ...f, searchQuery: e.target.value }))}
              className="flex-1"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
              value={filters.set || ""}
              onChange={(e) => setFilters((f) => ({ ...f, set: e.target.value || undefined }))}
            >
              <option value="">All Sets</option>
              {uniqueSets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>
            <select
              className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
              value={filters.rarity || ""}
              onChange={(e) => setFilters((f) => ({ ...f, rarity: e.target.value || undefined }))}
            >
              <option value="">All Rarities</option>
              {uniqueRarities.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {rarity}
                </option>
              ))}
            </select>
            <select
              className="px-3 py-1.5 bg-background border border-border rounded-md text-sm"
              value={filters.variant || ""}
              onChange={(e) => setFilters((f) => ({ ...f, variant: e.target.value || undefined }))}
            >
              <option value="">All Variants</option>
              <option value="normal">Normal</option>
              <option value="holo">Holo</option>
              <option value="reverse">Reverse Holo</option>
              <option value="firstEdition">1st Edition</option>
            </select>
            {(filters.set || filters.rarity || filters.variant || filters.searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({})}
                className="text-muted-foreground"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>

        {/* Cards Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading cards...</span>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive">{error}</div>
          ) : filteredCards.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {cards.length === 0 ? "No cards found for this Pokemon" : "No cards match your filters"}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filteredCards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => onSelect(card)}
                  className={`relative group rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                    selectedCardId === card.id
                      ? "border-primary ring-2 ring-primary/50"
                      : "border-transparent hover:border-primary/50"
                  }`}
                >
                  {card.image ? (
                    <img
                      src={card.image}
                      alt={card.name}
                      className="w-full aspect-[2.5/3.5] object-cover bg-muted"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-[2.5/3.5] bg-muted flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">No Image</span>
                    </div>
                  )}
                  {selectedCardId === card.id && (
                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                      <Check className="h-3 w-3" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="text-xs text-white font-medium truncate">{card.set.name}</p>
                    <p className="text-[10px] text-white/70">#{card.localId}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
