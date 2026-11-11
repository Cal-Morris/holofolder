'use client';

import { OrderedSlot } from '@/components/binder/ordered-slot';
import { adaptLegacyDisplaySlots, displaySlotPriceLookup, type BinderDisplaySlot } from '@/lib/binder-display-model';
import { getCardPriceKey } from '@/lib/card-pricing';
import { getCollectionItemPriceKey } from '@/components/binder/binder-app-model';
import {
  BinderSlotGlare,
  PokemonSlot,
  TRADING_CARD_CORNER_RADIUS,
  TRADING_CARD_INNER_CORNER_RADIUS,
} from '@/components/binder/pokemon-slot';
import { getPokemonSummary } from '@/lib/pokemon-catalog';
import { getBinderDisplayCard } from '@/lib/selected-slot-card-display';
import type { User } from '@supabase/supabase-js';
import type { BinderSettings } from '@/hooks/use-settings';
import type { RegionalCardPriceSnapshot } from '@/lib/regional-price';
import type { CardPriceSnapshot, SupportedCurrency } from '@/hooks/use-card-prices';
import type { CardSelectorMode } from '@/components/card-selector';
import type { PokemonEntry, PokemonSummary } from '@/lib/pokemon-catalog';
import type { CollectedPokemon } from '@/lib/domain/cards';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { BinderCardDisplay } from '@/lib/selected-slot-card-display';
import type { BinderColorTheme } from '@/lib/binder-colors';

export interface BinderGridPageContext {
  displaySlots?: (page: number) => (BinderDisplaySlot | null)[];
  slotInteractionKey?: string;
  selectedSlotId?: string | null;
  onSelectSlot?: (id: string) => void;
  /** Layout editing: which pockets are selected, and whether a tap now picks a move destination. */
  layoutMarks?: { ids: ReadonlySet<string>; moving: boolean };
  /** Right-click, menu key or long press on a pocket. Absent where the pocket has no actions (shares, cached). */
  onSlotMenu?: (id: string, point: { x: number; y: number }) => void;
  binderSlotImageSizes: string;
  binderCardDisplay: BinderCardDisplay;
  cardFinishEffectStyle: CSSProperties;
  cardFinishGlint: { x: number; y: number; angle: number };
  currentBinderPage: number;
  getBinderThemeForPage: (pageNumber?: number | null | undefined) => BinderColorTheme;
  getCollectionItem: (pokemonId: number) => CollectedPokemon | undefined;
  getPageSlots: (pageNumber: number) => (PokemonEntry | null)[];
  getSlotCardImage: (pokemonId: number) => string | null | undefined;
  isCollected: (pokemonId: number) => boolean;
  isDesktopViewport: boolean;
  isPriceMode: boolean;
  isSpreadLayout: boolean;
  longPressedPokemon: { id: number; name: string } | null;
  priceFormat: {
    label: (price: CardPriceSnapshot | undefined) => string | null;
    amount: (amount: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null;
    range: (
      low: number | null | undefined,
      high: number | null | undefined,
      price?: CardPriceSnapshot | undefined,
    ) => string | null;
    totals: (gbpTotal: number, originalTotals: Partial<Record<SupportedCurrency, number>>) => string;
  };
  pricesByCardId: Record<string, RegionalCardPriceSnapshot<CardPriceSnapshot>>;
  readOnlyMode: boolean;
  selectedPokemon: PokemonSummary | null;
  settings: BinderSettings;
  slotActions: BinderSlotActions;
  slotGlareOverlayStyle: CSSProperties;
  user: User | null;
}

type SlotPokemon = { id: number; name: string };

/** What a binder slot needs to do when tapped, pressed or acted on. */
export interface BinderSlotActionHandlers {
  currentBinderPage: number;
  handleLongPress: (pokemon: SlotPokemon) => void;
  handleQuickCollect: (pokemon: SlotPokemon) => Promise<void>;
  handleSlotClick: (pokemon: SlotPokemon) => void;
  handleToggleFavorite: (pokemonId: number) => Promise<void>;
  openCardSelectorForPokemon: (pokemon: PokemonSummary, mode: CardSelectorMode) => void;
  registerSlotButtonRef: (pokemonId: number, node: HTMLButtonElement | null) => void;
  setCurrentBinderPage: Dispatch<SetStateAction<number>>;
  setLongPressedPokemon: Dispatch<SetStateAction<{ id: number; name: string } | null>>;
}

/** Slot handlers keyed by Pokémon and page, with an identity that never changes. */
export interface BinderSlotActions {
  click: (pokemon: SlotPokemon, pageNumber: number) => void;
  doubleClick: (pokemon: SlotPokemon, pageNumber: number) => void;
  longPress: (pokemon: SlotPokemon, pageNumber: number) => void;
  addCard: (pokemon: SlotPokemon) => void;
  addWanted: (pokemon: SlotPokemon) => void;
  quickCollect: (pokemon: SlotPokemon) => Promise<void>;
  toggleFavorite: (pokemonId: number) => Promise<void>;
  registerButton: (pokemonId: number, node: HTMLButtonElement | null) => void;
}

/**
 * Stable slot handlers that always call the latest app handlers. Slots are memoized, so
 * handler identity must not change when unrelated app state does (selection, long press,
 * swipe state), otherwise every slot on the page re-renders on each tap.
 */
export function useBinderSlotActions(handlers: BinderSlotActionHandlers): BinderSlotActions {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });

  return useMemo<BinderSlotActions>(() => {
    const focusPage = (pageNumber: number) => {
      const { currentBinderPage, setCurrentBinderPage } = latest.current;
      if (pageNumber !== currentBinderPage) {
        setCurrentBinderPage(pageNumber);
      }
    };
    const openCardSelector = (pokemon: SlotPokemon, mode: CardSelectorMode) => {
      latest.current.setLongPressedPokemon(null);
      const pokemonSummary = getPokemonSummary(pokemon.id);
      if (pokemonSummary) {
        latest.current.openCardSelectorForPokemon(pokemonSummary, mode);
      }
    };

    return {
      click: (pokemon, pageNumber) => {
        focusPage(pageNumber);
        latest.current.handleSlotClick(pokemon);
      },
      doubleClick: (pokemon, pageNumber) => {
        focusPage(pageNumber);
        openCardSelector(pokemon, 'collect');
      },
      longPress: (pokemon, pageNumber) => {
        focusPage(pageNumber);
        latest.current.handleLongPress(pokemon);
      },
      addCard: (pokemon) => openCardSelector(pokemon, 'collect'),
      addWanted: (pokemon) => openCardSelector(pokemon, 'wishlist'),
      quickCollect: (pokemon) => latest.current.handleQuickCollect(pokemon),
      toggleFavorite: (pokemonId) => latest.current.handleToggleFavorite(pokemonId),
      registerButton: (pokemonId, node) => latest.current.registerSlotButtonRef(pokemonId, node),
    };
  }, []);
}

