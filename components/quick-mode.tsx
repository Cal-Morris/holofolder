'use client';

// Quick mode: a full-screen, one-handed launcher. One search field (pinned at the bottom, in thumb reach) finds
// app destinations, Pokémon, cards (offline: the cards on this device) and illustrators. See
// lib/quick-mode.ts for the pure helpers and docs in AGENTS.md (Quick mode).
import {
  nativeCardConsumers,
  nativeCardState,
  nativeCardLabel,
  type NativeConsumerBinding,
} from '@/lib/collection/native-card-consumers';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import dynamic from 'next/dynamic';
import {
  BarChart3,
  Camera,
  Grid3X3,
  Heart,
  Layers,
  Layers3,
  ListChecks,
  Loader2,
  Palette,
  Search,
  Settings,
  Sparkles,
  Ticket,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { useMediaQuery } from '@/hooks/use-media-query';
import { SetSymbol } from '@/components/set-symbol';
import { useCardSearch, useIllustratorSearch, useSetSearch } from '@/hooks/use-card-search';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import { getCardPriceKey, useStableCardPriceLookups, type CardPriceSnapshot } from '@/hooks/use-card-prices';
import { CardThumbnail } from '@/components/card-thumbnail';
import {
  POKEMON_CATALOG,
  formatPokemonDisplayName,
  getPokemonSummary,
  type PokemonSummary,
} from '@/lib/pokemon-catalog';
import { formatCardNumber, type SearchCardResult } from '@/lib/pokemon-card-browse';
import { searchPokemonItems } from '@/lib/pokemon-search-state';
import { formatSetHitMeta } from '@/lib/set-search';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';
import { recentToSearchCard, toRecentCard } from '@/lib/recent-cards';
import { useShowRevisit } from '@/hooks/use-show-revisit';
import ShowBudget from '@/components/show-budget';
import ShowRevisit from '@/components/show-revisit';
import type { RevisitCard } from '@/lib/show-revisit';
import { DEFAULT_PRICING_REGION, type PricingRegion } from '@/lib/pricing-region';
import { matchQuickDestinations, type QuickDestination, type QuickDestinationId } from '@/lib/quick-mode';
import { formatMoney, type DisplayFxRates } from '@/lib/regional-price';
import type { DisplayCurrency } from '@/lib/pricing-region';
import { isCardLanguage, type CardFinish } from '@/lib/domain/cards';
import type { QuickBundleEntry, QuickCardAction, QuickCardState } from '@/components/quick-card-check';
import {
  CARD_STANDING_BADGES,
  getCardStanding,
  wantedToSearchCard,
  type HuntSourceItem,
  type PokemonCardStanding,
} from '@/lib/show-hunt';
import { searchOfflineCards } from '@/lib/offline-card-index';
// Bundled with Quick mode (not split) so the finder never needs a network round trip at a show.
import type { BinderOfflineSource } from '@/components/binder-offline-prep';
import ShowOfflinePrep from '@/components/show-offline-prep';
import type { BinderHistory } from '@/hooks/use-binder-history';
import RecentSearches from '@/components/recent-searches';
import ShowRecentCards from '@/components/show-recent-cards';
import ShowHunt, { PokemonSprite } from '@/components/show-hunt';
import ShowPokemonCards from '@/components/show-pokemon-cards';
// Also bundled, so Scan opens offline at a show without fetching its code.
import QuickCardScanner, { type CardScanResult } from '@/components/quick-card-scanner';
import { lookupPokemon } from '@/lib/card-scan-search';

import { PriceRisingBadge } from '@/components/price-rising-badge';
import { MomentumSortChips } from '@/components/momentum-sort-chips';
import { applyMomentumSort, type MomentumSort } from '@/lib/momentum-sort';
const QuickCardCheck = dynamic(() => import('@/components/quick-card-check'), { ssr: false });
const QuickBundle = dynamic(() => import('@/components/quick-bundle'), { ssr: false });

/** What to tell him when a scan lands in the search field instead of a deal check. */
export function scanNoticeFor(result: CardScanResult): string | null {
  const { outcome } = result;
  if (outcome.kind === 'match') return null;
  if (outcome.kind === 'choose') {
    return result.offline
      ? `Read “${outcome.query}”. Offline, only cards saved on this device can be matched. Pick it below or edit the search.`
      : `Read “${outcome.query}”. Pick the right printing below.`;
  }
  if (!outcome.query) {
    return result.readerUnavailable && result.offline
      ? 'Couldn’t read the card offline. Type its name or number.'
      : result.readerUnavailable
        ? 'Couldn’t read the card. Type its name or number.'
        : null;
  }
  return `Only read “${outcome.query}”. Add the name or number to find it.`;
}

const BUNDLE_KEY = 'binderdex:show-bundle:v1';

function readBundle(): QuickBundleEntry[] {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(BUNDLE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.key === 'string' && entry.card) : [];
  } catch {
    return [];
  }
}

