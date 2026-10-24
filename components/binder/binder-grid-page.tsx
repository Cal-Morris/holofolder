"use client"

import { getCollectionItemPriceKey } from "@/components/binder/binder-app-model"
import { BinderSlotGlare, PokemonSlot, TRADING_CARD_CORNER_RADIUS, TRADING_CARD_INNER_CORNER_RADIUS } from "@/components/binder/pokemon-slot"
import { getPokemonSummary } from "@/lib/pokemon-catalog"
import { getBinderDisplayCard } from "@/lib/selected-slot-card-display"
import type { User } from "@supabase/supabase-js"
import type { BinderSettings } from "@/hooks/use-settings"
import type { RegionalCardPriceSnapshot } from "@/lib/regional-price"
import type { CardPriceSnapshot, SupportedCurrency } from "@/hooks/use-card-prices"
import type { CardSelectorMode } from "@/components/card-selector"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { CollectedPokemon } from "@/hooks/use-collection"
import type { CSSProperties, Dispatch, SetStateAction } from "react"
import type { BinderCardDisplay } from "@/lib/selected-slot-card-display"
import type { BinderColorTheme } from "@/lib/binder-colors"

export interface BinderGridPageContext {
  binderCardDisplay: BinderCardDisplay
  cardFinishEffectStyle: CSSProperties
  cardFinishGlint: { x: number; y: number; angle: number; }
  currentBinderPage: number
  getBinderThemeForPage: (pageNumber?: number | null | undefined) => BinderColorTheme
  getCollectionItem: (pokemonId: number) => CollectedPokemon | undefined
  getPageSlots: (pageNumber: number) => (PokemonEntry | null)[]
  getSlotCardImage: (pokemonId: number) => string | null | undefined
  handleLongPress: (pokemon: { id: number; name: string; }) => void
  handleQuickCollect: (pokemon: { id: number; name: string; }) => Promise<void>
  handleSlotClick: (pokemon: { id: number; name: string; }) => void
  handleToggleFavorite: (pokemonId: number) => Promise<void>
  isCollected: (pokemonId: number) => boolean
  isDesktopViewport: boolean
  isPriceMode: boolean
  isSpreadLayout: boolean
  longPressedPokemon: { id: number; name: string; } | null
  openCardSelectorForPokemon: (pokemon: PokemonSummary, mode: CardSelectorMode) => void
  priceFormat: { label: (price: CardPriceSnapshot | undefined) => string | null; amount: (amount: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null; range: (low: number | null | undefined, high: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null; totals: (gbpTotal: number, originalTotals: Partial<Record<SupportedCurrency, number>>) => string; }
  pricesByCardId: Record<string, RegionalCardPriceSnapshot<CardPriceSnapshot>>
  readOnlyMode: boolean
  registerSlotButtonRef: (pokemonId: number, node: HTMLButtonElement | null) => void
  selectedPokemon: PokemonSummary | null
  setCurrentBinderPage: Dispatch<SetStateAction<number>>
  setLongPressedPokemon: Dispatch<SetStateAction<{ id: number; name: string; } | null>>
  settings: BinderSettings
  slotGlareOverlayStyle: CSSProperties
  user: User | null
}

export function renderBinderGridPageView(ctx: BinderGridPageContext, pageNumber: number, side: "left" | "right") {
  const { binderCardDisplay, cardFinishEffectStyle, cardFinishGlint, currentBinderPage, getBinderThemeForPage, getCollectionItem, getPageSlots, getSlotCardImage, handleLongPress, handleQuickCollect, handleSlotClick, handleToggleFavorite, isCollected, isDesktopViewport, isPriceMode, isSpreadLayout, longPressedPokemon, openCardSelectorForPokemon, priceFormat, pricesByCardId, readOnlyMode, registerSlotButtonRef, selectedPokemon, setCurrentBinderPage, setLongPressedPokemon, settings, slotGlareOverlayStyle, user } = ctx
  const pageTheme = getBinderThemeForPage(pageNumber)
  const pageSlots = getPageSlots(pageNumber)
  const isActivePage = pageNumber === currentBinderPage

  return (
    <div
      key={`binder-page-${pageNumber}`}
      data-binder-page={pageNumber}
      className="relative h-full w-full overflow-hidden rounded-2xl transition-shadow"
      style={isActivePage ? { boxShadow: `0 0 0 2px ${pageTheme.activeOutline}` } : undefined}
    >
      <div
        className="absolute inset-0 rounded-2xl border"
        style={{
          background: pageTheme.background,
          borderColor: pageTheme.border,
          boxShadow: pageTheme.shadow,
        }}
      />
      <div
        className="absolute inset-0 rounded-2xl"
        style={{ background: pageTheme.gloss }}
      />
      {(isSpreadLayout || isDesktopViewport) && (
        <div className={`absolute top-3 z-10 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78 backdrop-blur-sm ${side === "left" ? "left-3" : "right-3"}`}>
          Page {pageNumber}
        </div>
      )}
      <div
        className="absolute inset-0 p-2 sm:p-4"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${settings.binderCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${settings.binderRows}, minmax(0, 1fr))`,
          gap: "0.375rem",
        }}
      >
        {pageSlots.map((pokemon, index) => {
          const row = Math.floor(index / settings.binderCols)
          const col = index % settings.binderCols
          const rowLetter = String.fromCharCode(65 + row)
          const slotLabel = `${rowLetter}${col + 1}`

          if (!pokemon) {
            return (
              <div
                key={`slot-${pageNumber}-${index}`}
                className="relative h-full w-full overflow-hidden border border-white/55 bg-white/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),inset_0_-10px_18px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-10px_18px_rgba(0,0,0,0.24)]"
                style={{ borderRadius: TRADING_CARD_CORNER_RADIUS }}
              >
                <div
                  className="absolute inset-[3px] border border-black/6 dark:border-white/8"
                  style={{ borderRadius: TRADING_CARD_INNER_CORNER_RADIUS }}
                />
                <div className="absolute inset-x-[7px] top-[7px] h-px bg-white/65 dark:bg-white/10" />
                {settings.binderSlotGlareEnabled ? (
                  <BinderSlotGlare
                    glareStyle={slotGlareOverlayStyle}
                    innerRadius={TRADING_CARD_INNER_CORNER_RADIUS}
                  />
                ) : null}
              </div>
            )
          }

          const isCurrentCollected = isCollected(pokemon.id)
          const isSelected = selectedPokemon?.id === pokemon.id
          const isLongPressed = longPressedPokemon?.id === pokemon.id
          const item = getCollectionItem(pokemon.id)
          const isCurrentWishlisted = binderCardDisplay !== "current" && (item?.status === "wishlisted" || Boolean(item?.wanted_cards?.length))
          const displayCard = getBinderDisplayCard(item, binderCardDisplay)
          const slotCardImage = getSlotCardImage(pokemon.id)
          const slotCardName = displayCard?.card_name
          const slotCardFinish = displayCard?.card_finish
          const itemPriceKey = getCollectionItemPriceKey(displayCard)

          return (
            <PokemonSlot
              key={`${pageNumber}-${pokemon.id}`}
              pokemon={pokemon}
              isCollected={binderCardDisplay !== "wanted" && isCurrentCollected}
              isWishlisted={isCurrentWishlisted}
              isSelected={isSelected}
              isLongPressed={isLongPressed}
              slotLabel={slotLabel}
              status={binderCardDisplay !== "wanted" ? item?.status : undefined}
              cardImage={slotCardImage}
              cardName={slotCardName}
              cardFinish={slotCardFinish}
              hasAssignedCard={Boolean(displayCard?.card_id)}
              priceLabel={isPriceMode && itemPriceKey ? priceFormat.label(pricesByCardId[itemPriceKey]) : null}
              showPriceMode={isPriceMode}
              readOnly={readOnlyMode}
              showBinderSlotGlare={settings.binderSlotGlareEnabled}
              showCardFinishEffects={settings.cardFinishEffectsEnabled}
              binderSlotGlareStyle={slotGlareOverlayStyle}
              cardFinishEffectStyle={cardFinishEffectStyle}
              cardFinishGlint={cardFinishGlint}
              onClick={() => {
                if (pageNumber !== currentBinderPage) {
                  setCurrentBinderPage(pageNumber)
                }
                handleSlotClick(pokemon)
              }}
              onDoubleClick={() => {
                if (pageNumber !== currentBinderPage) {
                  setCurrentBinderPage(pageNumber)
                }
                setLongPressedPokemon(null)
                const pokemonSummary = getPokemonSummary(pokemon.id)
                if (pokemonSummary) {
                  openCardSelectorForPokemon(pokemonSummary, "collect")
                }
              }}
              onLongPress={() => {
                if (pageNumber !== currentBinderPage) {
                  setCurrentBinderPage(pageNumber)
                }
                handleLongPress(pokemon)
              }}
              onAddCard={() => {
                setLongPressedPokemon(null)
                const pokemonSummary = getPokemonSummary(pokemon.id)
                if (pokemonSummary) {
                  openCardSelectorForPokemon(pokemonSummary, "collect")
                }
              }}
              onAddWanted={() => {
                setLongPressedPokemon(null)
                const pokemonSummary = getPokemonSummary(pokemon.id)
                if (pokemonSummary) {
                  openCardSelectorForPokemon(pokemonSummary, "wishlist")
                }
              }}
              onQuickCollect={() => handleQuickCollect(pokemon)}
              onToggleFavorite={() => handleToggleFavorite(pokemon.id)}
              user={user}
              priority={pageNumber === 1}
              buttonRef={(node) => registerSlotButtonRef(pokemon.id, node)}
            />
          )
        })}
      </div>
    </div>
  )
}
