"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Moon, Sun, Settings, LogIn, LogOut, Grid3X3, Search as SearchIcon, ChevronLeft, ChevronRight, Users, Sparkles, Check, X, ChevronsLeft, ChevronsRight, Star, HelpCircle } from "lucide-react"
import PokemonSearch from "@/components/pokemon-search"
import SettingsModal from "@/components/settings-modal"
import AuthModal from "@/components/auth-modal"
import PartnerModal from "@/components/partner-modal"
import CardSelector from "@/components/card-selector"
import { usePokemonCache } from "@/hooks/use-pokemon-cache"
import { useCollection } from "@/hooks/use-collection"
import { useSettings } from "@/hooks/use-settings"
import { useTouchGestures } from "@/hooks/use-touch-gestures"
import { Button } from "@/components/ui/button"

const GENERATIONS = [
  { id: 0, name: "All Generations", start: 1, end: 1025, region: "" },
  { id: 1, name: "Generation I", start: 1, end: 151, region: "Kanto" },
  { id: 2, name: "Generation II", start: 152, end: 251, region: "Johto" },
  { id: 3, name: "Generation III", start: 252, end: 386, region: "Hoenn" },
  { id: 4, name: "Generation IV", start: 387, end: 493, region: "Sinnoh" },
  { id: 5, name: "Generation V", start: 494, end: 649, region: "Unova" },
  { id: 6, name: "Generation VI", start: 650, end: 721, region: "Kalos" },
  { id: 7, name: "Generation VII", start: 722, end: 809, region: "Alola" },
  { id: 8, name: "Generation VIII", start: 810, end: 905, region: "Galar" },
  { id: 9, name: "Generation IX", start: 906, end: 1025, region: "Paldea" },
]

type ViewMode = "search" | "browse"

