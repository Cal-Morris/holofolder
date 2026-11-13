'use client';

import CardImage from '@/components/card-image';
import { toCardImageSrc } from '@/lib/card-image-url';
import { SINGLE_CARD_GUIDE, captureSingleCardFrame, delay } from '@/lib/camera-frame';
import { useCameraStream } from '@/hooks/use-camera-stream';
import CameraControls from '@/components/camera-controls';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { isCardLanguage } from '@/lib/domain/cards';
import { formatPokemonDisplayName, getPokemonById } from '@/lib/pokemon-catalog';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTCGdex, type TCGCard, type CardFilters, type CardLanguage } from '@/hooks/use-tcgdex';
import type { CardFinish } from '@/lib/domain/cards';
import { Button } from '@/components/ui/button';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { useCardSearch } from '@/hooks/use-card-search';
import { buildOfflineCardIndex } from '@/lib/offline-card-index';
import CardPickerFiltersSheet from '@/components/card-picker-filters-sheet';
import { getCardPriceKey, type CardPriceSnapshot } from '@/hooks/use-card-prices';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import {
  getCardPickerSortAmount,
  readCardPickerSort,
  saveCardPickerSort,
  sortCardPickerCards,
  cardNameMatchRank,
  type CardPickerSort,
} from '@/lib/card-selector-sort';
import {
  CARD_PICKER_LANGUAGES,
  getActiveFilterChips,
  getPokemonFilterOptions,
  getCardPickerFinishChoices,
  getCardPickerSuggestedFinish,
  getRecordedFinish,
  getVariantFilter,
  type CardPickerFilterKey,
  type CardPickerVariantChoice,
} from '@/lib/card-picker-filters';
import { getRegionalFinishPrices } from '@/lib/regional-price';
import { DEFAULT_PRICING_REGION, type PricingRegion } from '@/lib/pricing-region';
import { PriceRisingBadge } from '@/components/price-rising-badge';
import CardPickerVariantSheet from '@/components/card-picker-variant-sheet';
import { completeCardSelectorSelection } from '@/lib/card-selector-selection-flow';
import {
  buildCardImageDescriptor,
  compareCardImageDescriptors,
  type CardImageDescriptor,
} from '@/lib/card-image-match';
import {
  aggregateCardScanMatches,
  type AggregatedCardScanMatch,
  type CardScanFrameMatch,
} from '@/lib/card-scan-matching';
import { selectCandidateCardsForAssetTextOcr } from '@/lib/card-scan-candidate-text';
import { rankAggregatedCardScanMatchesWithText } from '@/lib/card-scan-ranking';
import { buildCardMetadataTextSignals, mergeCardTextSignals, type CardTextSignals } from '@/lib/card-scan-text';
import {
  X,
  Search,
  Check,
  Loader2,
  Camera,
  Heart,
  ListFilter,
  MoreHorizontal,
  SlidersHorizontal,
  WifiOff,
} from 'lucide-react';
import { SelectorMenu } from '@/components/collection-navigation/selector-menu';
import { cardMatchesLanguages, type CardSearchLanguage } from '@/lib/card-languages';

export type CardSelectorMode = 'collect' | 'wishlist';

interface CardSelectorProps {
  /** The species whose printings are listed. Ignored when `anyCard` is set. */
  pokemonId: number;
  pokemonName: string;
  /**
   * Any-card picking for pockets that are not tied to one Pokémon: the same selector, searching every supported
   * card (Trainers and Energy included). `cardId` narrows it to the one printing a pocket is reserved for.
   */
  anyCard?: { title: string; cardId?: string; query?: string };
  onSelect: (card: TCGCard | null, mode: CardSelectorMode, finish?: CardFinish) => void;
  onClose: () => void;
  selectedCardId?: string;
  selectedCollectedCardId?: string;
  selectedWantedCardId?: string;
  replacingWanted?: boolean;
  onClearWanted?: () => void;
  mode?: CardSelectorMode;
  /** Initial card language (the user's preferred card language setting). */
  defaultCardLanguage?: CardLanguage;
  /** The user's pricing region; card prices are weighted for it. */
  pricingRegion?: PricingRegion;
  /**
   * Languages the pocket takes (its reserved language, else the binder's). When set, a filter icon narrows the
   * cards to them by default and a note shows while the filters don't match.
   */
  targetLanguages?: readonly CardLanguage[];
  /** Formats a GBP amount in the user's display currency (GBP when omitted). */
  formatAmount?: CardSelectorAmountFormatter;
  /**
   * Native stable-slot selection. A pick goes to `onPick` instead of the legacy `onSelect` and the selector
   * stays open until the host replaces it. `finish` is set only when the user chose it here (the finish
   * sheet or a variant filter), never inferred. Wanted mode and "mark owned without card" are legacy
   * collection writes, so they are hidden along with the More menu; slot structure belongs to layout editing.
   */
  native?: {
    onPick: (card: TCGCard & { dexIds?: number[] }, finish: CardFinish | undefined) => void;
    /** Pick several cards at once for the empty pockets on this page (`room` of them). */
    many?: {
      room: number;
      busy: boolean;
      error: string | null;
      onAdd: (picks: CardSelectorPick[]) => void;
    };
  };
}

export type CardSelectorPick = { card: TCGCard & { dexIds?: number[] }; finish: CardFinish | undefined };

const noOfflineCards = () => buildOfflineCardIndex([]);

type CardSelectorAmountFormatter = (gbpAmount: number | null | undefined, price?: CardPriceSnapshot) => string | null;

type CardScanMatch = CardScanFrameMatch<TCGCard>;

const CARD_SCAN_FRAME_COUNT = 8;
const CARD_SCAN_FRAME_DELAY_MS = 450;
const CARD_SCAN_MIN_USABLE_FRAMES = 3;
const CARD_SCAN_OCR_FRAME_LIMIT = 4;
const CARD_SCAN_CANDIDATE_ASSET_OCR_LIMIT = 18;
const CARD_GUIDE_INSET_X = SINGLE_CARD_GUIDE.insetX;
const CARD_GUIDE_INSET_Y = SINGLE_CARD_GUIDE.insetY;
const CARD_ASPECT_RATIO = SINGLE_CARD_GUIDE.aspectRatio;

const GBP_AMOUNT_FORMAT = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 2,
});

function formatGbpAmount(amount: number | null | undefined) {
  return typeof amount === 'number' && Number.isFinite(amount) ? GBP_AMOUNT_FORMAT.format(amount) : null;
}

function getCardSelectorPriceLabels(
  price: CardPriceSnapshot | undefined,
  formatAmount: CardSelectorAmountFormatter = formatGbpAmount,
) {
  const low = formatAmount(price?.lowGbpAmount, price);
  const high = formatAmount(price?.highGbpAmount, price);
  const confidence =
    price?.confidence && price.confidence !== 'unknown'
      ? price.confidence.charAt(0).toUpperCase() + price.confidence.slice(1)
      : null;

  return {
    good: formatAmount(price?.goodGbpAmount, price),
    market: formatAmount(price?.marketGbpAmount ?? price?.gbpAmount, price),
    range: low && high ? (low === high ? low : `${low}-${high}`) : low || high,
    confidence,
  };
}

