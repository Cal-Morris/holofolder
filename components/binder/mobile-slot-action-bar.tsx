"use client"

import { getBinderSlotQuickActions } from "@/lib/binder-slot-actions"
import { formatPokemonDisplayName, getPokemonSummary } from "@/lib/pokemon-catalog"
import { Check, Heart, Layers3, Star, X } from "lucide-react"
import { createPortal } from "react-dom"
import type { CardSelectorMode } from "@/components/card-selector"
import type { PokemonSummary } from "@/lib/pokemon-catalog"
import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react"
import type { CollectedPokemon } from "@/hooks/use-collection"

export interface MobileSlotActionBarContext {
  closeMobileActions: () => void
  getCollectionItem: (pokemonId: number) => CollectedPokemon | undefined
  handleQuickCollect: (pokemon: { id: number; name: string; }) => Promise<void>
  handleToggleFavorite: (pokemonId: number) => Promise<void>
  isCollected: (pokemonId: number) => boolean
  longPressedPokemon: { id: number; name: string; } | null
  mobileActionsRef: RefObject<HTMLDivElement | null>
  mobileActionsSwipe: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void; onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void; onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void; onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void; style: { touchAction: "none"; }; }
  openCardBrowser: (pokemon: { id: number; name: string; }, options?: { highlightCardId?: string | null | undefined; fromDetail?: boolean | undefined; }) => void
  openCardSelectorForPokemon: (pokemon: PokemonSummary, mode: CardSelectorMode) => void
  readOnlyMode: boolean
  requestOwnedRemoval: (pokemon: { id: number; name: string; }) => void
  setLongPressedPokemon: Dispatch<SetStateAction<{ id: number; name: string; } | null>>
  setSelectedPokemon: Dispatch<SetStateAction<PokemonSummary | null>>
}

export function renderMobileSlotActionBarView(ctx: MobileSlotActionBarContext) {
  const { closeMobileActions, getCollectionItem, handleQuickCollect, handleToggleFavorite, isCollected, longPressedPokemon, mobileActionsRef, mobileActionsSwipe, openCardBrowser, openCardSelectorForPokemon, readOnlyMode, requestOwnedRemoval, setLongPressedPokemon, setSelectedPokemon } = ctx
  if (readOnlyMode || !longPressedPokemon) {
    return null
  }

  const pokemon = getPokemonSummary(longPressedPokemon.id)
  if (!pokemon) {
    return null
  }

  const item = getCollectionItem(pokemon.id)
  const collected = isCollected(pokemon.id)
  const quickActions = getBinderSlotQuickActions({
    hasAssignedCard: Boolean(item?.card_id),
    readOnly: readOnlyMode,
  })

  if (!quickActions.canShowActions) {
    return null
  }

  const showFavoriteAction = collected && Boolean(item?.card_id)
  const mobileActionBar = (
    <>
    <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/20 sm:hidden" onClick={closeMobileActions} />
    <div
      ref={mobileActionsRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${formatPokemonDisplayName(pokemon.name)} quick actions`}
      className="fixed inset-x-2 bottom-[calc(var(--dock-clearance)+0.5rem)] z-50 px-1 sm:hidden"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mx-auto max-w-md rounded-[1.15rem] border border-border/70 bg-card/97 p-2 shadow-[0_22px_60px_-28px_rgba(15,23,42,0.48)] backdrop-blur-xl dark:border-border/50">
        <div data-sheet-grabber {...mobileActionsSwipe} className="flex h-4 justify-center"><span aria-hidden="true" className="mt-1 h-1 w-8 rounded-full bg-muted-foreground/30" /></div>
        <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
          <p className="min-w-0 truncate text-xs font-semibold">
            {formatPokemonDisplayName(pokemon.name)}
          </p>
          <button
            type="button"
            onClick={() => openCardBrowser({ id: pokemon.id, name: pokemon.name })}
            className="-my-1 ml-auto flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            aria-label={`All ${formatPokemonDisplayName(pokemon.name)} cards`}
          >
            <Layers3 className="h-3.5 w-3.5" />
            All cards
          </button>
          <button
            type="button"
            onClick={() => { setLongPressedPokemon(null); setSelectedPokemon(pokemon) }}
            className="flex h-9 shrink-0 items-center rounded-full px-2 text-xs font-semibold text-muted-foreground hover:bg-muted/70"
          >
            Details
          </button>
          <button
            type="button"
            onClick={closeMobileActions}
            className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            aria-label="Close quick actions"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className={`grid gap-1.5 ${showFavoriteAction ? "grid-cols-4" : "grid-cols-3"}`}>
          <button
            type="button"
            onClick={() => {
              setLongPressedPokemon(null)
              openCardSelectorForPokemon(pokemon, "collect")
            }}
            className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-emerald-400/35 bg-emerald-500/12 px-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-300"
          >
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{quickActions.addLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setLongPressedPokemon(null)
              openCardSelectorForPokemon(pokemon, "wishlist")
            }}
            className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-amber-400/35 bg-amber-500/12 px-1.5 text-xs font-bold text-amber-600 dark:text-amber-300"
          >
            <Heart className="h-3.5 w-3.5 shrink-0 fill-current" />
            <span className="truncate">{quickActions.wantLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setLongPressedPokemon(null)
              if (collected) {
                requestOwnedRemoval(pokemon)
              } else {
                handleQuickCollect(pokemon)
              }
            }}
            className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 text-xs font-bold ${
                collected
                  ? "border-destructive/25 bg-destructive/10 text-destructive"
                  : "border-emerald-400/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
              }`}
          >
            {collected ? <X className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{collected ? "Remove" : "Got"}</span>
          </button>
          {showFavoriteAction ? (
            <button
              type="button"
              onClick={() => {
                setLongPressedPokemon(null)
                handleToggleFavorite(pokemon.id)
              }}
              className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 text-xs font-bold ${
                  item?.status === "finalized"
                    ? "border-amber-400/35 bg-amber-500/12 text-amber-600 dark:text-amber-300"
                    : "border-border/55 bg-muted/45 text-muted-foreground"
                }`}
            >
              <Star className={`h-3.5 w-3.5 shrink-0 ${item?.status === "finalized" ? "fill-current" : ""}`} />
              <span className="truncate">Fav</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
    </>
  )

  return createPortal(mobileActionBar, document.body)
}