export default function Home() {
  const [selectedPokemon, setSelectedPokemon] = useState<any>(null)
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isPartnerOpen, setIsPartnerOpen] = useState(false)
  const [isCardSelectorOpen, setIsCardSelectorOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("browse")
  const [selectedGen, setSelectedGen] = useState(0)
  const [currentBinderPage, setCurrentBinderPage] = useState(1)
  const [showCollectedOnly, setShowCollectedOnly] = useState(false)
  const [longPressedPokemon, setLongPressedPokemon] = useState<{ id: number; name: string } | null>(null)
  const [isPageTransitioning, setIsPageTransitioning] = useState(false)
  const [transitionDirection, setTransitionDirection] = useState<"left" | "right" | null>(null)
  
  const { pokemonList, isLoading: isPokemonLoading, progress } = usePokemonCache()
  const { user, isCollected, addToCollection, removeFromCollection, cycleStatus, collectionCount, signOut, isLoading: isCollectionLoading, getCollectionItem, collection } = useCollection()
  const { settings, updateSettings } = useSettings()

  const slotsPerPage = settings.binderRows * settings.binderCols
  
  const filteredPokemonList = useMemo(() => {
    let list = pokemonList
    
    if (selectedGen !== 0) {
      const gen = GENERATIONS[selectedGen]
      list = list.filter(p => p.id >= gen.start && p.id <= gen.end)
    }
    
    if (showCollectedOnly) {
      const collectedIds = new Set(collection.map(c => c.pokemon_id))
      list = list.filter(p => collectedIds.has(p.id))
    }
    
    return list
  }, [pokemonList, selectedGen, showCollectedOnly, collection])

  const totalBinderPages = Math.max(1, Math.ceil(filteredPokemonList.length / slotsPerPage))

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentBinderPage(1)
  }, [selectedGen, showCollectedOnly, slotsPerPage])

  const currentPagePokemon = useMemo(() => {
    const startIdx = (currentBinderPage - 1) * slotsPerPage
    return filteredPokemonList.slice(startIdx, startIdx + slotsPerPage)
  }, [filteredPokemonList, currentBinderPage, slotsPerPage])

  // Collection stats for current generation
  const collectionStats = useMemo(() => {
    const gen = GENERATIONS[selectedGen]
    const genPokemon = pokemonList.filter(p => p.id >= gen.start && p.id <= gen.end)
    const collected = genPokemon.filter(p => isCollected(p.id)).length
    return { collected, total: genPokemon.length, percentage: Math.round((collected / genPokemon.length) * 100) || 0 }
  }, [pokemonList, selectedGen, isCollected])

  // Page navigation with animation
  const navigateToPage = useCallback((page: number, direction: "left" | "right") => {
    if (page < 1 || page > totalBinderPages || page === currentBinderPage) return
    
    setTransitionDirection(direction)
    setIsPageTransitioning(true)
    
    setTimeout(() => {
      setCurrentBinderPage(page)
      setTimeout(() => {
        setIsPageTransitioning(false)
        setTransitionDirection(null)
      }, 50)
    }, 150)
  }, [currentBinderPage, totalBinderPages])

  const goToNextPage = useCallback(() => {
    if (currentBinderPage < totalBinderPages) {
      navigateToPage(currentBinderPage + 1, "left")
    }
  }, [currentBinderPage, totalBinderPages, navigateToPage])

  const goToPrevPage = useCallback(() => {
    if (currentBinderPage > 1) {
      navigateToPage(currentBinderPage - 1, "right")
    }
  }, [currentBinderPage, navigateToPage])

  // Swipe gestures for binder
  const { ref: binderRef, isSwiping, didSwipe } = useTouchGestures<HTMLDivElement>({
    onSwipeLeft: goToNextPage,
    onSwipeRight: goToPrevPage,
    swipeThreshold: 60,
  })

  const handleToggleCollected = async () => {
    if (!selectedPokemon) return
    
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (isCollected(selectedPokemon.id)) {
      await removeFromCollection(selectedPokemon.id)
    } else {
      setIsCardSelectorOpen(true)
    }
  }

  const handleQuickCollect = async (pokemon: { id: number; name: string }) => {
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (isCollected(pokemon.id)) {
      await removeFromCollection(pokemon.id)
    } else {
      // Quick collect without card selection
      await addToCollection(pokemon.id, pokemon.name)
    }
    setLongPressedPokemon(null)
  }

  const handleCardSelected = async (card: any | null) => {
    if (!selectedPokemon) return
    await addToCollection(
      selectedPokemon.id, 
      selectedPokemon.name,
      card?.id,
      card?.name,
      card?.image,
      card?.set?.name
    )
    setIsCardSelectorOpen(false)
  }

  const handlePokemonSelect = async (pokemon: any) => {
    setSelectedPokemon(pokemon)
    const idx = filteredPokemonList.findIndex(p => p.id === pokemon.id)
    if (idx !== -1) {
      const targetPage = Math.ceil((idx + 1) / slotsPerPage)
      setCurrentBinderPage(targetPage)
    }
  }

  const handleSlotClick = (pokemon: { id: number; name: string }) => {
    // Don't select if we just finished swiping
    if (isSwiping || didSwipe()) return
    
    if (longPressedPokemon?.id === pokemon.id) {
      setLongPressedPokemon(null)
      return
    }
    fetch(`https://pokeapi.co/api/v2/pokemon/${pokemon.id}`)
      .then(res => res.json())
      .then(data => setSelectedPokemon(data))
  }

  const handleLongPress = (pokemon: { id: number; name: string }) => {
    setLongPressedPokemon(pokemon)
    if (navigator.vibrate) {
      navigator.vibrate(30)
    }
  }

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
    document.documentElement.classList.toggle("dark")
  }

  const collected = selectedPokemon ? isCollected(selectedPokemon.id) : false
  const collectionItem = selectedPokemon ? getCollectionItem(selectedPokemon.id) : null

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== "browse") return
      if (e.key === "ArrowLeft") goToPrevPage()
      if (e.key === "ArrowRight") goToNextPage()
      if (e.key === "Escape") {
        setSelectedPokemon(null)
        setLongPressedPokemon(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [viewMode, goToPrevPage, goToNextPage])

  // Close long press menu when clicking outside
  useEffect(() => {
    if (longPressedPokemon) {
      const handleClick = () => setLongPressedPokemon(null)
      setTimeout(() => window.addEventListener("click", handleClick), 0)
      return () => window.removeEventListener("click", handleClick)
    }
  }, [longPressedPokemon])

  return (
    <main className="min-h-screen bg-background select-none">
      {/* Premium Loading Bar */}
      {isPokemonLoading && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="h-0.5 bg-muted overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-primary via-secondary to-primary transition-all duration-300 ease-out" 
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>
      )}

      {/* Glass Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40 safe-area-top">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-base font-bold tracking-tight">BinderDex</span>
          </div>
          
          <div className="flex items-center gap-1.5">
            {user && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 rounded-full border border-primary/20">
                <span className="text-sm font-bold text-primary">{collectionCount}</span>
                <span className="text-xs text-primary/70">collected</span>
              </div>
            )}
            
            {user ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setIsPartnerOpen(true)} className="gap-1.5 h-8 px-2.5">
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline text-xs">Partner</span>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={signOut}>
                  <LogOut className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setIsAuthOpen(true)} className="gap-1.5 h-8">
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline text-xs">Sign In</span>
              </Button>
            )}
            
            <div className="w-px h-5 bg-border/50 mx-0.5" />
            
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsSettingsOpen(true)}>
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleDarkMode}>
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto pt-16 px-3 sm:px-4 pb-28">
        {/* Controls Bar */}
        <div className="sticky top-14 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2.5 bg-background/90 backdrop-blur-lg border-b border-border/30 mb-4">
          <div className="flex flex-col gap-2.5">
            {/* Top Row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* View Mode Toggle */}
              <div className="flex bg-muted/40 rounded-lg p-0.5 border border-border/30">
                <button
                  onClick={() => setViewMode("search")}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                    viewMode === "search" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <SearchIcon className="w-3.5 h-3.5" />
                  <span>Search</span>
                </button>
                <button
                  onClick={() => setViewMode("browse")}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                    viewMode === "browse" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  <span>Binder</span>
                </button>
              </div>

              {/* Generation Selector */}
              <div className="flex items-center">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedGen(prev => prev > 0 ? prev - 1 : GENERATIONS.length - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <select
                  value={selectedGen}
                  onChange={(e) => setSelectedGen(Number(e.target.value))}
                  className="h-7 bg-muted/40 border border-border/30 rounded-lg px-2 text-xs font-medium min-w-[100px] cursor-pointer"
                >
                  {GENERATIONS.map((gen) => (
                    <option key={gen.id} value={gen.id}>
                      {gen.id === 0 ? "All" : `Gen ${gen.id}`}{gen.region ? ` ${gen.region}` : ""}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedGen(prev => prev < GENERATIONS.length - 1 ? prev + 1 : 0)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Collected Filter */}
              {user && (
                <button
                  onClick={() => setShowCollectedOnly(!showCollectedOnly)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    showCollectedOnly 
                      ? "bg-green-500/10 border-green-500/30 text-green-500" 
                      : "bg-muted/40 border-border/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{showCollectedOnly ? "Showing Collected" : "All"}</span>
                </button>
              )}
            </div>

            {/* Progress Bar */}
            {user && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-700 ease-out rounded-full" 
                    style={{ width: `${collectionStats.percentage}%` }} 
                  />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap tabular-nums">
                  {collectionStats.collected}/{collectionStats.total}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Search View */}
        {viewMode === "search" && (
          <div className="space-y-4 animate-fade-in">
            <PokemonSearch onSelect={handlePokemonSelect} pokemonList={filteredPokemonList} />

            {selectedPokemon && (
              <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-xl animate-scale-in">
                <div className="flex items-center gap-3">
                  <div className="relative w-20 h-20 rounded-xl bg-gradient-to-br from-muted to-muted/30 flex items-center justify-center shrink-0">
                    <img
                      src={selectedPokemon.sprites?.other?.["official-artwork"]?.front_default || selectedPokemon.sprites?.front_default || "/placeholder.svg"}
                      alt={selectedPokemon.name}
                      className="w-16 h-16 object-contain"
                    />
                    {collected && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center border-2 border-background shadow-lg">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground font-semibold">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                    <h2 className="text-xl font-bold capitalize truncate">{selectedPokemon.name}</h2>
                    {collectionItem?.card_name && (
                      <p className="text-xs text-primary mt-0.5 truncate">{collectionItem.card_name}</p>
                    )}
                  </div>
                  <Button
                    onClick={handleToggleCollected}
                    disabled={isCollectionLoading}
                    variant={collected ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5 shrink-0"
                  >
                    {collected ? <Check className="w-3.5 h-3.5" /> : null}
                    {collected ? "Got it" : user ? "Collect" : "Sign in"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Binder View */}
        {viewMode === "browse" && (
          <div className="space-y-3 animate-fade-in">
            {/* Page Navigation - Compact */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateToPage(1, "right")} disabled={currentBinderPage === 1}>
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPrevPage} disabled={currentBinderPage === 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={totalBinderPages}
                  value={currentBinderPage}
                  onChange={(e) => {
                    const page = parseInt(e.target.value)
                    if (page >= 1 && page <= totalBinderPages) {
                      setCurrentBinderPage(page)
                    }
                  }}
                  className="w-12 h-7 bg-muted/40 border border-border/30 rounded-lg text-xs text-center font-semibold tabular-nums"
                />
                <span className="text-xs text-muted-foreground">of {totalBinderPages}</span>
              </div>

              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextPage} disabled={currentBinderPage === totalBinderPages}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateToPage(totalBinderPages, "left")} disabled={currentBinderPage === totalBinderPages}>
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Binder Grid */}
            <div 
              ref={binderRef}
              className={`relative transition-all duration-150 ${
                isPageTransitioning 
                  ? transitionDirection === "left" 
                    ? "opacity-0 -translate-x-4" 
                    : "opacity-0 translate-x-4"
                  : "opacity-100 translate-x-0"
              }`}
            >
              {/* Binder Page Effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-card via-card to-card/80 rounded-2xl border border-border/50 shadow-2xl -z-10" />
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent rounded-2xl -z-10" />
              
              <div 
                className="p-3 sm:p-4"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${settings.binderCols}, minmax(0, 1fr))`,
                  gap: "0.375rem"
                }}
              >
                {currentPagePokemon.map((pokemon, index) => {
                  const isCurrentCollected = isCollected(pokemon.id)
                  const isSelected = selectedPokemon?.id === pokemon.id
                  const isLongPressed = longPressedPokemon?.id === pokemon.id
                  const collectionItem = getCollectionItem(pokemon.id)
                  
                  // Calculate slot label (A1, B2, C3, D4, etc.)
                  const row = Math.floor(index / settings.binderCols)
                  const col = index % settings.binderCols
                  const rowLetter = String.fromCharCode(65 + row) // A, B, C, D...
                  const slotLabel = `${rowLetter}${col + 1}`
                  
                  return (
                    <PokemonSlot
                      key={pokemon.id}
                      pokemon={pokemon}
                      isCollected={isCurrentCollected}
                      isSelected={isSelected}
                      isLongPressed={isLongPressed}
                      slotLabel={slotLabel}
                      status={collectionItem?.status}
                      onClick={() => handleSlotClick(pokemon)}
                      onLongPress={() => handleLongPress(pokemon)}
                      onQuickCollect={() => handleQuickCollect(pokemon)}
                      onCycleStatus={() => cycleStatus(pokemon.id)}
                      user={user}
                    />
                  )
                })}
                
                {/* Empty Slots */}
                {Array.from({ length: Math.max(0, slotsPerPage - currentPagePokemon.length) }).map((_, i) => (
                  <div key={`empty-${i}`} className="aspect-square rounded-xl border border-dashed border-border/20 bg-muted/5" />
                ))}
              </div>
            </div>

            {/* Page Info Footer */}
            <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground/70">
              <span className="tabular-nums">{settings.binderRows}x{settings.binderCols} Binder</span>
              <span className="w-px h-3 bg-border/50" />
              <span className="tabular-nums">{filteredPokemonList.length} Pokemon</span>
              <span className="hidden sm:block w-px h-3 bg-border/50" />
              <span className="hidden sm:block">Swipe or use arrow keys</span>
            </div>
          </div>
        )}
      </div>

      {/* Selected Pokemon Quick Panel */}
      {selectedPokemon && viewMode === "browse" && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-sm z-30 animate-slide-up">
          <div className="bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl p-3 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <img
                  src={selectedPokemon.sprites?.other?.["official-artwork"]?.front_default || "/placeholder.svg"}
                  alt={selectedPokemon.name}
                  className="w-10 h-10 object-contain"
                />
                {collected && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center shadow">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground font-semibold">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                <h3 className="text-sm font-bold capitalize truncate">{selectedPokemon.name}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  onClick={handleToggleCollected}
                  disabled={isCollectionLoading}
                  variant={collected ? "default" : "secondary"}
                  size="sm"
                  className="gap-1 h-8 px-2.5 text-xs"
                >
                  {collected ? <Check className="w-3 h-3" /> : null}
                  {collected ? "Got" : "Collect"}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedPokemon(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} onUpdateSettings={updateSettings} />
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
      <PartnerModal isOpen={isPartnerOpen} onClose={() => setIsPartnerOpen(false)} />
      
      {isCardSelectorOpen && selectedPokemon && (
        <CardSelector
          pokemonId={selectedPokemon.id}
          pokemonName={selectedPokemon.name}
          onSelect={handleCardSelected}
          onClose={() => setIsCardSelectorOpen(false)}
        />
      )}

      <footer className="fixed bottom-0 left-0 right-0 py-2.5 text-center text-muted-foreground/40 text-[10px] bg-background/80 backdrop-blur-sm border-t border-border/20 safe-area-bottom">
        Made with 🩵 by Cal for his wife, Laura
      </footer>
    </main>
  )
}

// Pokemon Slot Component with long press support
type SlotStatus = 'collected' | 'finalized' | 'considering'

function PokemonSlot({ 
  pokemon, 
  isCollected, 
  isSelected, 
  isLongPressed,
  slotLabel,
  status,
  onClick, 
  onLongPress,
  onQuickCollect,
  onCycleStatus,
  user
}: {
  pokemon: { id: number; name: string }
  isCollected: boolean
  isSelected: boolean
  isLongPressed: boolean
  slotLabel: string
  status?: SlotStatus
  onClick: () => void
  onLongPress: () => void
  onQuickCollect: () => void
  onCycleStatus: () => void
  user: any
}) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isLongPressTriggered = useRef(false)

  const handleTouchStart = () => {
    isLongPressTriggered.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPressTriggered.current = true
      onLongPress()
    }, 400)
  }

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }
    if (!isLongPressTriggered.current) {
      onClick()
    }
  }

  const handleTouchCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
        className={`relative aspect-square rounded-xl overflow-hidden transition-all duration-150 w-full group ${
          isSelected 
            ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-[1.03] z-10" 
            : isCollected 
              ? "ring-1 ring-green-500/40" 
              : "hover:ring-1 hover:ring-primary/30 active:scale-[0.98]"
        }`}
      >
        {/* Card Background */}
        <div className={`absolute inset-0 transition-colors ${
          isCollected 
            ? "bg-gradient-to-br from-green-500/15 to-emerald-500/5" 
            : "bg-gradient-to-br from-muted/80 to-muted/40"
        }`} />
        
        {/* Slot Label */}
        <div className="absolute top-0.5 left-0.5 sm:top-1 sm:left-1 px-1 py-0.5 bg-black/50 backdrop-blur-sm rounded text-[7px] sm:text-[8px] text-white/70 font-bold tabular-nums z-10">
          {slotLabel}
        </div>
        
        {/* Pokemon Image */}
        <img
          src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemon.id}.png`}
          alt={pokemon.name}
          className="absolute inset-1 w-[calc(100%-8px)] h-[calc(100%-8px)] object-contain group-hover:scale-105 transition-transform duration-150"
          loading="lazy"
          draggable={false}
        />
        
        {/* Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-1 sm:p-1.5">
          <p className="text-[8px] sm:text-[10px] text-white/90 font-semibold truncate capitalize leading-tight">
            {pokemon.name}
          </p>
          <p className="text-[7px] sm:text-[9px] text-white/50 tabular-nums">
            #{String(pokemon.id).padStart(4, "0")}
          </p>
        </div>
        
        {/* Status Badge */}
        {isCollected && (
          <div className={`absolute top-0.5 right-0.5 sm:top-1 sm:right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shadow-lg border ${
            status === 'finalized' 
              ? 'bg-amber-500 border-amber-400/50' 
              : status === 'considering' 
                ? 'bg-blue-500 border-blue-400/50' 
                : 'bg-green-500 border-green-400/50'
          }`}>
            {status === 'finalized' ? (
              <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white fill-white" />
            ) : status === 'considering' ? (
              <HelpCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />
            ) : (
              <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />
            )}
          </div>
        )}
      </button>

      {/* Long Press Quick Actions */}
      {isLongPressed && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-20 animate-scale-in">
          <div className="flex items-center gap-1 bg-card/95 backdrop-blur-lg border border-border/50 rounded-full p-1 shadow-xl">
            <button
              onClick={(e) => { e.stopPropagation(); onQuickCollect(); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isCollected 
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/20" 
                  : "bg-green-500/10 text-green-500 hover:bg-green-500/20"
              }`}
            >
              {isCollected ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
              {isCollected ? "Remove" : "Got it"}
            </button>
            {isCollected && (
              <button
                onClick={(e) => { e.stopPropagation(); onCycleStatus(); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  status === 'finalized' 
                    ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" 
                    : status === 'considering'
                      ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {status === 'finalized' ? (
                  <><Star className="w-3 h-3 fill-current" /> Done</>
                ) : status === 'considering' ? (
                  <><HelpCircle className="w-3 h-3" /> Maybe</>
                ) : (
                  <><Star className="w-3 h-3" /> Status</>
                )}
              </button>
            )}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-card/95 border-r border-b border-border/50 rotate-45" />
        </div>
      )}
    </div>
  )
}