function parseCardNumber(value?: string) {
  if (!value) return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferCardFinish(card: TCGCard): CardFinish {
  const rarity = (card.rarity || '').toLowerCase();
  const localNumber = parseCardNumber(card.localId);
  const officialCount = card.set.officialCardCount;

  if (rarity.includes('ace spec')) return 'ace_spec';
  if (rarity.includes('amazing')) return 'amazing_rare';
  if (rarity.includes('radiant')) return 'radiant_rare';
  if (rarity.includes('shiny')) return 'shiny_rare';
  if (rarity.includes('special illustration')) return 'special_illustration_rare';
  if (rarity.includes('illustration')) return 'illustration_rare';
  if (rarity.includes('hyper')) return 'hyper_rare';
  if (rarity.includes('ultra')) return 'ultra_rare';
  if (rarity.includes('double')) return 'double_rare';
  if (card.variants?.jumbo) return 'jumbo';
  if ((localNumber != null && officialCount && localNumber > officialCount) || rarity.includes('secret'))
    return 'secret_rare';
  if (card.variants?.holo) return 'holo';
  if (card.variants?.reverse) return 'reverse_holo';
  return 'normal';
}

function CardSelectorImage({
  src,
  sizes = '(max-width: 639px) 45vw, 180px',
  alt,
  className,
  fallbackClassName = 'flex h-full w-full items-center justify-center bg-muted',
}: {
  src?: string;
  sizes?: string;
  alt: string;
  className: string;
  fallbackClassName?: string;
}) {
  // Remembers which src failed, so a new src gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string>();
  const failed = failedSrc !== undefined && failedSrc === src;
  const imageSrc = toCardImageSrc(src);

  if (!imageSrc || failed) {
    return (
      <div className={fallbackClassName}>
        <span className="text-muted-foreground text-xs">No Image</span>
      </div>
    );
  }

  // The original URL, not the CDN one: CardImage falls back to the proxy (which mirrors the miss) only from the original.
  return (
    <CardImage
      sizes={sizes}
      src={src!}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}

export default function CardSelector({
  pokemonId,
  pokemonName,
  onSelect,
  onClose,
  selectedCardId,
  selectedCollectedCardId,
  selectedWantedCardId,
  replacingWanted = false,
  onClearWanted,
  mode = 'collect',
  defaultCardLanguage,
  targetLanguages,
  pricingRegion = DEFAULT_PRICING_REGION,
  formatAmount = formatGbpAmount,
  native,
  anyCard,
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent pieces of picker and scanner UI state; one reducer would not read better
}: CardSelectorProps) {
  const { fetchCardsForPokemon, filterCards, isLoading: isLoadingSpecies, error: speciesError } = useTCGdex();
  const [speciesCards, setCards] = useState<TCGCard[]>([]);
  const [filters, setFilters] = useState<CardFilters>(() => (anyCard?.query ? { searchQuery: anyCard.query } : {}));
  const [sort, setSort] = useState<CardPickerSort>(readCardPickerSort);
  const [selectedCardLanguage, setSelectedCardLanguage] = useState<CardSearchLanguage>(defaultCardLanguage ?? 'en');
  // "Any" saves and prices each card in its own printing's language.
  const fixedLanguage = selectedCardLanguage === 'any' ? undefined : selectedCardLanguage;
  const priceLanguage = useCallback(
    (card: TCGCard): CardLanguage => fixedLanguage ?? (isCardLanguage(card.language) ? card.language : 'en'),
    [fixedLanguage],
  );
  // Any-card mode searches the whole catalog as you type; a reserved printing is looked up by its own ID.
  const isAnyCard = Boolean(anyCard),
    reservedCardId = anyCard?.cardId;
  const anyCardQuery = isAnyCard ? (reservedCardId ?? filters.searchQuery ?? '') : '';
  const catalogSearch = useCardSearch(anyCardQuery, isAnyCard, noOfflineCards, {
    language: selectedCardLanguage,
    includeNonPokemon: true,
  });
  const cards = useMemo<TCGCard[]>(
    () =>
      !isAnyCard
        ? speciesCards
        : // A result keeps its own language. The server leaves it unset when the card isn't printed in the chosen one;
          // in English that means no English print (a Japanese-only card), so it is dropped unless it is the reserved
          // printing. Other languages price English prints, so their unset cards stay. One found on this device with no
          // language recorded stays unknown rather than being guessed.
          catalogSearch.cards.flatMap((card) => {
            if (reservedCardId && !matchesCatalogCardId(card, reservedCardId)) return [];
            if (
              !reservedCardId &&
              !catalogSearch.offline &&
              selectedCardLanguage === 'en' &&
              !isCardLanguage(card.language)
            )
              return [];
            return [
              {
                ...card,
                language: isCardLanguage(card.language)
                  ? card.language
                  : catalogSearch.offline
                    ? undefined
                    : fixedLanguage,
              },
            ];
          }),
    [
      isAnyCard,
      reservedCardId,
      catalogSearch.cards,
      catalogSearch.offline,
      selectedCardLanguage,
      fixedLanguage,
      speciesCards,
    ],
  );
  const isLoading = anyCard ? catalogSearch.loading : isLoadingSpecies;
  const error = anyCard ? null : speciesError;
  // Follows the `mode` prop, and the Add/Want toggle can switch it until the prop next changes.
  const [modeChoice, setModeChoice] = useState<{ prop: CardSelectorMode; value: CardSelectorMode } | null>(null);
  if (modeChoice && modeChoice.prop !== mode) setModeChoice(null);
  const selectionMode = modeChoice?.prop === mode ? modeChoice.value : mode;
  const setSelectionMode = (value: CardSelectorMode) => setModeChoice({ prop: mode, value });
  const [variantChoice, setVariantChoice] = useState<CardPickerVariantChoice>('any');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [isScanningCard, setIsScanningCard] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [scanMatches, setScanMatches] = useState<CardScanMatch[]>([]);
  const [isCardScannerOpen, setIsCardScannerOpen] = useState(false);
  const [scanCameraError, setCameraError] = useState<string | null>(null);
  const [isCapturingCardScan, setIsCapturingCardScan] = useState(false);
  const [isApplyingCardResults, setIsApplyingCardResults] = useState(false);
  const [cardFramesProcessed, setCardFramesProcessed] = useState(0);
  const [cardUsableFrames, setCardUsableFrames] = useState(0);
  const [lastFramePreviewUrl, setLastFramePreviewUrl] = useState<string | null>(null);
  const [descriptorCache] = useState(() => new Map<string, Promise<CardImageDescriptor | null>>());
  const [cardTextSignalCache] = useState(() => new Map<string, Promise<CardTextSignals>>());
  const cardVideoRef = useRef<HTMLVideoElement | null>(null);
  const cardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isWishlistMode = selectionMode === 'wishlist';
  const activeSelectedCardId = isWishlistMode
    ? (selectedWantedCardId ?? (mode === 'wishlist' ? selectedCardId : undefined))
    : (selectedCollectedCardId ?? (mode === 'collect' ? selectedCardId : undefined));
  const recordedFinish = getRecordedFinish(variantChoice);
  const finishFor = useCallback(
    (card: TCGCard | undefined): CardFinish => recordedFinish ?? (card ? inferCardFinish(card) : 'normal'),
    [recordedFinish],
  );
  const priceLookups = useMemo(
    () => cards.map((card) => ({ cardId: card.id, language: priceLanguage(card) })),
    [cards, priceLanguage],
  );
  const { pricesByCardId, isLoading: isLoadingPrices } = useRegionalCardPrices(
    priceLookups,
    cards.length > 0,
    pricingRegion,
  );
  const intentCopy = isWishlistMode
    ? {
        title: `${replacingWanted ? 'Change' : 'Choose'} wanted card for ${pokemonName}`,
        label: 'Wanted',
        shortLabel: 'Want',
        actionLabel: replacingWanted ? 'Change wanted card' : 'Add wanted card',
        scanLabel: 'Scan wanted',
        emptyActionLabel: 'Clear wanted card',
        helper: 'Tracks the card you want without changing your owned card.',
        searchPlaceholder: 'Search name or number',
        currentLabel: 'Current wanted',
        activeClass:
          'border-amber-400/60 bg-amber-400/15 text-amber-700 shadow-[0_10px_24px_-18px_rgba(251,191,36,0.85)] dark:text-amber-300',
        accentClass: 'border-amber-400/40 bg-amber-400/12 text-amber-700 dark:text-amber-300',
      }
    : {
        title: anyCard?.title ?? `${selectedCollectedCardId ? 'Change owned' : 'Add'} card for ${pokemonName}`,
        label: 'Add card',
        shortLabel: 'Add',
        actionLabel: selectedCollectedCardId ? 'Change owned card' : 'Add owned card',
        scanLabel: 'Scan card',
        emptyActionLabel: 'Mark owned without card',
        helper: 'Saves this printing as the card you own in this slot.',
        searchPlaceholder: anyCard ? 'Search name, set or number' : 'Search name or number',
        currentLabel: 'Current card',
        activeClass:
          'border-emerald-400/55 bg-emerald-400/14 text-emerald-700 shadow-[0_10px_24px_-18px_rgba(52,211,153,0.85)] dark:text-emerald-300',
        accentClass: 'border-emerald-400/40 bg-emerald-400/12 text-emerald-700 dark:text-emerald-300',
      };
  const intentTextClass = isWishlistMode
    ? 'text-amber-600 dark:text-amber-300'
    : 'text-emerald-600 dark:text-emerald-300';
  const intentSelectedCardClass = isWishlistMode
    ? 'border-amber-400 ring-2 ring-amber-400/45'
    : 'border-emerald-400 ring-2 ring-emerald-400/45';
  const intentHoverCardClass = isWishlistMode
    ? 'hover:border-amber-400/65 hover:ring-2 hover:ring-amber-400/20'
    : 'hover:border-emerald-400/65 hover:ring-2 hover:ring-emerald-400/20';

  const [several, setSeveral] = useState(false);
  const [picks, setPicks] = useState<CardSelectorPick[]>([]);
  const room = native?.many?.room ?? 0;
  const selectCard = useCallback(
    (card: TCGCard, finish?: CardFinish) => {
      if (native) {
        const pick = {
          card: isAnyCard ? card : { ...card, language: fixedLanguage ?? card.language },
          finish: finish ?? recordedFinish ?? undefined,
        };
        if (several) setPicks((current) => (current.length < room ? [...current, pick] : current));
        else native.onPick(pick.card, pick.finish);
        return;
      }
      completeCardSelectorSelection({
        onClose,
        onSelect: () =>
          onSelect({ ...card, language: fixedLanguage ?? card.language }, selectionMode, finish ?? finishFor(card)),
      });
    },
    [finishFor, isAnyCard, native, onClose, onSelect, recordedFinish, room, fixedLanguage, selectionMode, several],
  );
  const [pendingCard, setPendingCard] = useState<TCGCard | null>(null);
  const pendingSnapshot = pendingCard
    ? pricesByCardId[getCardPriceKey(pendingCard.id, priceLanguage(pendingCard))]
    : undefined;
  const pendingFinishPrices = getRegionalFinishPrices(pendingSnapshot, pricingRegion);
  const pendingChoices = pendingCard
    ? getCardPickerFinishChoices(
        pendingCard.variants,
        inferCardFinish(pendingCard),
        variantChoice,
        pendingSnapshot?.finishPrices,
      )
    : [];
  /** Tapping a card picks it; a printing that comes in several finishes asks which one first. */
  const pickCard = useCallback(
    (card: TCGCard) => {
      if (several && picks.some((pick) => pick.card.id === card.id)) {
        setPicks((current) => current.filter((pick) => pick.card.id !== card.id));
        return;
      }
      if (several && picks.length >= room) return;
      if (
        getCardPickerFinishChoices(
          card.variants,
          inferCardFinish(card),
          variantChoice,
          pricesByCardId[getCardPriceKey(card.id, priceLanguage(card))]?.finishPrices,
        ).length > 0
      ) {
        setPendingCard(card);
        return;
      }
      selectCard(card);
    },
    [selectCard, variantChoice, pricesByCardId, priceLanguage, several, picks, room],
  );
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const selectWithoutCard = useCallback(() => {
    completeCardSelectorSelection({
      onClose,
      onSelect: () =>
        onSelect(
          null,
          selectionMode,
          finishFor(cards.find((card) => matchesCatalogCardId(card, activeSelectedCardId))),
        ),
    });
  }, [activeSelectedCardId, cards, finishFor, onClose, onSelect, selectionMode]);

  useEffect(() => {
    if (isAnyCard) return;
    const load = async () => {
      const cardsData = await fetchCardsForPokemon(pokemonId, 'en');
      setCards(cardsData);
    };
    load();
  }, [pokemonId, fetchCardsForPokemon, isAnyCard]);

  // A different Pokémon starts the scan afresh. The preview URL is revoked by the effect below.
  // oxlint-disable-next-line react-doctor/no-derived-useState, react-doctor/rerender-state-only-in-handlers -- React's "previous prop" pattern: remembers the last pokemonId to reset the scan during render
  const [scanPokemonId, setScanPokemonId] = useState(pokemonId);
  if (scanPokemonId !== pokemonId) {
    setScanPokemonId(pokemonId);
    setScanError(null);
    setScanMatches([]);
    setScanPreviewUrl(null);
    setLastFramePreviewUrl(null);
  }

  useEffect(() => {
    descriptorCache.clear();
    cardTextSignalCache.clear();
  }, [pokemonId, descriptorCache, cardTextSignalCache]);

  useEffect(() => {
    return () => {
      if (scanPreviewUrl) {
        URL.revokeObjectURL(scanPreviewUrl);
      }
    };
  }, [scanPreviewUrl]);

  const camera = useCameraStream(isCardScannerOpen, cardVideoRef);
  const cameraError = scanCameraError ?? camera.error;
  const isCameraReady = camera.ready;

  const variantFilter = getVariantFilter(variantChoice);
  // Starts on the binder's settings each time the selector opens; not remembered.
  const [matchBinder, setMatchBinder] = useState(true);
  const binderLanguageFilter = matchBinder ? targetLanguages : undefined;
  // Any-card search also matches set codes and artists ("mew" is the 151 set's code), so offer to narrow to a Pokémon.
  const pokemonOptions = useMemo(
    () =>
      isAnyCard
        ? getPokemonFilterOptions(catalogSearch.cards, (id) => {
            const pokemon = getPokemonById(id);
            return pokemon ? formatPokemonDisplayName(pokemon.name) : undefined;
          })
        : [],
    [isAnyCard, catalogSearch.cards],
  );
  // A new search can drop the chosen Pokémon; ignore it rather than show nothing.
  const pokemonFilter = pokemonOptions.some((option) => option.id === filters.pokemon) ? filters.pokemon : undefined;
  const pokemonCardIds = useMemo(
    () =>
      pokemonFilter === undefined
        ? null
        : new Set(catalogSearch.cards.flatMap((card) => (card.dexIds.includes(pokemonFilter) ? [card.id] : []))),
    [catalogSearch.cards, pokemonFilter],
  );
  const filteredCards = useMemo(
    () =>
      filterCards(
        cards.filter(
          (card) =>
            (!binderLanguageFilter || cardMatchesLanguages(card, binderLanguageFilter)) &&
            (!pokemonCardIds || pokemonCardIds.has(card.id)),
        ),
        // Any-card results are already the search's matches (name, set, number or artist), so they are not re-filtered by text.
        { ...filters, ...(isAnyCard ? { searchQuery: undefined } : {}), variant: variantFilter },
      ),
    [binderLanguageFilter, isAnyCard, cards, filters, filterCards, pokemonCardIds, variantFilter],
  );
  const filtersMatchBinder =
    !targetLanguages || (matchBinder && fixedLanguage !== undefined && targetLanguages.includes(fixedLanguage));
  const scanRankById = useMemo(() => {
    return new Map(scanMatches.map((match, index) => [match.card.id, index + 1]));
  }, [scanMatches]);
  const likelyRank = useCallback(
    (card: TCGCard) => {
      // Most likely picks first: in Add mode the card this slot wants, then the slot's current card, then how well
      // the name answers the search.
      if (!isWishlistMode && matchesCatalogCardId(card, selectedWantedCardId)) return 0;
      if (matchesCatalogCardId(card, activeSelectedCardId)) return 1;
      return 1000 + cardNameMatchRank(card.name, filters.searchQuery ?? '');
    },
    [activeSelectedCardId, filters.searchQuery, isWishlistMode, selectedWantedCardId],
  );
  const displayedCards = useMemo(() => {
    if (scanRankById.size === 0) {
      return sortCardPickerCards(
        filteredCards,
        sort,
        (card) =>
          getCardPickerSortAmount(
            pricesByCardId[getCardPriceKey(card.id, priceLanguage(card))],
            finishFor(card),
            pricingRegion,
          ),
        likelyRank,
      );
    }

    return filteredCards.toSorted((left, right) => {
      const leftRank = scanRankById.get(left.id) ?? Number.POSITIVE_INFINITY;
      const rightRank = scanRankById.get(right.id) ?? Number.POSITIVE_INFINITY;

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      if (Boolean(left.image) !== Boolean(right.image)) {
        return left.image ? -1 : 1;
      }

      return left.localId.localeCompare(right.localId, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [filteredCards, pricesByCardId, pricingRegion, scanRankById, priceLanguage, finishFor, likelyRank, sort]);

  const uniqueSets = useMemo(() => {
    return [...new Map(cards.map((card) => [card.set.id, card.set])).values()]
      .filter((set) => Boolean(set.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);

  const uniqueRarities = useMemo(() => {
    return [...new Set(cards.flatMap((c) => (c.rarity ? [c.rarity] : [])))];
  }, [cards]);

  const defaultLanguage = defaultCardLanguage ?? 'en';
  const activeFilterChips = useMemo(
    () =>
      getActiveFilterChips(
        {
          filters: { ...filters, pokemon: pokemonFilter },
          language: selectedCardLanguage,
          defaultLanguage,
          variant: variantChoice,
          sort,
        },
        (id) => uniqueSets.find((set) => set.id === id)?.name,
        (id) => pokemonOptions.find((option) => option.id === id)?.name,
      ),
    [defaultLanguage, filters, pokemonFilter, pokemonOptions, selectedCardLanguage, sort, uniqueSets, variantChoice],
  );
  const updateSort = useCallback((next: CardPickerSort) => {
    setSort(next);
    saveCardPickerSort(next);
  }, []);
  const clearFilter = useCallback(
    (key: CardPickerFilterKey) => {
      if (key === 'sort') updateSort('default');
      else if (key === 'language') setSelectedCardLanguage(defaultLanguage);
      else if (key === 'variant') setVariantChoice('any');
      else setFilters((current) => ({ ...current, [key]: undefined }));
    },
    [defaultLanguage, updateSort],
  );
  const resetFilters = useCallback(() => {
    setFilters((current) => ({ searchQuery: current.searchQuery }));
    setVariantChoice('any');
    setSelectedCardLanguage(defaultLanguage);
    updateSort('default');
  }, [defaultLanguage, updateSort]);
  const closeMoreMenu = useCallback(() => setIsMoreOpen(false), []);
  useOverlay(isMoreOpen, closeMoreMenu, { containerRef: moreMenuRef, lockScroll: false, history: false });

  const getDescriptorForCard = useCallback(
    async (card: TCGCard) => {
      if (!card.image) {
        return null;
      }

      const existingPromise = descriptorCache.get(card.id);
      if (existingPromise) {
        return existingPromise;
      }

      const proxyUrl = card.image.startsWith('/')
        ? toCardImageSrc(card.image)!
        : `/app/api/card-image-proxy?url=${encodeURIComponent(card.image)}`;

      const descriptorPromise = buildCardImageDescriptor(proxyUrl).catch(() => null);
      descriptorCache.set(card.id, descriptorPromise);
      return descriptorPromise;
    },
    [descriptorCache],
  );

  const getTextSignalsForCard = useCallback(
    (card: TCGCard) => {
      const existingPromise = cardTextSignalCache.get(card.id);
      if (existingPromise) {
        return existingPromise;
      }

      const metadataSignals = buildCardMetadataTextSignals(card);
      const proxyUrl = card.image?.startsWith('/')
        ? toCardImageSrc(card.image)!
        : card.image
          ? `/app/api/card-image-proxy?url=${encodeURIComponent(card.image)}`
          : null;

      const textSignalPromise = proxyUrl
        ? import('@/lib/card-scan-ocr')
            .then(({ recognizeCardTextSignalsFromImage }) =>
              recognizeCardTextSignalsFromImage(proxyUrl, { exhaustive: true }),
            )
            .then((imageSignals) => mergeCardTextSignals([metadataSignals, imageSignals]) ?? metadataSignals)
            .catch((error) => {
              console.info('[holofolder] Skipping candidate card OCR scan:', error);
              return metadataSignals;
            })
        : Promise.resolve(metadataSignals);

      cardTextSignalCache.set(card.id, textSignalPromise);
      return textSignalPromise;
    },
    [cardTextSignalCache],
  );

  const getTextSignalsForCards = useCallback(
    async (
      candidateCards: TCGCard[],
      visualMatches: AggregatedCardScanMatch<TCGCard>[],
      querySignals: CardTextSignals | null | undefined,
    ) => {
      const textSignalMap = new Map(
        candidateCards.map((card) => [card.id, buildCardMetadataTextSignals(card)] as const),
      );
      const assetOcrCandidates = selectCandidateCardsForAssetTextOcr(candidateCards, visualMatches, querySignals, {
        getCardId: (card) => card.id,
        maxCards: CARD_SCAN_CANDIDATE_ASSET_OCR_LIMIT,
      });

      for (const card of assetOcrCandidates) {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- exhaustive OCR is heavy on phones, so candidates run one at a time
        textSignalMap.set(card.id, await getTextSignalsForCard(card));
      }

      return textSignalMap;
    },
    [getTextSignalsForCard],
  );

  const scoreSingleCardFrame = useCallback(
    async (file: File) => {
      const candidates = cards.filter((card) => Boolean(card.image));
      if (candidates.length === 0) {
        throw new Error('There are no card images loaded for this Pokemon yet.');
      }

      const queryDescriptor = await buildCardImageDescriptor(file, { requireCardBounds: true });
      const scoredMatches = (
        await Promise.all(
          candidates.map(async (card) => {
            const descriptor = await getDescriptorForCard(card);
            if (!descriptor) {
              return null;
            }

            const match = compareCardImageDescriptors(queryDescriptor, descriptor);
            return {
              card,
              similarity: match.similarity,
            };
          }),
        )
      )
        .filter((match): match is CardScanMatch => Boolean(match))
        .sort((left, right) => right.similarity - left.similarity);

      if (scoredMatches.length === 0) {
        throw new Error('The scan could not compare that image to the loaded card set.');
      }

      return scoredMatches;
    },
    [cards, getDescriptorForCard],
  );

  const closeCardScanner = useCallback(() => {
    setIsCardScannerOpen(false);
    setCameraError(null);
    setIsCapturingCardScan(false);
    setIsApplyingCardResults(false);
    setCardFramesProcessed(0);
    setCardUsableFrames(0);
    setLastFramePreviewUrl(null);
  }, []);

  const selectorDialogRef = useRef<HTMLDivElement | null>(null);
  const cardScannerRef = useRef<HTMLDivElement | null>(null);
  const closeCardScannerSafely = useCallback(() => {
    if (isCapturingCardScan || isApplyingCardResults) return;
    closeCardScanner();
  }, [closeCardScanner, isApplyingCardResults, isCapturingCardScan]);
  useOverlay(true, onClose, { containerRef: selectorDialogRef, autoFocus: false });
  const selectorSwipe = useSwipeToDismiss(selectorDialogRef, onClose);
  useOverlay(isCardScannerOpen, closeCardScannerSafely, { containerRef: cardScannerRef });

  const openCardScanner = useCallback(() => {
    if (cards.length === 0 || isLoading) {
      return;
    }

    setScanError(null);
    setCameraError(null);
    setCardFramesProcessed(0);
    setCardUsableFrames(0);
    setLastFramePreviewUrl(null);
    setIsCardScannerOpen(true);
  }, [cards.length, isLoading]);

  const handleGuidedCardScan = useCallback(async () => {
    const video = cardVideoRef.current;
    const canvas = cardCanvasRef.current;

    if (!video || !canvas || !isCameraReady || isCapturingCardScan) {
      return;
    }

    setIsCapturingCardScan(true);
    setIsScanningCard(true);
    setScanError(null);
    setCameraError(null);
    setCardFramesProcessed(0);
    setCardUsableFrames(0);
    setScanMatches([]);

    try {
      const candidates = cards.filter((card) => Boolean(card.image));
      const successfulFrameMatches: CardScanMatch[][] = [];
      const scanTextSignalPromises: Array<Promise<CardTextSignals | null>> = [];

      const startTextScan = (previewUrl: string) => {
        if (scanTextSignalPromises.length >= CARD_SCAN_OCR_FRAME_LIMIT) return;

        scanTextSignalPromises.push(
          import('@/lib/card-scan-ocr')
            .then(({ recognizeCardTextSignalsFromImage }) =>
              recognizeCardTextSignalsFromImage(previewUrl, { exhaustive: true }),
            )
            .catch((error) => {
              console.info('[holofolder] Skipping card OCR scan:', error);
              return null;
            }),
        );
      };

      for (let index = 0; index < CARD_SCAN_FRAME_COUNT; index += 1) {
        setCardFramesProcessed(index + 1);
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- frames are captured one after another, spaced over time
        const frame = await captureSingleCardFrame(video, canvas, index);
        setLastFramePreviewUrl(frame.previewUrl);

        try {
          const matches = await scoreSingleCardFrame(frame.file);
          if (
            scanTextSignalPromises.length === 0 ||
            (scanTextSignalPromises.length < CARD_SCAN_OCR_FRAME_LIMIT &&
              index >= Math.floor(CARD_SCAN_FRAME_COUNT / 2))
          ) {
            startTextScan(frame.previewUrl);
          }
          successfulFrameMatches.push(matches);
          setCardUsableFrames(successfulFrameMatches.length);
          setScanPreviewUrl((currentUrl) => {
            if (currentUrl) {
              URL.revokeObjectURL(currentUrl);
            }
            return URL.createObjectURL(frame.file);
          });
        } catch {
          // Ignore bad or reflective frames and keep sampling.
        }

        if (index < CARD_SCAN_FRAME_COUNT - 1) {
          await delay(CARD_SCAN_FRAME_DELAY_MS);
        }
      }

      if (successfulFrameMatches.length < CARD_SCAN_MIN_USABLE_FRAMES) {
        throw new Error(
          `Only got ${successfulFrameMatches.length} usable frame${successfulFrameMatches.length === 1 ? '' : 's'} from the scan. Fill the guide with one card and keep it steady.`,
        );
      }

      setIsCapturingCardScan(false);
      setIsApplyingCardResults(true);

      const minimumAppearances = Math.max(2, Math.ceil(successfulFrameMatches.length * 0.45));
      const textSignals = mergeCardTextSignals(await Promise.all(scanTextSignalPromises));
      const visualMatches = aggregateCardScanMatches(successfulFrameMatches, {
        getCardId: (card) => card.id,
        minimumAppearances,
        maxResults: 6,
      });
      const candidateTextSignals = textSignals
        ? await getTextSignalsForCards(candidates, visualMatches, textSignals)
        : undefined;
      const aggregatedMatches = rankAggregatedCardScanMatchesWithText(visualMatches, textSignals, {
        candidateCards: candidates,
        candidateTextSignals,
        getCardId: (card) => card.id,
      })
        .slice(0, 6)
        .map((match) => ({
          card: match.card,
          similarity: match.similarity,
        }));

      if (aggregatedMatches.length === 0) {
        throw new Error('The scan did not get a stable match. Try again with less glare and the card centered.');
      }

      setScanMatches(aggregatedMatches);
      closeCardScanner();
    } catch (scanError) {
      console.error(scanError);
      const message = scanError instanceof Error ? scanError.message : 'The card scan failed.';
      setScanError(message);
      setCameraError(message);
    } finally {
      setIsCapturingCardScan(false);
      setIsApplyingCardResults(false);
      setIsScanningCard(false);
    }
  }, [cards, closeCardScanner, getTextSignalsForCards, isCameraReady, isCapturingCardScan, scoreSingleCardFrame]);

  return (
    <>
      {isCardScannerOpen && (
        <div
          ref={cardScannerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Single card scanner"
          className="fixed inset-0 z-[60] bg-black outline-none"
        >
          <canvas ref={cardCanvasRef} className="hidden" />
          <div className="mx-auto flex h-full w-full max-w-md flex-col px-3 pt-[calc(var(--top-inset)+0.25rem)] pb-[calc(var(--safe-bottom)+0.75rem)]">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                <div>
                  <p className="text-sm font-semibold">Single Card Scan</p>
                  <p className="text-xs text-white/65">
                    Guided multi-frame scan using the same camera flow as page scanning.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  aria-label="Close card scanner"
                  onClick={closeCardScanner}
                  disabled={isCapturingCardScan || isApplyingCardResults}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="relative min-h-0 flex-1 bg-black">
                <video
                  ref={cardVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`h-full w-full object-cover transition-opacity ${lastFramePreviewUrl ? 'opacity-25' : 'opacity-100'}`}
                />
                {lastFramePreviewUrl ? (
                  <div className="absolute inset-0">
                    {/* oxlint-disable-next-line nextjs/no-img-element -- blob: URL of a camera frame, next/image can't load it */}
                    <img
                      src={lastFramePreviewUrl}
                      alt="Last scanned card frame"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                    <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between rounded-full border border-white/12 bg-black/60 px-3 py-2 text-[11px] text-white/80 backdrop-blur">
                      <span>Last good frame</span>
                      <span>{cardUsableFrames} usable</span>
                      <span>
                        {Math.min(CARD_SCAN_FRAME_COUNT, cardFramesProcessed)}/{CARD_SCAN_FRAME_COUNT}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div
                      className="rounded-[2.25rem] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.36)]"
                      style={{
                        width: `${(1 - CARD_GUIDE_INSET_X * 2) * 100}%`,
                        aspectRatio: `${CARD_ASPECT_RATIO}`,
                        maxHeight: `${(1 - CARD_GUIDE_INSET_Y * 2) * 100}%`,
                      }}
                    />
                  </div>
                )}
                {!isCameraReady && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm text-white">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting camera
                    </div>
                  </div>
                )}
                {!lastFramePreviewUrl && <CameraControls track={camera.track} />}
              </div>

              <div className="space-y-3 border-t border-white/10 bg-black/85 px-4 py-4 text-white">
                {cameraError ? (
                  <p className="text-sm text-red-300">{cameraError}</p>
                ) : (
                  <p className="text-sm text-white/70">
                    Place one card inside the guide and keep it steady. The scanner samples for about{' '}
                    {Math.round((CARD_SCAN_FRAME_COUNT * CARD_SCAN_FRAME_DELAY_MS) / 1000)} seconds and keeps the last
                    usable frame visible.
                  </p>
                )}

                {isCapturingCardScan || isApplyingCardResults ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-white/65">
                      <span>
                        {isCapturingCardScan
                          ? `Scanning ${cardFramesProcessed}/${CARD_SCAN_FRAME_COUNT}`
                          : 'Applying results'}
                      </span>
                      <span>
                        {cardUsableFrames} usable frame{cardUsableFrames === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-white transition-[width]"
                        style={{
                          width: `${isCapturingCardScan ? (cardFramesProcessed / CARD_SCAN_FRAME_COUNT) * 100 : 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={closeCardScanner}
                    disabled={isCapturingCardScan || isApplyingCardResults}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGuidedCardScan}
                    disabled={!isCameraReady || isCapturingCardScan || isApplyingCardResults}
                  >
                    {isCapturingCardScan || isApplyingCardResults ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="mr-2 h-4 w-4" />
                    )}
                    {isCapturingCardScan
                      ? 'Scanning Card'
                      : isApplyingCardResults
                        ? 'Applying Results'
                        : 'Start Guided Scan'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div data-overlay-backdrop aria-hidden="true" className="fixed inset-0 z-50 bg-black/80" onClick={onClose} />
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only stops taps bubbling to parent overlays through the React tree */}
      <div
        ref={selectorDialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Card selector"
        className="border-border bg-card fixed inset-x-0 z-50 flex flex-col overflow-hidden rounded-t-[2.25rem] border shadow-[0_-28px_80px_-42px_rgba(0,0,0,0.75)] outline-none sm:inset-x-3 sm:rounded-[2.25rem] lg:inset-x-8 xl:right-auto xl:left-1/2 xl:w-[min(calc(100vw-4rem),92rem)] xl:-translate-x-1/2"
        onClick={(e) => e.stopPropagation()}
        style={{
          top: 'calc(var(--top-inset) + 0.5rem)',
          bottom: 'calc(var(--safe-bottom) + 0.25rem)',
          overscrollBehaviorY: 'contain',
          touchAction: 'pan-y',
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-border bg-card z-20 shrink-0 border-b px-4 pt-2 pb-2.5 sm:px-5 sm:pt-3">
            <div data-sheet-grabber {...selectorSwipe} className="-mx-4 -mt-2 mb-1 px-4 pt-2 pb-1 sm:hidden">
              <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto h-1.5 w-10 rounded-full" />
            </div>
            <h2 className="sr-only">{intentCopy.title}</h2>
            <p className="sr-only">{intentCopy.helper}</p>
            <div className="flex items-center gap-2">
              {!native && (
                <div
                  role="group"
                  aria-label="Picker mode"
                  className="border-border/60 bg-background/70 grid shrink-0 grid-cols-2 rounded-full border p-0.5 dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <button
                    type="button"
                    aria-pressed={selectionMode === 'collect'}
                    aria-label="Add card"
                    onClick={() => setSelectionMode('collect')}
                    className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                      selectionMode === 'collect'
                        ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-400/50 dark:text-emerald-300'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>
                      Add<span className="hidden sm:inline"> card</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={selectionMode === 'wishlist'}
                    aria-label="Wanted"
                    onClick={() => setSelectionMode('wishlist')}
                    className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                      selectionMode === 'wishlist'
                        ? 'bg-amber-500/15 text-amber-700 ring-1 ring-amber-400/55 dark:text-amber-300'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Heart className={`h-3.5 w-3.5 ${selectionMode === 'wishlist' ? 'fill-current' : ''}`} />
                    <span>
                      Want<span className="hidden sm:inline">ed</span>
                    </span>
                  </button>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm leading-tight font-semibold ${anyCard ? '' : 'capitalize'}`}>
                  {anyCard?.title ?? pokemonName}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {anyCard && !anyCardQuery.trim()
                    ? 'Any card, Trainer or Energy'
                    : several
                      ? `${picks.length} of ${room} empty pocket${room === 1 ? '' : 's'} on this page`
                      : `${filteredCards.length} of ${cards.length} cards`}
                </p>
              </div>
              {native?.many && room > 1 && (
                <button
                  type="button"
                  aria-pressed={several}
                  onClick={() => {
                    setSeveral((on) => !on);
                    setPicks([]);
                  }}
                  className={`h-9 shrink-0 rounded-full px-3 text-xs font-semibold transition-colors ${
                    several
                      ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-400/50 dark:text-emerald-300'
                      : 'border-border/60 text-muted-foreground hover:text-foreground border'
                  }`}
                >
                  {several ? 'Pick one' : 'Pick several'}
                </button>
              )}
              {!native && (
                <div className="relative shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    aria-label="More options"
                    aria-haspopup="menu"
                    aria-expanded={isMoreOpen}
                    onClick={() => setIsMoreOpen((open) => !open)}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                  {isMoreOpen && (
                    <div aria-hidden="true" className="fixed inset-0 z-20" onClick={() => setIsMoreOpen(false)} />
                  )}
                  {isMoreOpen && (
                    <div
                      ref={moreMenuRef}
                      role="menu"
                      aria-label="More options"
                      className="border-border bg-card absolute top-10 right-0 z-30 w-56 rounded-2xl border p-1 shadow-xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsMoreOpen(false);
                          if (isWishlistMode) onClose();
                          else selectWithoutCard();
                        }}
                        className="hover:bg-muted/70 flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm"
                      >
                        {isWishlistMode ? 'Cancel wanted selection' : intentCopy.emptyActionLabel}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full"
                onClick={onClose}
                aria-label="Close card selector"
              >
                <X className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>

            <div className={`mt-2 items-center gap-2 ${anyCard?.cardId ? 'hidden' : 'flex'}`}>
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                />
                <input
                  type="search"
                  aria-label="Search cards"
                  placeholder={intentCopy.searchPlaceholder}
                  value={filters.searchQuery || ''}
                  onChange={(e) => setFilters((f) => ({ ...f, searchQuery: e.target.value }))}
                  autoFocus={Boolean(anyCard)}
                  className="border-border/60 bg-background/85 placeholder:text-muted-foreground focus-visible:ring-primary/50 h-11 w-full rounded-2xl border pr-11 pl-9 text-base outline-none focus-visible:ring-2 md:text-sm [&::-webkit-search-cancel-button]:hidden"
                />
                {!anyCard && (
                  <button
                    type="button"
                    onClick={openCardScanner}
                    disabled={isLoading || cards.length === 0 || isScanningCard}
                    aria-label={intentCopy.scanLabel}
                    className="text-muted-foreground hover:bg-muted/70 hover:text-foreground absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl disabled:opacity-40"
                  >
                    {isScanningCard ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {targetLanguages && (
                <SelectorMenu
                  label="Binder filter"
                  heading="Show"
                  menuLabel="Choose which cards to show"
                  width={200}
                  className="shrink-0"
                  icon={
                    <>
                      <ListFilter className={`h-4 w-4 ${matchBinder ? 'text-primary' : ''}`} aria-hidden />
                      {matchBinder && (
                        <span className="bg-primary absolute top-1.5 right-1.5 h-2 w-2 rounded-full" aria-hidden />
                      )}
                    </>
                  }
                  value={matchBinder ? 'binder' : 'all'}
                  valueLabel={matchBinder ? 'Binder settings' : 'All cards'}
                  options={[
                    { value: 'binder', label: 'Binder settings' },
                    { value: 'all', label: 'All cards' },
                  ]}
                  onSelect={(value) => setMatchBinder(value === 'binder')}
                />
              )}
              <button
                type="button"
                onClick={() => setIsFiltersOpen(true)}
                aria-haspopup="dialog"
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold transition-colors ${
                  activeFilterChips.length > 0
                    ? 'border-primary/45 bg-primary/12 text-primary'
                    : 'border-border/60 bg-background/85 text-foreground hover:bg-muted/60'
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>Filters · Sort</span>
                {activeFilterChips.length > 0 && (
                  <span className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px]">
                    {activeFilterChips.length}
                  </span>
                )}
              </button>
            </div>

            {activeFilterChips.length > 0 && (
              <div
                role="list"
                aria-label="Active filters"
                className="scrollbar-hide -mx-4 mt-2 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
              >
                {activeFilterChips.map((chip) => (
                  <span role="listitem" key={chip.key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => clearFilter(chip.key)}
                      aria-label={`Remove filter ${chip.label}`}
                      className="border-primary/35 bg-primary/10 text-primary flex h-9 items-center gap-1 rounded-full border pr-2 pl-3 text-xs font-semibold"
                    >
                      <span className="max-w-[10rem] truncate">{chip.label}</span>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                {activeFilterChips.length > 1 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-muted-foreground hover:text-foreground h-9 shrink-0 rounded-full px-3 text-xs font-semibold"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>

          {pendingCard && (
            <CardPickerVariantSheet
              cardName={pendingCard.name}
              setName={pendingCard.set.name}
              image={pendingCard.image}
              actionLabel={isWishlistMode ? 'Want' : 'Add'}
              choices={pendingChoices.map((choice) => {
                const finishPrice = pendingFinishPrices[choice.finish];
                return {
                  ...choice,
                  price: finishPrice
                    ? formatAmount(finishPrice.marketGbpAmount ?? finishPrice.gbpAmount, pendingSnapshot)
                    : null,
                };
              })}
              suggested={getCardPickerSuggestedFinish(pendingChoices, (finish) => {
                const price = pendingFinishPrices[finish];
                return price?.marketGbpAmount ?? price?.gbpAmount;
              })}
              onChoose={(finish) => {
                const card = pendingCard;
                setPendingCard(null);
                selectCard(card, finish);
              }}
              onClose={() => setPendingCard(null)}
            />
          )}
          {isFiltersOpen && (
            <CardPickerFiltersSheet
              sort={sort}
              onSortChange={updateSort}
              language={selectedCardLanguage}
              onLanguageChange={setSelectedCardLanguage}
              allowAnyLanguage={isAnyCard}
              variant={variantChoice}
              onVariantChange={setVariantChoice}
              pokemon={pokemonFilter}
              pokemonOptions={pokemonOptions}
              onPokemonChange={(pokemon) => setFilters((f) => ({ ...f, pokemon }))}
              set={filters.set}
              sets={uniqueSets}
              onSetChange={(set) => setFilters((f) => ({ ...f, set }))}
              rarity={filters.rarity}
              rarities={uniqueRarities}
              onRarityChange={(rarity) => setFilters((f) => ({ ...f, rarity }))}
              resultCount={filteredCards.length}
              onReset={resetFilters}
              onClose={() => setIsFiltersOpen(false)}
            />
          )}

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
            }}
          >
            {(isScanningCard || scanError || scanMatches.length > 0 || scanPreviewUrl) && (
              <div className="border-border bg-background/70 border-b p-3 sm:p-4">
                <div className="flex flex-col gap-3 lg:flex-row">
                  {scanPreviewUrl && (
                    <div className="border-border bg-muted w-full max-w-[140px] shrink-0 overflow-hidden rounded-2xl border sm:max-w-[180px]">
                      {/* oxlint-disable-next-line nextjs/no-img-element -- blob: URL of a scanned frame, next/image can't load it */}
                      <img src={scanPreviewUrl} alt="Scanned card preview" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <p className="text-sm font-medium">Single-card scan</p>
                      <p className="text-muted-foreground text-xs">
                        The scanner samples multiple guided frames, throws away unstable captures, and ranks the closest
                        loaded cards by consistency.
                      </p>
                    </div>
                    {isScanningCard && (
                      <div className="border-border bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Comparing stable guided frames against {cards.length} loaded cards…
                      </div>
                    )}
                    {scanError && <div className="text-destructive text-sm">{scanError}</div>}
                    {scanMatches.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {scanMatches.map((match, index) => {
                          const price = pricesByCardId[getCardPriceKey(match.card.id, priceLanguage(match.card))];
                          const priceLabels = getCardSelectorPriceLabels(price, formatAmount);

                          return (
                            <button
                              type="button"
                              key={match.card.id}
                              onClick={() => pickCard(match.card)}
                              className={`border-border bg-muted/40 hover:bg-muted/60 flex items-center gap-3 rounded-2xl border p-3 text-left transition-[background-color,border-color,transform,scale] ${intentHoverCardClass}`}
                            >
                              <CardSelectorImage
                                src={match.card.image}
                                sizes="56px"
                                alt={match.card.name}
                                className="bg-muted h-20 w-14 shrink-0 rounded-md object-cover"
                                fallbackClassName="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-muted"
                              />
                              <div className="min-w-0">
                                <p className={`text-xs font-medium tracking-[0.2em] uppercase ${intentTextClass}`}>
                                  {index === 0 ? 'Best Match' : `Match ${index + 1}`}
                                </p>
                                <p className="truncate text-sm font-medium">{match.card.set.name}</p>
                                <p className="text-muted-foreground text-xs">#{match.card.localId}</p>
                                <p className="text-muted-foreground mt-1 text-xs">
                                  Similarity {Math.round(match.similarity * 100)}%
                                </p>
                                <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
                                  <span className="bg-background/70 rounded-lg px-1.5 py-1 text-emerald-600 dark:text-emerald-300">
                                    Low {priceLabels.good ?? (isLoadingPrices ? '...' : '-')}
                                  </span>
                                  <span className="bg-background/70 text-foreground rounded-lg px-1.5 py-1">
                                    Market {priceLabels.market ?? (isLoadingPrices ? '...' : '-')}
                                  </span>
                                </div>
                                {priceLabels.range || priceLabels.confidence ? (
                                  <p className="text-muted-foreground mt-1 truncate text-[10px]">
                                    {[
                                      priceLabels.range ? `Range ${priceLabels.range}` : null,
                                      priceLabels.confidence ? `${priceLabels.confidence} confidence` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </p>
                                ) : null}
                                <p className={`mt-1 text-xs font-medium ${intentTextClass}`}>
                                  {intentCopy.actionLabel}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="px-5 py-4 pb-[calc(var(--safe-bottom)+1.25rem)] sm:px-5 sm:py-4">
              {isWishlistMode && onClearWanted && (
                <Button variant="outline" onClick={onClearWanted} className="text-destructive mb-3 min-h-11 w-full">
                  Remove from want list
                </Button>
              )}
              <p className="mb-3 text-sm font-semibold">{intentCopy.title}</p>
              {!isOnline && cards.length > 0 && (
                <p
                  role="status"
                  className="border-border/60 bg-muted/40 text-muted-foreground mb-3 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs"
                >
                  <WifiOff className="h-3.5 w-3.5 shrink-0" />
                  You&apos;re offline. Showing saved cards and prices; your pick syncs when you reconnect.
                </p>
              )}
              {isLoading && cards.length === 0 ? (
                <div
                  role="status"
                  aria-label="Loading cards"
                  className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5"
                >
                  {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} aria-hidden="true" className="bg-muted/40 overflow-hidden rounded-xl">
                      <div className="holo-loading trading-card w-full" />
                      <div className="space-y-1 p-1.5">
                        <div className="bg-muted h-2.5 w-3/4 rounded" />
                        <div className="bg-muted h-2.5 w-1/2 rounded" />
                      </div>
                    </div>
                  ))}
                  <span className="sr-only">Loading cards…</span>
                </div>
              ) : anyCard && cards.length === 0 ? (
                <div className="mx-auto flex max-w-xs flex-col items-center gap-2 py-10 text-center">
                  {!isOnline ? (
                    <WifiOff className="text-muted-foreground h-6 w-6" />
                  ) : (
                    <Search className="text-muted-foreground h-6 w-6" />
                  )}
                  <p className="text-sm font-semibold">
                    {anyCardQuery.trim().length < 2
                      ? 'Search for a card'
                      : !isOnline
                        ? "You're offline"
                        : 'No cards found'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {anyCardQuery.trim().length < 2
                      ? 'Type a name, a set or a card number. Trainers and Energy work too.'
                      : !isOnline
                        ? 'Only cards already saved on this device can be found offline.'
                        : anyCard.cardId
                          ? "This card isn't available to add right now."
                          : 'Try a different name, set or number.'}
                  </p>
                </div>
              ) : error || cards.length === 0 ? (
                <div className="mx-auto flex max-w-xs flex-col items-center gap-3 py-10 text-center">
                  {!isOnline && <WifiOff className="text-muted-foreground h-6 w-6" />}
                  <p className="text-sm font-semibold">
                    {!isOnline ? "You're offline" : error ? "Couldn't load cards" : `No cards found for ${pokemonName}`}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {native
                      ? !isOnline
                        ? "These cards haven't been saved on this device yet. Reconnect to load them."
                        : error
                          ? 'Check your connection and try again.'
                          : 'There are no printings to choose for this Pokémon yet.'
                      : !isOnline
                        ? "These cards haven't been saved on this device yet. Reconnect to load them, or mark the slot without a card."
                        : error
                          ? 'Check your connection and try again, or mark the slot without a card.'
                          : 'You can still mark the slot without choosing a printing.'}
                  </p>
                  {!native && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 rounded-2xl px-4"
                      onClick={isWishlistMode ? onClose : selectWithoutCard}
                    >
                      {isWishlistMode ? 'Cancel' : intentCopy.emptyActionLabel}
                    </Button>
                  )}
                </div>
              ) : filteredCards.length === 0 ? (
                <div className="mx-auto flex max-w-xs flex-col items-center gap-3 py-10 text-center">
                  <p className="text-sm font-semibold">No cards match</p>
                  <p className="text-muted-foreground text-xs">Try a different search or clear the filters.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-2xl px-4"
                    onClick={() => {
                      resetFilters();
                      setFilters({});
                    }}
                  >
                    Clear search and filters
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5">
                  {displayedCards.map((card) => {
                    const price = pricesByCardId[getCardPriceKey(card.id, priceLanguage(card))];
                    const priceLabels = getCardSelectorPriceLabels(price, formatAmount);
                    const pickNumber = several ? picks.findIndex((pick) => pick.card.id === card.id) + 1 : 0;
                    const isCurrent = pickNumber > 0 || matchesCatalogCardId(card, activeSelectedCardId);
                    const isWantedHere = !isWishlistMode && matchesCatalogCardId(card, selectedWantedCardId);

                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => pickCard(card)}
                        aria-label={`${isWishlistMode ? 'Want card' : several ? 'Pick card' : 'Add card'} ${card.name} from ${card.set.name}`}
                        aria-pressed={several ? pickNumber > 0 : undefined}
                        className={`group/card bg-card focus-visible:ring-primary/70 relative flex flex-col justify-start overflow-hidden rounded-xl border-2 text-left transition-[background-color,border-color,transform,scale] focus-visible:ring-2 focus-visible:outline-none sm:hover:scale-[1.03] ${
                          isCurrent ? intentSelectedCardClass : `border-transparent ${intentHoverCardClass}`
                        }`}
                      >
                        {scanRankById.has(card.id) && (
                          <div className="absolute top-2 left-2 z-10 rounded-full bg-black/80 px-2 py-1 text-[10px] font-medium text-white">
                            Match {scanRankById.get(card.id)}
                          </div>
                        )}
                        <div className="trading-card bg-muted relative w-full">
                          <CardSelectorImage
                            src={card.image}
                            alt={card.name}
                            className="bg-muted absolute inset-0 h-full w-full object-cover"
                          />
                          {pickNumber > 0 ? (
                            <div className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white tabular-nums">
                              {pickNumber}
                            </div>
                          ) : isCurrent ? (
                            <div
                              className={`absolute top-1.5 right-1.5 rounded-full border px-2 py-1 text-[9px] font-bold tracking-[0.12em] uppercase backdrop-blur ${intentCopy.activeClass}`}
                            >
                              {intentCopy.currentLabel}
                            </div>
                          ) : isWantedHere ? (
                            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full border border-amber-400/60 bg-black/70 px-2 py-1 text-[9px] font-bold tracking-[0.12em] text-amber-300 uppercase">
                              <Heart className="h-2.5 w-2.5 fill-current" />
                              Wanted
                            </div>
                          ) : (
                            <PriceRisingBadge price={price} className="absolute top-1.5 right-1.5" />
                          )}
                        </div>
                        <div className="p-1.5 sm:p-2">
                          {anyCard && (
                            <p className="text-foreground truncate text-[11px] font-semibold sm:text-xs">{card.name}</p>
                          )}
                          <p
                            className={`truncate text-[10px] sm:text-xs ${anyCard ? 'text-muted-foreground' : 'text-foreground font-semibold'}`}
                          >
                            {card.set.name}
                          </p>
                          {!anyCard && card.name.includes('(') && (
                            <p className="text-foreground mt-0.5 text-[10px]">{card.name}</p>
                          )}
                          {/* Both price lines keep their height while loading, loaded or missing, so tiles never jump. */}
                          <div
                            className="mt-1 grid h-[1.125rem] grid-cols-2 gap-1 text-[9px] leading-[1.125rem] font-semibold tabular-nums sm:h-5 sm:text-[10px] sm:leading-5"
                            data-price-line
                          >
                            {priceLabels.good || priceLabels.market || !isLoadingPrices ? (
                              <>
                                <span className="bg-muted truncate rounded-md px-1 text-emerald-600 dark:text-emerald-300">
                                  L {priceLabels.good ?? '-'}
                                </span>
                                <span className="bg-muted text-foreground truncate rounded-md px-1">
                                  M {priceLabels.market ?? '-'}
                                </span>
                              </>
                            ) : (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="bg-muted/70 animate-pulse rounded-md motion-reduce:animate-none"
                                />
                                <span
                                  aria-hidden="true"
                                  className="bg-muted/70 animate-pulse rounded-md motion-reduce:animate-none"
                                />
                                <span className="sr-only">Loading price</span>
                              </>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-1 h-3 truncate text-[9px] leading-3" data-price-range>
                            {[priceLabels.range ? `R ${priceLabels.range}` : null, priceLabels.confidence]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          <div className="mt-1 flex items-center justify-between gap-1">
                            <p className="text-muted-foreground text-[9px] sm:text-[10px]">
                              #{card.localId}
                              {selectedCardLanguage === 'any' && card.language && (
                                <span className="ml-1 font-semibold uppercase">
                                  {CARD_PICKER_LANGUAGES.find((language) => language.id === card.language)
                                    ?.shortLabel ?? card.language}
                                </span>
                              )}
                            </p>
                            <span
                              aria-hidden="true"
                              className={`flex items-center gap-0.5 text-[9px] font-bold uppercase sm:text-[10px] ${intentTextClass}`}
                            >
                              {isWishlistMode ? (
                                <Heart className="h-2.5 w-2.5 fill-current" />
                              ) : (
                                <Check className="h-2.5 w-2.5" />
                              )}
                              {intentCopy.shortLabel}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {!filtersMatchBinder && !isLoading && (
                <p role="status" className="mt-4 px-2 text-center text-xs text-amber-700 dark:text-amber-300">
                  Your filters don’t match this binder’s settings.
                </p>
              )}
            </div>
          </div>
          {several && native?.many && (
            <div className="border-border bg-card shrink-0 border-t px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)]">
              {native.many.error && (
                <p role="alert" className="text-destructive mb-2 text-xs">
                  {native.many.error}
                </p>
              )}
              <Button
                className="min-h-11 w-full rounded-2xl"
                disabled={!picks.length || native.many.busy}
                onClick={() => native.many?.onAdd(picks)}
              >
                {picks.length
                  ? `Add ${picks.length} card${picks.length === 1 ? '' : 's'} to this page`
                  : 'Tap cards to pick them'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
