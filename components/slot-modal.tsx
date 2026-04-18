"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { X, Loader2, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useTCGdexCache } from "@/hooks/use-tcgdex-cache"

interface SlotModalProps {
  slot: { page: number; slot: string }
  pokemonName: string
  pokemonId: number
  onClose: () => void
}

export default function SlotModal({ slot, pokemonName, pokemonId, onClose }: SlotModalProps) {
  const [cards, setCards] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedCard, setSelectedCard] = useState<any | null>(null)
  const [language, setLanguage] = useState<"en" | "ja">("en")
  const [filterSet, setFilterSet] = useState<string>("")
  const [filterType, setFilterType] = useState<string>("")
  const [availableSets, setAvailableSets] = useState<string[]>([])
  const [availableTypes, setAvailableTypes] = useState<string[]>([])
  const [debugInfo, setDebugInfo] = useState<string>("")

  const { fetchCardsForPokemon, saveSelectedCard, getSelectedCard } = useTCGdexCache()

  useEffect(() => {
    const loadCards = async () => {
      try {
        setIsLoading(true)
        setDebugInfo(`Loading cards for ${pokemonName} (#${pokemonId})...`)
        console.log(`[v0] SlotModal: Fetching cards for Pokemon #${pokemonId}`)

        const fetchedCards = await fetchCardsForPokemon(pokemonName, pokemonId, language)
        console.log(`[v0] SlotModal: Received ${fetchedCards.length} cards`)
        setDebugInfo(`Loaded ${fetchedCards.length} cards`)

        setCards(fetchedCards)

        // Extract unique sets and types for filtering
        const sets = [...new Set(fetchedCards.map((c) => c.set))] as string[]
        const types = [...new Set(fetchedCards.map((c) => c.cardType).filter(Boolean))] as string[]
        setAvailableSets(sets)
        setAvailableTypes(types)

        const previouslySelected = getSelectedCard(slot.page, slot.slot)
        setSelectedCard(previouslySelected)

        setIsLoading(false)
      } catch (error) {
        console.error(`[v0] Error in loadCards:`, error)
        setDebugInfo(`Error: ${error instanceof Error ? error.message : String(error)}`)
        setIsLoading(false)
      }
    }

    loadCards()
  }, [slot, pokemonName, pokemonId, language])

  const handleSelectCard = (card: any) => {
    setSelectedCard(card)
    saveSelectedCard(slot.page, slot.slot, card)
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const filteredCards = cards.filter((card) => {
    if (filterSet && card.set !== filterSet) return false
    if (filterType && card.cardType !== filterType) return false
    return true
  })

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in"
      onClick={handleBackdropClick}
    >
      <Card className="bg-card max-w-4xl w-full border-2 border-primary/20 max-h-[90vh] overflow-y-auto animate-scale-in flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-accent p-4 text-primary-foreground flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold">
              {pokemonName} • Page {slot.page} • Slot {slot.slot}
            </h2>
            <p className="text-xs opacity-70 mt-1">{debugInfo}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 space-y-4">
          {/* Language Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setLanguage("en")}
              className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
                language === "en" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              English
            </button>
            <button
              onClick={() => setLanguage("ja")}
              className={`px-3 py-1 rounded text-sm font-semibold transition-colors ${
                language === "ja" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              日本語
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : cards.length > 0 ? (
            <>
              {/* Selected Card Preview */}
              {selectedCard && (
                <div className="bg-primary/10 border-2 border-primary/30 rounded-lg p-4">
                  <p className="text-sm font-semibold text-muted-foreground mb-3">Selected Card</p>
                  <div className="flex items-center gap-4">
                    <img
                      src={selectedCard.image || "/placeholder.svg"}
                      alt={selectedCard.name}
                      className="w-24 h-32 object-cover rounded border border-primary/20"
                    />
                    <div>
                      <h3 className="font-bold text-lg">{selectedCard.name}</h3>
                      <p className="text-sm text-muted-foreground">{selectedCard.set}</p>
                      <p className="text-sm text-muted-foreground">#{selectedCard.number}</p>
                      {selectedCard.cardType && (
                        <p className="text-sm text-primary font-semibold mt-1">Type: {selectedCard.cardType}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-2 border border-border">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Filters
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={filterSet}
                    onChange={(e) => setFilterSet(e.target.value)}
                    className="px-2 py-1 rounded text-sm bg-card border border-border"
                  >
                    <option value="">All Sets</option>
                    {availableSets.map((set) => (
                      <option key={set} value={set}>
                        {set}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="px-2 py-1 rounded text-sm bg-card border border-border"
                  >
                    <option value="">All Types</option>
                    {availableTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Available Cards Grid */}
              <div>
                <h3 className="text-sm font-bold text-muted-foreground mb-3">
                  Available Cards ({filteredCards.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredCards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => handleSelectCard(card)}
                      className={`relative group cursor-pointer transition-all ${
                        selectedCard?.id === card.id ? "ring-2 ring-primary" : ""
                      }`}
                    >
                      <img
                        src={card.image || "/placeholder.svg"}
                        alt={card.name}
                        className={`w-full aspect-[3/4] object-cover rounded-lg border-2 transition-all ${
                          selectedCard?.id === card.id
                            ? "border-primary shadow-lg"
                            : "border-border hover:border-primary/50"
                        }`}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors" />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-lg">
                        <p className="text-white text-xs font-bold truncate">{card.set}</p>
                        <p className="text-white/80 text-xs">#{card.number}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8">No cards found for this Pokémon</p>
          )}
        </div>

        {/* Close Button */}
        <div className="p-4 border-t border-border sticky bottom-0 bg-card">
          <Button onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </Card>
    </div>
  )
}