type PokemonSlotProps = ComponentProps<typeof PokemonSlot>;
type BinderGridSlotProps = Omit<
  PokemonSlotProps,
  | 'onClick'
  | 'onDoubleClick'
  | 'onLongPress'
  | 'onAddCard'
  | 'onAddWanted'
  | 'onQuickCollect'
  | 'onToggleFavorite'
  | 'buttonRef'
> & {
  pageNumber: number;
  actions: BinderSlotActions;
};

/** One binder slot; re-renders only when its own props change. */
const BinderGridSlot = memo(function BinderGridSlot({ pageNumber, actions, ...slotProps }: BinderGridSlotProps) {
  const { pokemon } = slotProps;
  const onClick = useCallback(() => actions.click(pokemon, pageNumber), [actions, pageNumber, pokemon]);
  const onDoubleClick = useCallback(() => actions.doubleClick(pokemon, pageNumber), [actions, pageNumber, pokemon]);
  const onLongPress = useCallback(() => actions.longPress(pokemon, pageNumber), [actions, pageNumber, pokemon]);
  const onAddCard = useCallback(() => actions.addCard(pokemon), [actions, pokemon]);
  const onAddWanted = useCallback(() => actions.addWanted(pokemon), [actions, pokemon]);
  const onQuickCollect = useCallback(() => {
    void actions.quickCollect(pokemon);
  }, [actions, pokemon]);
  const onToggleFavorite = useCallback(() => {
    void actions.toggleFavorite(pokemon.id);
  }, [actions, pokemon.id]);
  const buttonRef = useCallback(
    (node: HTMLButtonElement | null) => actions.registerButton(pokemon.id, node),
    [actions, pokemon.id],
  );

  return (
    <PokemonSlot
      {...slotProps}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onLongPress={onLongPress}
      onAddCard={onAddCard}
      onAddWanted={onAddWanted}
      onQuickCollect={onQuickCollect}
      onToggleFavorite={onToggleFavorite}
      buttonRef={buttonRef}
    />
  );
});