/** The deal checker: tapping a card opens its price check (asking price → verdict) instead of the card browser. */
export interface QuickCardCheckOptions {
  onRemoveOwned?: (pokemon: { id: number; name: string }) => void;
  onChangeCard?: (
    mode: 'collect' | 'wishlist',
    card: SearchCardResult,
    pokemon: { id: number; name: string },
    finish: CardFinish,
  ) => void;
  destinationName?: string;
  budgetKey?: string | null;
  revisitKey?: string | null;
  currency: DisplayCurrency;
  fxRates?: DisplayFxRates | null;
  readOnly?: boolean;
  getCardState: (card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish) => QuickCardState;
  onAction: (
    action: QuickCardAction,
    card: SearchCardResult,
    pokemon: { id: number; name: string },
    finish: CardFinish,
  ) => Promise<void>;
  /** The collection on this device: Show mode's Hunting list and per-Pokémon view are built from it. */
  huntItems?: readonly HuntSourceItem[];
}

const DESTINATION_ICONS: Record<QuickDestinationId, LucideIcon> = {
  binder: Grid3X3,
  list: ListChecks,
  wanted: Heart,
  sets: Layers3,
  pokemon: Sparkles,
  analytics: BarChart3,
  settings: Settings,
  scan: Camera,
  'show-mode': Ticket,
};

export interface QuickModePokemonState {
  label: string;
  toneClass: string;
}

export interface QuickModeProps {
  nativeConsumer?: NativeConsumerBinding;
  offlineBinder?: BinderOfflineSource;
  history: BinderHistory;
  onClose: () => void;
  onNavigate: (destination: QuickDestinationId) => void;
  onSelectPokemon: (pokemon: PokemonSummary) => void;
  onSelectCard: (card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish) => void;
  onBrowseIllustrator: (name: string) => void;
  /** Opens Sets on a set hit. Set hits are plain Quick mode only: Show mode and Price check stay in the lookup. */
  onBrowseSet?: (set: TCGSetSummary) => void;
  getOfflineCards: () => Promise<SearchCardResult[]>;
  /** Show mode's destination reads "Exit Show mode" while it's on. */
  showModeOn?: boolean;
  getPokemonState?: (pokemonId: number) => QuickModePokemonState | null;
  formatPrice?: (price: CardPriceSnapshot | undefined) => string | null;
  pricingRegion?: PricingRegion;
  isOnline: boolean;
  /** Destinations hidden in this context (e.g. scan while read-only). */
  hiddenDestinations?: readonly QuickDestinationId[];
  /** Set to check prices: a picked card opens its deal check (Show mode or not). */
  cardCheck?: QuickCardCheckOptions;
  /** Show mode's extras on top of the deal check: Hunting list, Pokémon card lists, bundle, card scan and
   *  the purchase tally. Off in plain Quick mode, which keeps its own search and navigation. */
  showTools?: boolean;
  /** Opens with this search typed (e.g. the want list's "Check price of any card"). */
  initialQuery?: string;
  /** Price lookup outside Show mode: "Price check" header, no Show mode framing. */
  lookupOnly?: boolean;
  /** Outside Show mode too: each card result gets its Owned / Wanted badge, wanted printings first. */
  cardStanding?: {
    getCardState: (
      card: SearchCardResult,
      pokemon: { id: number; name: string },
      finish?: CardFinish,
    ) => QuickCardState;
    /** The collection on this device: its wanted printings always match, even offline. */
    items?: readonly HuntSourceItem[];
  };
}

const STANDING_BADGES: Record<PokemonCardStanding, QuickModePokemonState> = CARD_STANDING_BADGES;

const sectionTitle = 'px-1 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground';
const rowClass =
  'flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none active:bg-muted';

