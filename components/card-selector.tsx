"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useTCGdex, type TCGCard, type CardFilters } from "@/hooks/use-tcgdex"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { buildCardImageDescriptor, compareCardImageDescriptors, type CardImageDescriptor } from "@/lib/card-image-match"
import { X, Search, Check, Loader2, Camera } from "lucide-react"

interface CardSelectorProps {
  pokemonId: number
  pokemonName: string
  onSelect: (card: TCGCard | null) => void
  onClose: () => void
  selectedCardId?: string
}

const ALL_FILTERS_VALUE = "__all__"

interface CardScanMatch {
  card: TCGCard
  similarity: number
}

export default function CardSelector({
  pokemonId,
  pokemonName,
  onSelect,
  onClose,
  selectedCardId,
}: CardSelectorProps) {
  const { fetchCardsForPokemon, filterCards, isLoading, error } = useTCGdex()
  const [cards, setCards] = useState<TCGCard[]>([])
  const [filters, setFilters] = useState<CardFilters>({})
  const [isScanningCard, setIsScanningCard] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null)
  const [scanMatches, setScanMatches] = useState<CardScanMatch[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const descriptorCacheRef = useRef<Map<string, Promise<CardImageDescriptor | null>>>(new Map())

  useEffect(() => {
    const load = async () => {
      const cardsData = await fetchCardsForPokemon(pokemonId)
      setCards(cardsData)
    }
    load()
  }, [pokemonId, fetchCardsForPokemon])

  useEffect(() => {
    descriptorCacheRef.current.clear()
    setScanError(null)
    setScanMatches([])
    setScanPreviewUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return null
    })
  }, [pokemonId])

  useEffect(() => {
    return () => {
      if (scanPreviewUrl) {
        URL.revokeObjectURL(scanPreviewUrl)
      }
    }
  }, [scanPreviewUrl])

  const filteredCards = useMemo(() => filterCards(cards, filters), [cards, filters, filterCards])
  const scanRankById = useMemo(() => {
    return new Map(scanMatches.map((match, index) => [match.card.id, index + 1]))
  }, [scanMatches])
  const displayedCards = useMemo(() => {
    if (scanRankById.size === 0) {
      return filteredCards
    }

    return [...filteredCards].sort((left, right) => {
      const leftRank = scanRankById.get(left.id) ?? Number.POSITIVE_INFINITY
      const rightRank = scanRankById.get(right.id) ?? Number.POSITIVE_INFINITY

      if (leftRank !== rightRank) {
        return leftRank - rightRank
      }

      return left.localId.localeCompare(right.localId, undefined, { numeric: true, sensitivity: "base" })
    })
  }, [filteredCards, scanRankById])

  const uniqueSets = useMemo(() => {
    return [...new Map(cards.map((card) => [card.set.id, card.set])).values()]
      .filter((set) => Boolean(set.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [cards])

  const uniqueRarities = useMemo(() => {
    return [...new Set(cards.map((c) => c.rarity).filter(Boolean))] as string[]
  }, [cards])

  async function getDescriptorForCard(card: TCGCard) {
    if (!card.image) {
      return null
    }

    const existingPromise = descriptorCacheRef.current.get(card.id)
    if (existingPromise) {
      return existingPromise
    }

    const proxyUrl = card.image.startsWith("/")
      ? card.image
      : `/api/card-image-proxy?url=${encodeURIComponent(card.image)}`

    const descriptorPromise = buildCardImageDescriptor(proxyUrl).catch(() => null)
    descriptorCacheRef.current.set(card.id, descriptorPromise)
    return descriptorPromise
  }

  async function handleScanFile(file: File) {
    const candidates = cards.filter((card) => Boolean(card.image))
    if (candidates.length === 0) {
      setScanError("There are no card images loaded for this Pokemon yet.")
      return
    }

    setIsScanningCard(true)
    setScanError(null)
    setScanMatches([])
    setScanPreviewUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return URL.createObjectURL(file)
    })

    try {
      const queryDescriptor = await buildCardImageDescriptor(file)
      const scoredMatches = (
        await Promise.all(
          candidates.map(async (card) => {
            const descriptor = await getDescriptorForCard(card)
            if (!descriptor) {
              return null
            }

            const match = compareCardImageDescriptors(queryDescriptor, descriptor)
            return {
              card,
              similarity: match.similarity,
            }
          }),
        )
      )
        .filter((match): match is CardScanMatch => Boolean(match))
        .sort((left, right) => right.similarity - left.similarity)

      if (scoredMatches.length === 0) {
        setScanError("The scan could not compare that image to the loaded card set.")
        return
      }

      setScanMatches(scoredMatches.slice(0, 6))
    } catch (scanError) {
      console.error(scanError)
      setScanError("The card scan failed. Try again with the card filling most of the frame.")
    } finally {
      setIsScanningCard(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-4xl max-h-[90vh] bg-card rounded-xl border border-border overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
          <div>
            <h2 className="text-lg font-semibold">Pick Card for {pokemonName}</h2>
            <p className="text-sm text-muted-foreground">
              {filteredCards.length} of {cards.length} cards
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Choose a specific printing, or scan one card photo to rank the closest matches from the loaded set.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.currentTarget.value = ""
                if (file) {
                  void handleScanFile(file)
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || cards.length === 0 || isScanningCard}
            >
              {isScanningCard ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
              Scan card
            </Button>
            <Button variant="outline" size="sm" onClick={() => onSelect(null)}>
              Skip card
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
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
          <div className="flex flex-wrap gap-3">
            <Select
              value={filters.set || ALL_FILTERS_VALUE}
              onValueChange={(value) => setFilters((f) => ({ ...f, set: value === ALL_FILTERS_VALUE ? undefined : value }))}
            >
              <SelectTrigger className="h-11 min-w-[180px] rounded-xl bg-background/80 px-4 text-left shadow-none sm:flex-1 md:flex-none">
                <SelectValue placeholder="All Sets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTERS_VALUE}>All Sets</SelectItem>
                {uniqueSets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {set.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.rarity || ALL_FILTERS_VALUE}
              onValueChange={(value) =>
                setFilters((f) => ({ ...f, rarity: value === ALL_FILTERS_VALUE ? undefined : value }))
              }
            >
              <SelectTrigger className="h-11 min-w-[180px] rounded-xl bg-background/80 px-4 text-left shadow-none sm:flex-1 md:flex-none">
                <SelectValue placeholder="All Rarities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTERS_VALUE}>All Rarities</SelectItem>
                {uniqueRarities.map((rarity) => (
                  <SelectItem key={rarity} value={rarity}>
                    {rarity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.variant || ALL_FILTERS_VALUE}
              onValueChange={(value) =>
                setFilters((f) => ({ ...f, variant: value === ALL_FILTERS_VALUE ? undefined : value }))
              }
            >
              <SelectTrigger className="h-11 min-w-[180px] rounded-xl bg-background/80 px-4 text-left shadow-none sm:flex-1 md:flex-none">
                <SelectValue placeholder="All Variants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTERS_VALUE}>All Variants</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="holo">Holo</SelectItem>
                <SelectItem value="reverse">Reverse Holo</SelectItem>
                <SelectItem value="firstEdition">1st Edition</SelectItem>
              </SelectContent>
            </Select>
            {(filters.set || filters.rarity || filters.variant || filters.searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({})}
                className="h-11 rounded-xl px-4 text-muted-foreground"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>

        {(isScanningCard || scanError || scanMatches.length > 0 || scanPreviewUrl) && (
          <div className="border-b border-border bg-background/70 p-4">
            <div className="flex flex-col gap-4 lg:flex-row">
              {scanPreviewUrl && (
                <div className="w-full max-w-[180px] shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
                  <img src={scanPreviewUrl} alt="Scanned card preview" className="h-full w-full object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium">Single-card scan</p>
                  <p className="text-xs text-muted-foreground">
                    Scan works against the cards already loaded for {pokemonName}. Fill the frame with one card for the best match.
                  </p>
                </div>
                {isScanningCard && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Comparing your photo against {cards.length} loaded cards…
                  </div>
                )}
                {scanError && <div className="text-sm text-destructive">{scanError}</div>}
                {scanMatches.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {scanMatches.map((match, index) => (
                      <button
                        key={match.card.id}
                        onClick={() => onSelect(match.card)}
                        className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/60"
                      >
                        {match.card.image ? (
                          <img
                            src={match.card.image}
                            alt={match.card.name}
                            className="h-20 w-14 shrink-0 rounded-md object-cover bg-muted"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-20 w-14 shrink-0 rounded-md bg-muted" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
                            {index === 0 ? "Best Match" : `Match ${index + 1}`}
                          </p>
                          <p className="truncate text-sm font-medium">{match.card.set.name}</p>
                          <p className="text-xs text-muted-foreground">#{match.card.localId}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Similarity {Math.round(match.similarity * 100)}%
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
              {displayedCards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => onSelect(card)}
                  className={`relative group rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                    selectedCardId === card.id
                      ? "border-primary ring-2 ring-primary/50"
                      : "border-transparent hover:border-primary/50"
                  }`}
                >
                  {scanRankById.has(card.id) && (
                    <div className="absolute left-2 top-2 z-10 rounded-full bg-black/80 px-2 py-1 text-[10px] font-medium text-white">
                      Match {scanRankById.get(card.id)}
                    </div>
                  )}
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
