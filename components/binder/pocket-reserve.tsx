"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import CardImage from "@/components/card-image"
import CardPickerSheet, { cardPickerSheetChoice } from "@/components/card-picker-sheet"
import { CardSelector } from "@/components/binder/lazy-views"
import { useNativeSlotAction } from "@/hooks/use-native-slot-pick"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { isCardLanguage } from "@/lib/domain/cards"
import { formatDexNumber, formatPokemonDisplayName, getOfficialArtworkUrl, POKEMON_CATALOG } from "@/lib/pokemon-catalog"
import { pickerCandidate, type SlotPickerBoundary } from "@/lib/slot-picker"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

const unusedLegacySelect = () => {}

/**
 * Layout editing only: choose what an empty pocket is kept for (a Pokémon, one exact card, or anything). It changes
 * what the pocket accepts, never what you own.
 */
export default function PocketReserve({ boundary, onClose }: { boundary: SlotPickerBoundary; onClose: () => void }) {
  const [step, setStep] = useState<"choose" | "pokemon" | "card">("choose")
  const [query, setQuery] = useState("")
  const action = useNativeSlotAction(boundary, onClose)
  const text = query.trim().toLowerCase()
  const matches = text.length < 2 ? [] : POKEMON_CATALOG.filter(p => p.name.includes(text) || formatPokemonDisplayName(p.name).toLowerCase().includes(text) || String(p.id) === text).slice(0, 12)
  if (step === "card" && !action.failed) return <CardSelector pokemonId={0} pokemonName="" onSelect={unusedLegacySelect} onClose={() => setStep("choose")} anyCard={{ title: "Keep this pocket for a card" }}
    native={{ onPick: (card, finish) => {
      const picked = { ...card, dexIds: card.dexIds ?? [] } as SearchCardResult
      const candidate = pickerCandidate(picked)
      action.run({ kind: "target", target: { kind: "card", cardId: card.canonicalId ?? card.id, ...(isCardLanguage(card.language) ? { language: card.language } : {}), ...(finish ? { finish } : {}) } },
        id => matchesCatalogCardId(picked, id) ? candidate : boundary.catalog(id))
    } }} />
  return <CardPickerSheet title={step === "pokemon" ? "Which Pokémon?" : "What goes in this pocket?"} subtitle="This only changes what the pocket is for." onClose={step === "pokemon" ? () => setStep("choose") : onClose}>
    {action.failed && <div role="alert" className="mb-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p className="break-words">{action.failed}</p>
      <div className="mt-2 flex gap-2">
        {action.retry && <button type="button" className="min-h-10 rounded-xl border border-border px-3 text-sm font-medium" disabled={action.busy} onClick={action.retry}>Try again</button>}
        <button type="button" className="min-h-10 rounded-xl px-3 text-sm text-muted-foreground" disabled={action.busy} onClick={action.dismiss}>Dismiss</button>
      </div>
    </div>}
    {step === "choose" ? <div className="grid gap-2">
      <button type="button" className={cardPickerSheetChoice()} onClick={() => setStep("pokemon")}><span>A Pokémon</span><span className="text-xs font-medium text-muted-foreground">Any of its cards</span></button>
      <button type="button" className={cardPickerSheetChoice()} onClick={() => setStep("card")}><span>One exact card</span><span className="text-xs font-medium text-muted-foreground">Search every card</span></button>
      <button type="button" className={cardPickerSheetChoice()} disabled={action.busy} onClick={() => action.run({ kind: "target", target: null })}><span>Any card</span><span className="text-xs font-medium text-muted-foreground">A free pocket</span></button>
    </div> : <>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="search" autoFocus aria-label="Search Pokémon" placeholder="Name or number" value={query} onChange={event => setQuery(event.target.value)}
          className="h-11 w-full rounded-2xl border border-border/60 bg-background/85 pl-9 pr-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 md:text-sm" />
      </div>
      <div className="mt-2 grid max-h-[40dvh] gap-1 overflow-y-auto overscroll-contain" aria-label="Pokémon">
        {matches.map(pokemon => <button key={pokemon.id} type="button" disabled={action.busy} onClick={() => action.run({ kind: "target", target: { kind: "pokemon", pokemonId: pokemon.id } })}
          className="flex min-h-12 items-center gap-3 rounded-2xl px-2 text-left hover:bg-muted/60 disabled:opacity-50">
          <span className="relative h-10 w-10 shrink-0"><CardImage src={getOfficialArtworkUrl(pokemon.id)} alt="" fill sizes="40px" className="object-contain" /></span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{formatPokemonDisplayName(pokemon.name)}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{formatDexNumber(pokemon.id)}</span>
        </button>)}
        {text.length >= 2 && !matches.length && <p className="px-2 py-3 text-sm text-muted-foreground">No Pokémon found.</p>}
      </div>
    </>}
  </CardPickerSheet>
}