function QuickMode({
  nativeConsumer,
  history,
  onClose,
  onNavigate,
  onSelectPokemon,
  onSelectCard,
  onBrowseIllustrator,
  onBrowseSet,
  getOfflineCards,
  getPokemonState,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
  isOnline,
  hiddenDestinations = [],
  showModeOn = false,
  cardCheck,
  showTools = true,
  initialQuery = '',
  lookupOnly = false,
  cardStanding,
  offlineBinder,
}: QuickModeProps) {
  const nativeModel = useMemo(() => (nativeConsumer ? nativeCardConsumers(nativeConsumer) : null), [nativeConsumer]);
  const revisit = useShowRevisit(cardCheck?.revisitKey ?? null);
  const [preparingOffline, setPreparingOffline] = useState(false);
  const [moveSort, setMoveSort] = useState<MomentumSort>('default');
  const [checking, setChecking] = useState<{
    card: SearchCardResult;
    pokemon: { id: number; name: string };
    finish?: CardFinish | null;
    savedDeal?: RevisitCard;
  } | null>(null);
  // Show mode: the Pokémon whose cards are listed (opened from a Pokémon result or a Hunting group).
  const [browsing, setBrowsing] = useState<{ id: number; name: string } | null>(null);
  // `show` is the deal check plus Show mode's extras; plain Quick mode gets only the check itself.
  const show = showTools ? cardCheck : undefined;
  const huntItems = show?.huntItems;
  const [isBundleOpen, setIsBundleOpen] = useState(false);
  const [bundle, setBundle] = useState<QuickBundleEntry[]>(() =>
    nativeConsumer || typeof window === 'undefined' ? [] : readBundle(),
  );
  const bundleRef = useRef(bundle);
  const updateBundle = useCallback(
    (update: QuickBundleEntry[] | ((current: QuickBundleEntry[]) => QuickBundleEntry[])) => {
      const next = typeof update === 'function' ? update(bundleRef.current) : update;
      bundleRef.current = next;
      setBundle(next);
      if (nativeConsumer) return;
      try {
        window.sessionStorage.setItem(BUNDLE_KEY, JSON.stringify(next));
      } catch {
        /* The bundle still works for this visit. */
      }
    },
    [nativeConsumer],
  );
  const [query, setQuery] = useState(initialQuery);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  // Cards the scanned picture looked like, when the read didn't settle which one it is.
  const [scanChoices, setScanChoices] = useState<SearchCardResult[]>([]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const prepSwipe = useSwipeToDismiss(dialogRef, onClose, preparingOffline || Boolean(nativeConsumer && isBundleOpen));
  const inputRef = useRef<HTMLInputElement | null>(null);
  useOverlay(true, onClose, { containerRef: dialogRef, autoFocus: false });
  const isWide = useMediaQuery('(min-width: 768px)');

  // In Show mode the Hunting list opens unobscured; the keyboard comes up when the search field is tapped.
  const focusOnOpen = !show || Boolean(initialQuery) || isWide;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const target = focusOnOpen ? inputRef.current : dialogRef.current;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnOpen]);

  const trimmed = query.trim();
  const destinations = useMemo(() => {
    const visible = (list: readonly QuickDestination[]) =>
      list
        .filter((entry) => !hiddenDestinations.includes(entry.id))
        .map((entry) =>
          entry.id === 'show-mode' && showModeOn
            ? { ...entry, label: 'Exit Show mode', hint: 'Show mode is on' }
            : entry,
        );
    return trimmed ? visible(matchQuickDestinations(trimmed)).slice(0, 3) : visible(matchQuickDestinations(''));
  }, [hiddenDestinations, showModeOn, trimmed]);
  const pokemonResults = useMemo(
    () => (trimmed ? searchPokemonItems(trimmed, POKEMON_CATALOG, show ? 6 : 5) : []),
    [show, trimmed],
  );
  const cardSearch = useCardSearch(query, true, getOfflineCards, { includeNonPokemon: Boolean(nativeConsumer) });
  // Wanted cards that match, from the want list on this device: always found, even offline or uncached.
  const nativeState = useCallback(
    (card: SearchCardResult, _pokemon: { id: number; name: string }, finish?: CardFinish) =>
      nativeCardState(nativeModel, card, finish),
    [nativeModel],
  );
  const getCardState = nativeConsumer ? nativeState : (cardCheck?.getCardState ?? cardStanding?.getCardState);
  const standingItems = show ? huntItems : cardStanding?.items;
  const wantedMatches = useMemo(() => {
    if (nativeConsumer && trimmed) {
      const wanted =
        nativeCardConsumers(nativeConsumer)?.wants.flatMap((w) =>
          w.card ? [{ card: w.card, pokemon: { id: w.card.dexIds?.[0] ?? 0, name: w.card.name } }] : [],
        ) ?? [];
      const matched = new Set(
        searchOfflineCards(
          wanted.map((w) => w.card),
          trimmed,
        ).map((c) => c.id),
      );
      return wanted.filter((w) => matched.has(w.card.id));
    }
    if (!getCardState || !trimmed || !standingItems) return [];
    const wanted = standingItems.flatMap((item) =>
      (item.wanted_cards ?? []).map((card) => ({
        card: { ...wantedToSearchCard(card, item.pokemon_id), illustrator: card.illustrator },
        pokemon: { id: item.pokemon_id, name: item.pokemon_name },
      })),
    );
    const matched = new Set(
      searchOfflineCards(
        wanted.map((entry) => entry.card),
        trimmed,
      ).map((card) => card.id),
    );
    return wanted.filter((entry) => matched.has(entry.card.id));
  }, [getCardState, standingItems, trimmed, nativeConsumer]);
  const cardResults = useMemo(() => {
    const seen = new Set<string>();
    const found = nativeConsumer
      ? cardSearch.cards.map((card) => ({ card, pokemon: { id: card.dexIds[0] ?? 0, name: card.name } }))
      : cardSearch.groups.flatMap((group) =>
          group.cards.map((card) => ({ card, pokemon: { id: group.dexId, name: group.name } })),
        );
    const unique = [...wantedMatches, ...found].filter(({ card }) => {
      const key = `${card.id}:${card.language ?? 'en'}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!getCardState) return unique.slice(0, 10).map((entry) => ({ ...entry, standing: null }));
    // Wanted printings lead, the rest keep the search's order (Show mode looks up more at once).
    const rank = { wanted: 0, missing: 1, owned: 1 } as const;
    return unique
      .map((entry, index) => ({ ...entry, standing: getCardStanding(getCardState(entry.card, entry.pokemon)), index }))
      .sort((a, b) => rank[a.standing] - rank[b.standing] || a.index - b.index)
      .slice(0, show ? 40 : 10);
  }, [show, cardSearch.groups, cardSearch.cards, nativeConsumer, getCardState, wantedMatches]);
  const priceLookups = useMemo(
    () =>
      formatPrice
        ? cardResults.map(({ card }) => ({
            cardId: card.id,
            language: nativeConsumer ? card.language : (card.language ?? 'en'),
          }))
        : [],
    [cardResults, formatPrice, nativeConsumer],
  );
  // Same array across keystrokes while the priced cards are unchanged (or the search is still loading).
  const stablePriceLookups = useStableCardPriceLookups(priceLookups, cardSearch.loading);
  const { pricesByCardId } = useRegionalCardPrices(
    stablePriceLookups,
    stablePriceLookups.length > 0,
    pricingRegion,
    Boolean(nativeConsumer),
  );
  // "% down" / "% up" reorder the found cards by price momentum (per card + language); Default keeps the search's order.
  const sortedCardResults = useMemo(
    () =>
      applyMomentumSort<(typeof cardResults)[number]>(cardResults, moveSort, ({ card }) =>
        nativeConsumer && !isCardLanguage(card.language)
          ? undefined
          : pricesByCardId[getCardPriceKey(card.id, card.language ?? 'en')],
      ),
    [cardResults, moveSort, pricesByCardId, nativeConsumer],
  );
  const illustrators = useIllustratorSearch(query, true).slice(0, 3);
  const setHits = useSetSearch(query, Boolean(onBrowseSet) && !show);

  const { rememberSearch, rememberCard: saveRecentCard } = history;
  const remember = useCallback(() => rememberSearch(trimmed), [rememberSearch, trimmed]);
  const rememberCard = useCallback(
    (card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish | null) => {
      if (!nativeConsumer || card.dexIds.length) saveRecentCard(toRecentCard(card, pokemon, undefined, finish));
    },
    [saveRecentCard, nativeConsumer],
  );

  const pickCard = useCallback(
    (card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish | null) => {
      remember();
      rememberCard(card, pokemon, finish);
      if (cardCheck) {
        setIsBundleOpen(false);
        setChecking({ card, pokemon, finish });
      } else if (nativeConsumer) nativeConsumer.openCard(card);
      else onSelectCard(card, pokemon);
    },
    [cardCheck, nativeConsumer, onSelectCard, remember, rememberCard],
  );

  // A sure match opens its deal check (Back shows the search it read); anything else is typed in for him.
  const focusSearchAfterScanRef = useRef(false);
  const handleScan = useCallback(
    (result: CardScanResult) => {
      setIsScannerOpen(false);
      setBrowsing(null);
      setIsBundleOpen(false);
      const { outcome } = result;
      if (outcome.query) {
        setQuery(outcome.query);
        if (outcome.kind === 'match') rememberSearch(outcome.query);
      }
      setScanNotice(scanNoticeFor(result));
      setScanChoices(result.pictureChoices ?? []);
      if (outcome.kind === 'match') {
        rememberCard(outcome.card, outcome.pokemon);
        setChecking({ card: outcome.card, pokemon: outcome.pokemon });
        return;
      }
      focusSearchAfterScanRef.current = true;
    },
    [rememberCard, rememberSearch],
  );

  // Focus the search once the scanner has unmounted, after its overlay has handed focus back.
  useEffect(() => {
    if (isScannerOpen || !focusSearchAfterScanRef.current) return;
    focusSearchAfterScanRef.current = false;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [isScannerOpen]);

  const go = useCallback(
    (destination: QuickDestinationId) => {
      remember();
      onNavigate(destination);
    },
    [onNavigate, remember],
  );

  const pickPokemon = useCallback(
    (pokemon: { id: number; name: string }) => {
      const summary = getPokemonSummary(pokemon.id);
      if (!summary) return;
      remember();
      if (show) {
        // Show mode stays in the finder: list this Pokémon's cards, wanted first.
        setBrowsing({ id: summary.id, name: summary.name });
        setQuery('');
        inputRef.current?.blur();
      } else onSelectPokemon(summary);
    },
    [show, onSelectPokemon, remember],
  );
  const wantedCount = useCallback(
    (pokemonId: number) => huntItems?.find((item) => item.pokemon_id === pokemonId)?.wanted_cards?.length ?? 0,
    [huntItems],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !trimmed) return;
    event.preventDefault();
    if (destinations[0] && pokemonResults.length === 0 && cardResults.length === 0) go(destinations[0].id);
    else if (pokemonResults[0]) pickPokemon(pokemonResults[0]);
    else if (cardResults[0]) pickCard(cardResults[0].card, cardResults[0].pokemon);
    else if (destinations[0]) go(destinations[0].id);
    else remember();
  };

  // A deal check or bundle is open. On wide screens in Show mode it sits beside the results instead of replacing them.
  const checkView =
    cardCheck && checking ? (
      <QuickCardCheck
        nativeConsumer={nativeConsumer}
        key={`${checking.card.id}:${checking.card.language ?? 'en'}:${checking.finish ?? 'default'}`}
        card={checking.card}
        pokemon={checking.pokemon}
        state={cardCheck.getCardState(checking.card, checking.pokemon)}
        getState={(finish) => cardCheck.getCardState(checking.card, checking.pokemon, finish)}
        destinationName={cardCheck.destinationName}
        budgetKey={nativeConsumer ? undefined : show?.budgetKey}
        savedDeal={checking.savedDeal}
        revisit={!nativeConsumer && show && cardCheck.revisitKey && !cardCheck.readOnly ? revisit : undefined}
        currency={cardCheck.currency}
        fxRates={cardCheck.fxRates}
        pricingRegion={pricingRegion}
        isOnline={isOnline}
        readOnly={cardCheck.readOnly}
        showTools={Boolean(show)}
        initialFinish={checking.finish}
        onBack={() => {
          setChecking(null);
          if (!browsing && trimmed)
            window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
        }}
        onOpenDetails={(finish) =>
          nativeConsumer
            ? nativeConsumer.openCard(checking.card)
            : onSelectCard(checking.card, checking.pokemon, finish)
        }
        onRemoveOwned={cardCheck.onRemoveOwned ? () => cardCheck.onRemoveOwned?.(checking.pokemon) : undefined}
        onChangeCard={
          cardCheck.onChangeCard
            ? (mode, finish) => cardCheck.onChangeCard?.(mode, checking.card, checking.pokemon, finish)
            : undefined
        }
        onAction={(action, finish) =>
          nativeConsumer ? Promise.resolve() : cardCheck.onAction(action, checking.card, checking.pokemon, finish)
        }
        isInBundle={(key) => !nativeConsumer && bundle.some((entry) => entry.key === key)}
        onAddToBundle={(entry) =>
          updateBundle((current) =>
            nativeConsumer
              ? [...current, { ...entry, key: crypto.randomUUID() }]
              : [...current.filter((item) => item.key !== entry.key), entry],
          )
        }
      />
    ) : null;
  const bundleView =
    show && isBundleOpen ? (
      <QuickBundle
        entries={bundle}
        nativeConsumer={nativeConsumer}
        budgetKey={nativeConsumer ? undefined : show.budgetKey}
        currency={show.currency}
        onBack={() => setIsBundleOpen(false)}
        onRemove={(key) => updateBundle(bundle.filter((entry) => entry.key !== key))}
        onClear={() => updateBundle([])}
        onSoldCheck={(key, soldCheck) =>
          updateBundle((current) => current.map((entry) => (entry.key === key ? { ...entry, soldCheck } : entry)))
        }
      />
    ) : null;
  const detailOpen = Boolean(checkView ?? bundleView);
  const wideWorkspace = Boolean(show) && isWide;
  const twoPane = wideWorkspace && detailOpen;
  // Desktop and tablet get a centred command palette with the search on top, phones keep the full-height thumb layout.
  const palette = isWide && !show;

  const nothingFound =
    Boolean(trimmed) &&
    !cardSearch.loading &&
    destinations.length === 0 &&
    pokemonResults.length === 0 &&
    cardResults.length === 0 &&
    illustrators.length === 0 &&
    setHits.length === 0;

  const searchControls = (
    <div
      className={
        palette
          ? 'mx-3 mb-2 shrink-0'
          : `holo-panel border-border/60 shrink-0 rounded-3xl border px-3 py-3 ${wideWorkspace ? 'mx-3 mb-3' : 'mx-3 mt-2 mb-[calc(var(--safe-bottom)+0.5rem)]'}`
      }
    >
      {show && bundle.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setChecking(null);
            setIsBundleOpen(true);
          }}
          className="border-primary/40 bg-primary/10 text-primary mb-2 flex h-14 w-full items-center gap-2 rounded-2xl border px-4 text-left text-sm font-semibold"
        >
          <Layers className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Bundle · {bundle.length} card{bundle.length === 1 ? '' : 's'}
            {!nativeConsumer && bundle.some((entry) => entry.marketPrice !== null)
              ? ` · market ${formatMoney(
                  bundle.reduce((sum, entry) => sum + (entry.marketPrice ?? 0), 0),
                  bundle[0].currency,
                )}`
              : ''}
          </span>
          <span className="shrink-0">Check bundle</span>
        </button>
      )}
      {scanNotice && (
        <p
          role="status"
          data-testid="scan-notice"
          className="mb-2 rounded-xl bg-amber-500/12 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300"
        >
          {scanNotice}
        </p>
      )}
      {scanChoices.length > 0 && (
        <div role="group" aria-label="Looks like" className="mb-2" data-testid="scan-picture-choices">
          <p className="text-muted-foreground mb-1 text-xs font-medium">Looks like</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {scanChoices.map((card) => (
              <button
                key={`${card.id}:${card.language ?? 'en'}`}
                type="button"
                aria-label={`${card.name}, ${card.set.name} ${formatCardNumber(card)}`}
                onClick={() => {
                  setScanChoices([]);
                  const dexId = card.dexIds[0];
                  pickCard(card, (dexId !== undefined ? lookupPokemon(dexId) : null) ?? { id: 0, name: card.name });
                }}
                className="trading-card bg-muted/50 relative w-14 shrink-0 overflow-hidden"
              >
                <CardThumbnail image={card.image} lazy />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search cards, Pokémon, sets and pages</span>
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            data-overlay-escape="clear"
            onChange={(event) => {
              setQuery(event.target.value);
              setBrowsing(null);
              setScanNotice(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={show ? 'Name or card number' : 'Card, Pokémon, artist or page'}
            className="border-border/70 bg-background placeholder:text-muted-foreground/80 focus:border-primary focus:ring-primary/30 h-14 w-full rounded-2xl border pr-4 pl-12 text-base font-medium outline-none focus:ring-2"
          />
        </label>
        {show && (
          <button
            type="button"
            onClick={() => {
              setScanNotice(null);
              setIsScannerOpen(true);
            }}
            aria-label="Scan a card"
            className="holo-action flex h-14 shrink-0 items-center gap-1.5 rounded-2xl px-3.5 text-sm font-semibold"
          >
            <Camera className="h-5 w-5" aria-hidden />
            Scan
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[55] bg-black/60 sm:backdrop-blur-sm" data-overlay-backdrop onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick mode"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        // While the phone's keyboard is up the dialog fits the visible part of the page (app/globals.css).
        data-keyboard-fit
        className={
          palette
            ? 'border-border/60 bg-background mx-auto mt-[12dvh] flex max-h-[min(40rem,76dvh)] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden rounded-[28px] border pt-3 pb-1 shadow-2xl shadow-black/40'
            : `mx-auto flex h-[100dvh] w-full ${wideWorkspace ? 'max-w-6xl' : 'max-w-xl'} bg-background sm:border-border/60 flex-col pt-[var(--top-inset)] sm:border-x`
        }
      >
        <header
          data-sheet-grabber
          {...prepSwipe}
          className={`flex shrink-0 items-center gap-2 ${palette ? 'mx-3 mb-2 pl-2' : 'holo-panel border-border/60 mx-3 mb-3 rounded-3xl border px-3 py-2'}`}
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-tight font-bold">
              {preparingOffline ? 'Prepare offline' : lookupOnly ? 'Price check' : show ? 'Show mode' : 'Quick mode'}
            </h2>
          </div>
          {show && !nativeConsumer && (
            <button
              type="button"
              onClick={() => setPreparingOffline((value) => !value)}
              className="bg-muted min-h-10 shrink-0 rounded-full px-3 text-xs font-semibold"
            >
              {preparingOffline ? 'Back' : 'Prepare offline'}
            </button>
          )}
          {!isOnline && (
            <span
              role="status"
              className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400"
            >
              <WifiOff className="h-3.5 w-3.5" aria-hidden /> Offline
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick mode"
            className="bg-muted/70 text-foreground hover:bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {preparingOffline ? (
          <ShowOfflinePrep binder={offlineBinder} items={huntItems ?? []} isOnline={isOnline} />
        ) : detailOpen && !twoPane ? (
          (checkView ?? bundleView)
        ) : (
          // Keep the finder mounted when detail opens so filters and scroll position survive selection.
          <div
            className={
              wideWorkspace
                ? `grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] ${twoPane ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-1'}`
                : 'contents'
            }
          >
            <div
              className={
                wideWorkspace
                  ? `flex min-h-0 min-w-0 flex-col ${twoPane ? 'border-border/50 border-r' : ''}`
                  : 'contents'
              }
            >
              {(wideWorkspace || palette) && searchControls}
              {show && !trimmed && browsing ? (
                <ShowPokemonCards
                  key={browsing.id}
                  pokemon={browsing}
                  wantedCards={huntItems?.find((item) => item.pokemon_id === browsing.id)?.wanted_cards ?? []}
                  getCardState={getCardState!}
                  getOfflineCards={getOfflineCards}
                  currency={show.currency}
                  fxRates={show.fxRates}
                  pricingRegion={pricingRegion}
                  isOnline={isOnline}
                  onBack={() => setBrowsing(null)}
                  onPickCard={(card, finish) => pickCard(card, browsing, finish)}
                />
              ) : show && !trimmed ? (
                <ShowHunt
                  nativeConsumer={
                    nativeConsumer && show?.readOnly ? { ...nativeConsumer, editingAvailable: false } : nativeConsumer
                  }
                  recentCards={
                    <>
                      {show.budgetKey && !show.readOnly && (
                        <ShowBudget storageKey={show.budgetKey} currency={show.currency} />
                      )}
                      <ShowRevisit
                        cards={revisit.cards}
                        error={revisit.error}
                        onRemove={(entry) => {
                          revisit.remove(entry);
                        }}
                        onOpen={(entry) => {
                          setChecking({
                            card: recentToSearchCard(entry.card),
                            pokemon: { id: entry.card.dexId, name: entry.card.pokemonName },
                            finish: entry.card.finish,
                            savedDeal: entry,
                          });
                        }}
                      />
                      {history.status && (
                        <p role="status" className="text-muted-foreground py-1 text-xs">
                          {history.status}
                        </p>
                      )}
                      <RecentSearches
                        history={history}
                        onSearch={(value) => {
                          setQuery(value);
                          inputRef.current?.focus({ preventScroll: true });
                        }}
                      />
                      <ShowRecentCards
                        cards={history.cards}
                        shared={history.shared}
                        getCardState={getCardState!}
                        onPickCard={pickCard}
                        onClear={() => history.clear('card')}
                      />
                    </>
                  }
                  items={huntItems ?? []}
                  currency={show.currency}
                  fxRates={show.fxRates}
                  pricingRegion={pricingRegion}
                  isOnline={isOnline}
                  // Stable callbacks so the memoised Hunting list skips re-rendering while Quick mode updates.
                  onPickCard={pickCard}
                  onPickPokemon={pickPokemon}
                />
              ) : (
                /* Results grow upwards from the search field so the best match sits nearest the thumb. */
                <div
                  className={`flex min-h-0 flex-1 ${wideWorkspace || palette ? 'flex-col' : 'flex-col-reverse'} overflow-y-auto overscroll-contain px-2 pb-2`}
                  data-testid="quick-results"
                >
                  <div>
                    {!trimmed && (
                      <>
                        {history.status && (
                          <p role="status" className="text-muted-foreground py-1 text-xs">
                            {history.status}
                          </p>
                        )}
                        <RecentSearches
                          history={history}
                          onSearch={(value) => {
                            setQuery(value);
                            inputRef.current?.focus({ preventScroll: true });
                          }}
                        />
                        {getCardState && (
                          <ShowRecentCards
                            cards={history.cards}
                            shared={history.shared}
                            getCardState={getCardState}
                            onPickCard={pickCard}
                            onClear={() => history.clear('card')}
                          />
                        )}
                      </>
                    )}

                    {setHits.length > 0 && (
                      <section aria-label="Sets">
                        <h3 className={sectionTitle}>Sets</h3>
                        {setHits.map((set) => {
                          const meta = formatSetHitMeta(set);
                          return (
                            <button
                              key={set.id}
                              type="button"
                              className={rowClass}
                              aria-label={`Open set ${set.name}${meta ? `, ${meta}` : ''}`}
                              onClick={() => {
                                remember();
                                onBrowseSet?.(set);
                              }}
                            >
                              <SetSymbol set={set} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold">{set.name}</span>
                                {meta ? (
                                  <span className="text-muted-foreground block truncate text-xs">{meta}</span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </section>
                    )}

                    {illustrators.length > 0 && (
                      <section aria-label="Illustrators">
                        <h3 className={sectionTitle}>Illustrators</h3>
                        {illustrators.map((illustrator) => (
                          <button
                            key={illustrator.name}
                            type="button"
                            className={show ? `${rowClass} border-border/50 bg-card min-h-20 border` : rowClass}
                            onClick={() => {
                              remember();
                              // Show mode stays in the lookup: list the illustrator's cards here, ready to price.
                              if (show) setQuery(illustrator.name);
                              else onBrowseIllustrator(illustrator.name);
                            }}
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500">
                              <Palette className="h-5 w-5" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-semibold">{illustrator.name}</span>
                              <span className="text-muted-foreground block text-xs">{illustrator.cardCount} cards</span>
                            </span>
                          </button>
                        ))}
                      </section>
                    )}

                    {(cardResults.length > 0 || (trimmed.length >= 2 && cardSearch.loading)) && (
                      <section aria-label="Cards">
                        <h3 className={sectionTitle}>
                          {show ? 'Any card · tap to check the price' : 'Cards'}
                          {cardSearch.offline ? ' · on this device' : ''}
                          {cardSearch.loading && (
                            <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" aria-label="Searching cards" />
                          )}
                        </h3>
                        {cardSearch.correction ? (
                          <p role="status" className="text-muted-foreground px-1 py-1 text-xs">
                            Showing cards for {cardSearch.correction}
                          </p>
                        ) : null}
                        {formatPrice && cardResults.length > 1 && (
                          <MomentumSortChips value={moveSort} onChange={setMoveSort} className="mb-1.5" />
                        )}
                        {sortedCardResults.map(({ card, pokemon, standing }) => {
                          const priceSnapshot =
                            nativeConsumer && !isCardLanguage(card.language)
                              ? undefined
                              : pricesByCardId[getCardPriceKey(card.id, card.language ?? 'en')];
                          const priceLabel = formatPrice?.(priceSnapshot) ?? null;
                          // Outside Show mode only Owned / Wanted are stamped; "Not in binder" on every other row is noise.
                          const shownStanding = standing && (show || standing !== 'missing') ? standing : null;
                          const state = nativeConsumer
                            ? {
                                ...STANDING_BADGES[shownStanding ?? 'missing'],
                                label: nativeCardLabel(nativeCardState(nativeModel, card)),
                              }
                            : shownStanding
                              ? STANDING_BADGES[shownStanding]
                              : standing
                                ? null
                                : (getPokemonState?.(pokemon.id) ?? null);
                          return (
                            <button
                              key={`${card.id}:${card.language ?? 'en'}`}
                              type="button"
                              className={show ? `${rowClass} border-border/50 bg-card min-h-20 border` : rowClass}
                              data-standing={standing ?? undefined}
                              aria-label={`${card.name}, ${card.set.name} ${formatCardNumber(card)}${nativeConsumer ? `, ${nativeCardLabel(nativeCardState(nativeModel, card))}` : shownStanding ? `, ${STANDING_BADGES[shownStanding].label}` : ''}${priceLabel ? `, ${priceLabel}` : ''}`}
                              onClick={() => pickCard(card, pokemon)}
                            >
                              <span className="trading-card bg-muted/50 relative w-10 shrink-0 overflow-hidden">
                                <CardThumbnail image={card.image} lazy />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold">{card.name}</span>
                                <span className="text-muted-foreground block truncate text-xs">
                                  {card.set.name} · {formatCardNumber(card)}
                                  {show && card.illustrator ? ` · ${card.illustrator}` : ''}
                                </span>
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-0.5">
                                {priceLabel ? (
                                  <span className="text-sm font-bold tabular-nums">{priceLabel}</span>
                                ) : show && !isOnline ? (
                                  <span className="text-muted-foreground text-[11px]">No price offline</span>
                                ) : null}
                                {priceLabel && <PriceRisingBadge price={priceSnapshot} />}
                                {state && (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.toneClass}`}
                                  >
                                    {state.label}
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </section>
                    )}

                    {!show && pokemonResults.length > 0 && (
                      <section aria-label="Pokémon">
                        <h3 className={sectionTitle}>Pokémon</h3>
                        {pokemonResults.map((pokemon) => {
                          const state = getPokemonState?.(pokemon.id) ?? null;
                          return (
                            <button
                              key={pokemon.id}
                              type="button"
                              className={rowClass}
                              onClick={() => pickPokemon(pokemon)}
                            >
                              <span className="text-muted-foreground w-12 shrink-0 text-xs font-semibold tabular-nums">
                                #{String(pokemon.id).padStart(4, '0')}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                                {formatPokemonDisplayName(pokemon.name)}
                              </span>
                              {state && (
                                <span
                                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${state.toneClass}`}
                                >
                                  {state.label}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </section>
                    )}

                    {destinations.length > 0 && (
                      <section aria-label="Go to">
                        <h3 className={sectionTitle}>Go to</h3>
                        <div className={trimmed ? '' : `grid ${palette ? 'grid-cols-3' : 'grid-cols-2'} gap-2 px-1`}>
                          {destinations.map((destination) => {
                            const Icon = DESTINATION_ICONS[destination.id];
                            return (
                              <button
                                key={destination.id}
                                type="button"
                                onClick={() => go(destination.id)}
                                className={
                                  trimmed
                                    ? rowClass
                                    : 'border-border/60 bg-card active:bg-muted flex min-h-16 items-center gap-2.5 rounded-2xl border px-3 text-left'
                                }
                              >
                                <span className="bg-primary/12 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                                  <Icon className="h-5 w-5" aria-hidden />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-[15px] font-semibold">{destination.label}</span>
                                  <span className="text-muted-foreground block truncate text-[11px]">
                                    {destination.hint}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {show && pokemonResults.length > 0 && (
                      <section aria-label="Pokémon">
                        <h3 className={sectionTitle}>Pokémon · tap to see their cards</h3>
                        {pokemonResults.map((pokemon) => {
                          const wanted = wantedCount(pokemon.id);
                          const state = getPokemonState?.(pokemon.id) ?? null;
                          return (
                            <button
                              key={pokemon.id}
                              type="button"
                              className={`${rowClass} min-h-16`}
                              onClick={() => pickPokemon(pokemon)}
                            >
                              <PokemonSprite id={pokemon.id} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-base font-bold">
                                  {formatPokemonDisplayName(pokemon.name)}
                                </span>
                                <span className="text-muted-foreground block text-xs tabular-nums">
                                  #{String(pokemon.id).padStart(4, '0')}
                                </span>
                              </span>
                              {wanted > 0 ? (
                                <span className="shrink-0 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
                                  {wanted} wanted
                                </span>
                              ) : state ? (
                                <span
                                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${state.toneClass}`}
                                >
                                  {state.label}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </section>
                    )}

                    {nothingFound && (
                      <p role="status" className="text-muted-foreground px-3 py-6 text-center text-sm">
                        Nothing found for “{trimmed}”.
                        {!isOnline ? ' Offline, only cards saved on this device can be found.' : ''}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!wideWorkspace && !palette && searchControls}
            </div>
            {twoPane && (
              <div className="flex min-h-0 min-w-0 flex-col" data-testid="show-detail-pane">
                {checkView ?? bundleView}
              </div>
            )}
          </div>
        )}
        {isScannerOpen && (
          <QuickCardScanner
            onClose={() => setIsScannerOpen(false)}
            onResult={handleScan}
            isOnline={isOnline}
            getOfflineCards={getOfflineCards}
          />
        )}
      </div>
    </div>
  );
}

// Memoised: the Binder app re-renders often (prices, sync status); with stable props Quick mode, its results
// and the deal check beside them skip those renders.
export default memo(QuickMode);
