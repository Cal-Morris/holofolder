"use client"

import { Check, Heart, Star, X, Search, Plus, BadgeCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { CollectedPokemon } from "@/hooks/use-collection"
import type { PokemonSummary } from "@/lib/pokemon-catalog"

interface DexListViewProps {
  pokemonList: PokemonSummary[]
  collectionByPokemonId: Map<number, CollectedPokemon>
  pricesByKey: Record<string, CardPriceSnapshot>
  getPriceKey: (item?: { card_id?: string | null; card_language?: string | null } | null) => string | null
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null
  onSelectPokemon: (pokemon: PokemonSummary) => void
  onToggleOwned: (pokemon: PokemonSummary) => void
  onAddCard: (pokemon: PokemonSummary) => void
  onAddWanted: (pokemon: PokemonSummary) => void
  onTogglePerfect: (pokemonId: number) => void
  readOnly: boolean
}

function formatDexNumber(id: number) {
  return `#${String(id).padStart(4, "0")}`
}

function getSlotState(item?: CollectedPokemon) {
  if (!item) {
    return {
      label: "Missing",
      className: "border-border/60 bg-muted/35 text-muted-foreground",
      icon: X,
    }
  }

  if (item.status === "wishlisted") {
    return {
      label: "Wanted",
      className: "border-amber-400/35 bg-amber-400/12 text-amber-600 dark:text-amber-300",
      icon: Heart,
    }
  }

  if (item.status === "finalized") {
    return {
      label: "Perfect",
      className: "border-amber-400/40 bg-amber-500/14 text-amber-600 dark:text-amber-300",
      icon: Star,
    }
  }

  if (item.status === "considering") {
    return {
      label: "Upgrade",
      className: "border-sky-400/35 bg-sky-400/12 text-sky-600 dark:text-sky-300",
      icon: BadgeCheck,
    }
  }

  return {
    label: "Owned",
    className: "border-emerald-400/35 bg-emerald-400/12 text-emerald-600 dark:text-emerald-300",
    icon: Check,
  }
}

export default function DexListView({
  pokemonList,
  collectionByPokemonId,
  pricesByKey,
  getPriceKey,
  formatPrice,
  onSelectPokemon,
  onToggleOwned,
  onAddCard,
  onAddWanted,
  onTogglePerfect,
  readOnly,
}: DexListViewProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.6rem] border border-border/60 bg-card/88 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-card/70">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/45 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">List View</p>
          <h2 className="truncate text-lg font-semibold tracking-tight">Manage the dex quickly</h2>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-border/50 bg-background/55 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex">
          <Search className="h-3.5 w-3.5" />
          <span>{pokemonList.length} slots</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="space-y-1.5">
          {pokemonList.map((pokemon) => {
            const item = collectionByPokemonId.get(pokemon.id)
            const state = getSlotState(item)
            const StateIcon = state.icon
            const priceKey = getPriceKey(item)
            const priceLabel = priceKey ? formatPrice(pricesByKey[priceKey]) : null
            const wantedCount = item?.wanted_cards?.length ?? 0

            return (
              <div
                key={pokemon.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectPokemon(pokemon)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelectPokemon(pokemon)
                  }
                }}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-transparent bg-background/35 p-2.5 text-left transition-all hover:border-border/60 hover:bg-background/70 dark:bg-background/22 dark:hover:border-white/10"
              >
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/45 bg-muted/45">
                  <img
                    src={item?.card_image || pokemon.sprites.other["official-artwork"].front_default}
                    alt={item?.card_name || pokemon.name}
                    className="h-full w-full object-contain p-1"
                    loading="lazy"
                  />
                </div>

                <div className="min-w-0">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold capitalize">
                        {pokemon.name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {formatDexNumber(pokemon.id)}
                        {item?.card_name ? ` · ${item.card_name}` : " · No card selected"}
                      </p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${state.className}`}>
                      <StateIcon className="h-3 w-3" />
                      {state.label}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {priceLabel ? (
                      <span className="rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {priceLabel}
                      </span>
                    ) : null}
                    {wantedCount > 0 ? (
                      <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                        {wantedCount} want
                      </span>
                    ) : null}
                    {!readOnly ? (
                      <span className="ml-auto flex items-center gap-1">
                        <Button
                          type="button"
                          variant={item?.status !== "wishlisted" && item ? "default" : "outline"}
                          size="sm"
                          className="h-7 rounded-full px-2.5 text-[11px]"
                          onClick={(event) => {
                            event.stopPropagation()
                            onToggleOwned(pokemon)
                          }}
                        >
                          {item?.status !== "wishlisted" && item ? "Owned" : "Own"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          className="rounded-full"
                          onClick={(event) => {
                            event.stopPropagation()
                            onAddCard(pokemon)
                          }}
                          aria-label={`Add card for ${pokemon.name}`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          className="rounded-full"
                          onClick={(event) => {
                            event.stopPropagation()
                            onAddWanted(pokemon)
                          }}
                          aria-label={`Wantlist card for ${pokemon.name}`}
                        >
                          <Heart className="h-3.5 w-3.5" />
                        </Button>
                        {item?.status !== "wishlisted" && item ? (
                          <Button
                            type="button"
                            variant={item.status === "finalized" ? "default" : "outline"}
                            size="icon-sm"
                            className="rounded-full"
                            onClick={(event) => {
                              event.stopPropagation()
                              onTogglePerfect(pokemon.id)
                            }}
                            aria-label={`Toggle perfect slot for ${pokemon.name}`}
                          >
                            <Star className={`h-3.5 w-3.5 ${item.status === "finalized" ? "fill-current" : ""}`} />
                          </Button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