export function renderBinderGridPageView(ctx: BinderGridPageContext, pageNumber: number, side: 'left' | 'right') {
  const {
    binderSlotImageSizes,
    binderCardDisplay,
    cardFinishEffectStyle,
    cardFinishGlint,
    currentBinderPage,
    getBinderThemeForPage,
    getCollectionItem,
    getPageSlots,
    getSlotCardImage,
    isCollected,
    isDesktopViewport,
    isPriceMode,
    isSpreadLayout,
    longPressedPokemon,
    priceFormat,
    pricesByCardId,
    readOnlyMode,
    selectedPokemon,
    settings,
    slotActions,
    slotGlareOverlayStyle,
    user,
  } = ctx;
  const pageTheme = getBinderThemeForPage(pageNumber);
  const pageSlots = ctx.displaySlots
    ? ctx.displaySlots(pageNumber)
    : getPageSlots(pageNumber).map((pokemon) =>
        pokemon ? adaptLegacyDisplaySlots('legacy', [pokemon], getCollectionItem)[0] : null,
      );
  const isActivePage = pageNumber === currentBinderPage;
  const scrollable = settings.binderRows > 4 || settings.binderCols > 4;

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
      <div className="absolute inset-0 rounded-2xl" style={{ background: pageTheme.gloss }} />
      {(isSpreadLayout || isDesktopViewport) && (
        <div
          className={`absolute top-3 z-10 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] text-white/78 uppercase backdrop-blur-sm ${side === 'left' ? 'left-3' : 'right-3'}`}
        >
          Page {pageNumber}
        </div>
      )}
      <div
        className="absolute inset-0 overflow-auto overscroll-contain"
        role={scrollable ? 'region' : undefined}
        aria-label={scrollable ? `Scrollable binder page ${pageNumber}` : undefined}
        tabIndex={scrollable ? 0 : undefined}
      >
        <div
          className="relative h-full w-full p-2 sm:p-4"
          style={{
            minWidth:
              settings.binderCols * (scrollable ? 64 : 36) +
              (settings.binderCols - 1) * 6 +
              (isDesktopViewport ? 32 : 16),
            minHeight:
              settings.binderRows * (scrollable ? 90 : 36) +
              (settings.binderRows - 1) * 6 +
              (isDesktopViewport ? 32 : 16),
            display: 'grid',
            gridTemplateColumns: `repeat(${settings.binderCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${settings.binderRows}, minmax(0, 1fr))`,
            gap: '0.375rem',
          }}
        >
          {pageSlots.map((displaySlot, index) => {
            const pokemon = displaySlot?.legacyPokemonId ? displaySlot.pokemon : null;
            const row = Math.floor(index / settings.binderCols);
            const col = index % settings.binderCols;
            const rowLetter = String.fromCharCode(65 + row);
            const slotLabel = `${rowLetter}${col + 1}`;
            const displayPrice = isPriceMode && displaySlot ? displaySlotPriceLookup(displaySlot) : null;
            if (displaySlot && !displaySlot.legacyPokemonId)
              return (
                <OrderedSlot
                  key={displaySlot.id}
                  slot={displaySlot}
                  priceLabel={
                    displayPrice
                      ? priceFormat.label(pricesByCardId[getCardPriceKey(displayPrice.cardId, displayPrice.language)])
                      : null
                  }
                  slotLabel={slotLabel}
                  cardDisplay={binderCardDisplay}
                  interactionKey={ctx.slotInteractionKey}
                  selected={ctx.selectedSlotId === displaySlot.id}
                  onSelect={ctx.onSelectSlot!}
                  onMenu={ctx.onSlotMenu}
                  marked={ctx.layoutMarks ? ctx.layoutMarks.ids.has(displaySlot.id) : undefined}
                  dimmed={Boolean(ctx.layoutMarks?.moving && ctx.layoutMarks.ids.has(displaySlot.id))}
                  imageSizes={binderSlotImageSizes}
                  glareStyle={slotGlareOverlayStyle}
                  glare={settings.binderSlotGlareEnabled}
                />
              );

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
              );
            }

            const isCurrentCollected = isCollected(pokemon.id);
            const isSelected = selectedPokemon?.id === pokemon.id;
            const isLongPressed = longPressedPokemon?.id === pokemon.id;
            const item = getCollectionItem(pokemon.id);
            const isCurrentWishlisted =
              binderCardDisplay !== 'current' && (item?.status === 'wishlisted' || Boolean(item?.wanted_cards?.length));
            const displayCard = getBinderDisplayCard(item, binderCardDisplay);
            const slotCardImage = getSlotCardImage(pokemon.id);
            const slotCardName = displayCard?.card_name;
            const slotCardFinish = displayCard?.card_finish;
            const itemPriceKey = getCollectionItemPriceKey(displayCard);

            return (
              <BinderGridSlot
                key={displaySlot!.id}
                pokemon={pokemon}
                isCollected={binderCardDisplay !== 'wanted' && isCurrentCollected}
                isWishlisted={isCurrentWishlisted}
                isSelected={isSelected}
                isLongPressed={isLongPressed}
                slotLabel={slotLabel}
                status={binderCardDisplay !== 'wanted' ? item?.status : undefined}
                cardImage={slotCardImage}
                imageSizes={binderSlotImageSizes}
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
                pageNumber={pageNumber}
                actions={slotActions}
                user={user}
                priority
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
