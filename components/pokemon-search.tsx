"use client"

import type React from "react"

import { useState, useCallback, useEffect } from "react"
import { Search, ArrowRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { usePokemonCache } from "@/hooks/use-pokemon-cache"
import { getPokemonSummary } from "@/lib/pokemon-catalog"

interface PokemonSearchProps {
  onSelect: (pokemon: any) => void
  pokemonList?: { id: number; name: string }[]
}

const fuzzySearch = (query: string, items: any[]): any[] => {
  if (!query.trim()) return []

  const lowerQuery = query.toLowerCase()
  const scored = items.map((item) => {
    const name = item.name.toLowerCase()
    let score = 0

    // Exact match gets highest priority
    if (name === lowerQuery) score = 1000
    // Starts with query
    else if (name.startsWith(lowerQuery)) score = 900
    // Contains query consecutively
    else if (name.includes(lowerQuery)) score = 800
    // Fuzzy match - all chars in order
    else {
      let queryIndex = 0
      for (let i = 0; i < name.length && queryIndex < lowerQuery.length; i++) {
        if (name[i] === lowerQuery[queryIndex]) {
          queryIndex++
          score += 100
        }
      }
      if (queryIndex !== lowerQuery.length) score = 0
    }

    return { ...item, score }
  })

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

export default function PokemonSearch({ onSelect, pokemonList: propPokemonList }: PokemonSearchProps) {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const { pokemonList: cachedList } = usePokemonCache()
  
  const pokemonList = propPokemonList || cachedList

  const searchPokemon = useCallback(
    (searchTerm: string) => {
      if (!searchTerm.trim() || pokemonList.length === 0) {
        setSuggestions([])
        setSelectedIndex(-1)
        return
      }

      const filtered = fuzzySearch(searchTerm, pokemonList)
      setSuggestions(filtered)
      setSelectedIndex(-1)
    },
    [pokemonList],
  )

  useEffect(() => {
    searchPokemon(query)
  }, [query, searchPokemon])

  useEffect(() => {
    if (suggestions.length === 1 && query.trim()) {
      setSelectedIndex(0)
    }
  }, [suggestions, query])

  const handleSelectPokemon = useCallback(
    (pokemon: { id: number; name: string }) => {
      const summary = getPokemonSummary(pokemon.id)
      if (summary) onSelect(summary)
      setQuery("")
      setSuggestions([])
      setShowSuggestions(false)
      setSelectedIndex(-1)
    },
    [onSelect],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSuggestions || suggestions.length === 0) return

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev))
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
          break
        case "Enter":
          e.preventDefault()
          if (selectedIndex >= 0) {
            handleSelectPokemon(suggestions[selectedIndex])
          } else if (suggestions.length === 1) {
            handleSelectPokemon(suggestions[0])
          }
          break
        case "Escape":
          e.preventDefault()
          setShowSuggestions(false)
          break
      }
    },
    [showSuggestions, suggestions, selectedIndex, handleSelectPokemon],
  )

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search Pokémon... (arrow keys to navigate)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => query && setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          className="pl-12 h-12 text-lg bg-card border-2 border-primary/20 focus:border-primary"
          autoComplete="off"
        />
      </div>

      {suggestions.length === 1 && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-primary/5 border-2 border-primary/30 rounded-lg px-4 py-3 text-center text-sm text-primary font-medium flex items-center justify-center gap-2">
          <span>Press Enter to select</span>
          <ArrowRight className="w-4 h-4" />
        </div>
      )}

      {showSuggestions && suggestions.length > 1 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border-2 border-primary/20 rounded-lg shadow-lg z-50 overflow-hidden">
          {suggestions.map((pokemon, index) => (
            <button
              key={pokemon.id}
              onClick={() => handleSelectPokemon(pokemon)}
              className={`w-full px-4 py-3 text-left transition-colors border-b border-border last:border-b-0 flex items-center gap-3 ${
                index === selectedIndex
                  ? "bg-primary/20 text-primary font-semibold"
                  : "hover:bg-primary/10 text-foreground"
              }`}
            >
              <div className="flex-1">
                <div className="font-semibold capitalize">{pokemon.name}</div>
                <div className="text-sm text-muted-foreground">#{pokemon.id}</div>
              </div>
              {index === selectedIndex && <ArrowRight className="w-4 h-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
