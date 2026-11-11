'use client';

import { BinderCreationPresets } from '@/components/binder-creation-presets';
import type { BinderCreationDraft } from '@/lib/binder-creation-draft';
import { toCardImageSrc } from '@/lib/card-image-url';
import { catalogCardIds, deduplicateCatalogCards, matchesCatalogCardId } from '@/lib/card-catalog';

import NextImage from 'next/image';
import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { Check, Heart, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCardPriceKey, type CardPriceSnapshot } from '@/hooks/use-card-prices';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import { DEFAULT_PRICING_REGION, type PricingRegion } from '@/lib/pricing-region';
import { CardHighlights } from '@/components/card-highlights';
import type { CollectedPokemon } from '@/lib/domain/cards';
import type { TCGSetDexSlot, TCGSetSlotCard, TCGSetSlotsResponse, TCGSetSummary } from '@/lib/tcg-set-slots';
import { getOfflineStore } from '@/lib/offline-store/kv';
import { loadSetQuery, saveSetQuery } from '@/lib/offline-store/records';
import { getProxiedThumbnailUrl } from '@/lib/card-show-prep';
import { readOfflineSets, searchOfflineSets } from '@/lib/offline-card-index';
import { useCollapseOnScroll } from '@/hooks/use-collapse-on-scroll';
import { getSetCompletion } from '@/lib/set-completion';
import { filterSetGroups, getSetMonogram, publicSetArtworkUrl, listSetSeries } from '@/lib/set-browse';
import {
  getSetSlotState,
  getSetCardState,
  hasWantedSetCard,
  getSetChecklistCards,
  mergeSetSlots,
  matchesSetSlotFilter,
  type SetSlotFilter,
} from '@/lib/set-checklist';
import { POKEMON_CATALOG, formatPokemonDisplayName, formatDexNumber } from '@/lib/pokemon-catalog';
import { formatCardNumber, getCardVariantLabels } from '@/lib/pokemon-card-browse';

interface SetPopulationViewProps {
  /** Opt-in internal draft integration only; production callers omit it until #379. */
  stagedCreation?: { ownerUserId: string; onDraft: (draft: BinderCreationDraft) => void; isOnline: boolean };
  pricingEnabled?: boolean;
  collectionByPokemonId: Map<number, CollectedPokemon>;
  /** Every copy and want as its own row, for printing-level state; defaults to the species map. */
  collectionRows?: readonly CollectedPokemon[];
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null;
  /** The user's pricing region; set card prices are weighted for it. */
  pricingRegion?: PricingRegion;
  onSelectSlot: (slot: TCGSetDexSlot) => void;
  onBrowseCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => void;
  onCollectCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => void | Promise<void>;
  onWantCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => void | Promise<void>;
  onCollectCards?: (cards: Array<{ slot: TCGSetDexSlot; card: TCGSetSlotCard }>) => void | Promise<void>;
  onWantCards?: (cards: Array<{ slot: TCGSetDexSlot; card: TCGSetSlotCard }>) => void | Promise<void>;
  readOnly: boolean;
  /** Opens with this set already picked (a set hit tapped in the Search sheet or Quick mode). */
  initialSet?: TCGSetSummary | null;
}

const SET_SLOT_FILTERS: Array<{ id: SetSlotFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'owned', label: 'Owned' },
  { id: 'wanted', label: 'Wanted' },
  { id: 'multiple', label: 'Variants' },
];

/** Logo, else symbol, else a monogram; an image that fails to load (offline, missing asset) falls through. */
function SetArtwork({ set }: { set: TCGSetSummary }) {
  const sources = [
    { src: publicSetArtworkUrl(set.logo), kind: 'logo' },
    { src: publicSetArtworkUrl(set.symbol), kind: 'symbol' },
  ].filter((source): source is { src: string; kind: string } => Boolean(source.src));
  const [failed, setFailed] = useState(0);
  const source = sources[failed];
  return (
    <span className="flex h-12 w-full items-center justify-center">
      {source ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={source.src}
          src={source.src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed((count) => count + 1)}
          className={
            source.kind === 'logo'
              ? 'max-h-full max-w-full object-contain'
              : 'h-11 w-11 rounded-xl bg-white/90 object-contain p-1.5'
          }
        />
      ) : (
        <span className="holo-selected text-primary flex h-11 min-w-11 items-center justify-center rounded-xl px-2 text-xs font-bold tracking-wide">
          {getSetMonogram(set)}
        </span>
      )}
    </span>
  );
}

/** Offline, a card image that was never loaded falls back to its saved thumbnail (via the image proxy). */
/** Offline, the full-size image may not be saved; fall back once to the saved low-res thumbnail. */
function savedThumbnailOnError(image: string | undefined) {
  return (event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    const fallback = getProxiedThumbnailUrl(image);
    if (!fallback || element.dataset.savedThumbnail === '1') return;
    element.dataset.savedThumbnail = '1';
    element.src = fallback;
  };
}

function formatSetMeta(set: TCGSetSummary) {
  return [set.seriesName, set.officialCardCount ? `${set.officialCardCount} cards` : null, set.releaseDate]
    .filter(Boolean)
    .join(' · ');
}

function getSelectedSetCard(slot: TCGSetDexSlot, selectedCardIdsByDexId: Record<number, string>) {
  return slot.cards.find((card) => matchesCatalogCardId(card, selectedCardIdsByDexId[slot.dexId])) ?? slot.cards[0];
}

export default function SetPopulationView({
  pricingEnabled = true,
  collectionByPokemonId,
  collectionRows,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
  onSelectSlot,
  onBrowseCard,
  onCollectCard,
  onWantCard,
  onCollectCards,
  onWantCards,
  readOnly,
  initialSet = null,
  stagedCreation,
}: SetPopulationViewProps) {
  const [presetSet, setPresetSet] = useState<TCGSetSummary | null>(null);
  const [query, setQuery] = useState('');
  const heading = useCollapseOnScroll();
  const [selectedSets, setSelectedSets] = useState<TCGSetSummary[]>(() => (initialSet ? [initialSet] : []));
  const [payloadsBySetId, setPayloadsBySetId] = useState<Record<string, TCGSetSlotsResponse>>({});
  const [pokemonQuery, setPokemonQuery] = useState('');
  const [matchedPokemonIds, setMatchedPokemonIds] = useState<number[]>([]);
  const [sets, setSets] = useState<TCGSetSummary[]>([]);
  const payloads = useMemo(
    () => selectedSets.flatMap((set) => (payloadsBySetId[set.id] ? [payloadsBySetId[set.id]] : [])),
    [selectedSets, payloadsBySetId],
  );
  const slots = useMemo(() => mergeSetSlots(payloads.map((payload) => payload.slots)), [payloads]);
  const setCards = useMemo(() => deduplicateCatalogCards(payloads.flatMap(getSetChecklistCards)), [payloads]);
  const selectedSet = selectedSets[0] ?? null;
  const setLabel = selectedSets.map((set) => set.name).join(' + ');
  const hasFullCardList = payloads.every((payload) => Array.isArray(payload.cards));
  const [isLoading, setIsLoading] = useState(Boolean(initialSet));
  const [error, setError] = useState<string | null>(null);
  const [slotSearch, setSlotSearch] = useState('');
  const [checklistView, setChecklistView] = useState<'pokemon' | 'cards'>('pokemon');
  const [slotFilter, setSlotFilter] = useState<SetSlotFilter>('all');
  const [selectedCardIdsByDexId, setSelectedCardIdsByDexId] = useState<Record<number, string>>({});
  const [selectedDexIds, setSelectedDexIds] = useState<Set<number>>(() => new Set());
  const [allSets, setAllSets] = useState<TCGSetSummary[]>([]);
  const [allSetsState, setAllSetsState] = useState<'loading' | 'live' | 'saved' | 'failed'>('loading');
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const isBrowsing = !selectedSet && allSets.length > 0;
  const priceLookups = useMemo(
    () => setCards.map((card) => ({ cardId: card.id, language: card.language })),
    [setCards],
  );
  const setPrices = useRegionalCardPrices(
    priceLookups,
    pricingEnabled && Boolean(selectedSet) && !isLoading,
    pricingRegion,
  );
  const highlightCards = useMemo(
    () =>
      setCards.map((card) => ({
        id: card.id,
        language: card.language,
        name: card.name,
        numberLabel: `${card.localId}/${card.set.officialCardCount ?? '?'}`,
        setName: card.set.name,
        image: card.image,
        rarity: card.rarity,
      })),
    [setCards],
  );

  const [isShowingSavedSets, setIsShowingSavedSets] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const offlineStore = getOfflineStore();
    void fetch('/app/api/tcg-set-slots?all=1', { signal: controller.signal })
      .then(async (response) => {
        const payload = response.ok ? ((await response.json().catch(() => null)) as TCGSetSlotsResponse | null) : null;
        if (!payload || !Array.isArray(payload.sets)) throw new Error('Set list unavailable');
        setAllSets(payload.sets);
        setAllSetsState('live');
        if (offlineStore) void saveSetQuery(offlineStore, 'all=1', payload).catch(() => undefined);
      })
      .catch(async () => {
        if (controller.signal.aborted) return;
        // Offline: the last saved list, else whatever sets this device has saved data for.
        const saved = offlineStore ? await loadSetQuery(offlineStore, 'all=1').catch(() => null) : null;
        const fallback = saved?.sets.length ? saved.sets : await readOfflineSets().catch(() => []);
        if (controller.signal.aborted) return;
        setAllSets([...new Map(fallback.map((set) => [set.id, set])).values()]);
        setAllSetsState(fallback.length ? 'saved' : 'failed');
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();
    // With no set open, the browse grid filters the full list on the device instead.
    if (trimmedQuery.length < 2 || isBrowsing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const queryString = new URLSearchParams({ query: trimmedQuery }).toString();
      try {
        const response = await fetch(`/app/api/tcg-set-slots?${queryString}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Set search failed (${response.status})`);
        const payload = (await response.json()) as TCGSetSlotsResponse;
        if (!controller.signal.aborted) setSets(payload.sets);
      } catch {
        if (controller.signal.aborted) return;
        const savedSets = searchOfflineSets([...allSets, ...(await readOfflineSets().catch(() => []))], trimmedQuery);
        if (!controller.signal.aborted) {
          setSets(savedSets);
          setIsShowingSavedSets(savedSets.length > 0);
          if (!savedSets.length) setError('Could not search sets. Try a saved set or reconnect.');
        }
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, allSets, isBrowsing]);

  useEffect(() => {
    const controller = new AbortController();
    const missing = selectedSets.filter((set) => !payloadsBySetId[set.id]);
    if (!missing.length) return () => controller.abort();

    const offlineStore = getOfflineStore();
    void Promise.all(
      missing.map(async (set) => {
        const queryString = new URLSearchParams({ query: set.name, setId: set.id }).toString();
        let payload: TCGSetSlotsResponse;
        try {
          const response = await fetch(`/app/api/tcg-set-slots?${queryString}`, { signal: controller.signal });
          const data = await response.json();
          if (!response.ok || !data.selectedSet) throw new Error(data.error || `Could not load ${set.name}`);
          payload = data;
          if (offlineStore) void saveSetQuery(offlineStore, queryString, payload).catch(() => undefined);
        } catch {
          if (controller.signal.aborted) return;
          const saved = offlineStore ? await loadSetQuery(offlineStore, queryString).catch(() => null) : null;
          if (controller.signal.aborted) return;
          if (!saved) {
            setError(`Could not load ${set.name}. Remove and add it to retry.`);
            return;
          }
          payload = saved;
          setIsShowingSavedSets(true);
        }
        if (!controller.signal.aborted) setPayloadsBySetId((current) => ({ ...current, [set.id]: payload }));
      }),
    ).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
    // Payload updates must not abort other sets still loading in this batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSets]);

  useEffect(() => {
    const validDexIds = new Set(slots.map((slot) => slot.dexId));
    const validCardIdsByDexId = new Map(slots.map((slot) => [slot.dexId, new Set(slot.cards.flatMap(catalogCardIds))]));

    setSelectedCardIdsByDexId((current) => {
      const next: Record<number, string> = {};

      for (const [dexIdValue, cardId] of Object.entries(current)) {
        const dexId = Number(dexIdValue);
        if (validCardIdsByDexId.get(dexId)?.has(cardId)) {
          next[dexId] = cardId;
        }
      }

      return next;
    });

    setSelectedDexIds((current) => {
      const next = new Set<number>();
      for (const dexId of current) {
        if (validDexIds.has(dexId)) {
          next.add(dexId);
        }
      }
      return next;
    });
  }, [slots]);

  const setCompletions = useMemo(
    () =>
      selectedSets.flatMap((set) =>
        payloadsBySetId[set.id]
          ? [{ set, ...getSetCompletion(payloadsBySetId[set.id], collectionRows ?? collectionByPokemonId.values()) }]
          : [],
      ),
    [collectionByPokemonId, collectionRows, payloadsBySetId, selectedSets],
  );

  const matchedSlots = useMemo(
    () => (matchedPokemonIds.length ? slots.filter((slot) => matchedPokemonIds.includes(slot.dexId)) : slots),
    [matchedPokemonIds, slots],
  );

  const summary = useMemo(() => {
    let owned = 0;
    let wanted = 0;

    for (const slot of matchedSlots) {
      if (matchesSetSlotFilter(slot, collectionByPokemonId.get(slot.dexId), 'owned')) owned += 1;
      if (matchesSetSlotFilter(slot, collectionByPokemonId.get(slot.dexId), 'wanted')) wanted += 1;
    }

    return {
      total: matchedSlots.length,
      owned,
      wanted,
      missing: Math.max(0, matchedSlots.length - owned),
    };
  }, [collectionByPokemonId, matchedSlots]);

  const filterCounts = useMemo(() => {
    const counts: Record<SetSlotFilter, number> = {
      all: matchedSlots.length,
      open: 0,
      owned: 0,
      wanted: 0,
      multiple: 0,
    };

    for (const slot of matchedSlots) {
      const item = collectionByPokemonId.get(slot.dexId);
      for (const filter of SET_SLOT_FILTERS) {
        if (filter.id !== 'all' && matchesSetSlotFilter(slot, item, filter.id)) counts[filter.id] += 1;
      }
    }

    return counts;
  }, [collectionByPokemonId, matchedSlots]);

  const filteredSlots = useMemo(() => {
    const normalizedSearch = slotSearch.trim().toLowerCase();

    return matchedSlots.filter((slot) => {
      const item = collectionByPokemonId.get(slot.dexId);
      if (!matchesSetSlotFilter(slot, item, slotFilter)) return false;
      if (!normalizedSearch) return true;

      const haystack = [
        slot.pokemonName,
        String(slot.dexId),
        `#${slot.dexId}`,
        ...slot.cards.map((card) => `${card.name} ${card.localId} ${card.rarity ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [collectionByPokemonId, slotFilter, slotSearch, matchedSlots]);

  const matchingCards = useMemo(
    () =>
      matchedPokemonIds.length
        ? setCards.filter((card) =>
            slots.some(
              (slot) =>
                matchedPokemonIds.includes(slot.dexId) && slot.cards.some((candidate) => candidate.id === card.id),
            ),
          )
        : setCards,
    [matchedPokemonIds, setCards, slots],
  );
  const cardEntries = useMemo(
    () =>
      matchingCards.map((card) => ({
        card,
        ...getSetCardState(card, collectionRows ?? collectionByPokemonId.values()),
      })),
    [matchingCards, collectionByPokemonId, collectionRows],
  );
  const cardCounts = {
    all: cardEntries.length,
    open: cardEntries.filter((entry) => !entry.owned).length,
    owned: cardEntries.filter((entry) => entry.owned).length,
    wanted: cardEntries.filter((entry) => entry.wanted && !entry.owned).length,
    multiple: 0,
  };
  const cardSummary = {
    total: cardCounts.all,
    owned: cardCounts.owned,
    missing: cardCounts.open,
    wanted: cardCounts.wanted,
  };
  const visibleCards = cardEntries.filter((entry) => {
    if (
      (slotFilter === 'open' && entry.owned) ||
      (slotFilter === 'owned' && !entry.owned) ||
      (slotFilter === 'wanted' && (!entry.wanted || entry.owned))
    )
      return false;
    const needle = slotSearch.trim().toLowerCase();
    return (
      !needle ||
      [entry.card.name, entry.card.localId, entry.card.rarity ?? ''].some((value) =>
        value.toLowerCase().includes(needle),
      )
    );
  });
  const visibleSummary = checklistView === 'cards' ? cardSummary : summary;

  const selectedBulkCards = useMemo(
    () =>
      filteredSlots
        .filter((slot) => selectedDexIds.has(slot.dexId))
        .map((slot) => ({ slot, card: getSelectedSetCard(slot, selectedCardIdsByDexId) }))
        .filter((entry): entry is { slot: TCGSetDexSlot; card: TCGSetSlotCard } => Boolean(entry.card)),
    [filteredSlots, selectedCardIdsByDexId, selectedDexIds],
  );

  const seriesOptions = useMemo(() => listSetSeries(allSets), [allSets]);
  const browseGroups = useMemo(
    () => (isBrowsing ? filterSetGroups(allSets, { series: seriesFilter, query }) : []),
    [allSets, isBrowsing, query, seriesFilter],
  );

  const addSet = (set: TCGSetSummary) => {
    setError(null);
    setIsLoading([...selectedSets, set].some((selected) => !payloadsBySetId[selected.id]));
    setSelectedSets((current) => (current.some((selected) => selected.id === set.id) ? current : [...current, set]));
    setQuery('');
    setSets([]);
  };
  const pokemonSuggestions = pokemonQuery.trim()
    ? POKEMON_CATALOG.filter(
        (pokemon) =>
          !matchedPokemonIds.includes(pokemon.id) &&
          (formatPokemonDisplayName(pokemon.name).toLowerCase().includes(pokemonQuery.trim().toLowerCase()) ||
            String(pokemon.id) === pokemonQuery.trim().replace(/^#0*/, '')),
      ).slice(0, 8)
    : [];

  const toggleSelectedDexId = (dexId: number) => {
    setSelectedDexIds((current) => {
      const next = new Set(current);
      if (next.has(dexId)) {
        next.delete(dexId);
      } else {
        next.add(dexId);
      }
      return next;
    });
  };

  return (
    <section
      data-testid="view-scroller"
      onScroll={heading.onScroll}
      className="border-border/60 bg-card/88 dark:bg-card/70 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-[1.6rem] border shadow-[0_24px_70px_-44px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10"
    >
      <div className="border-border/45 shrink-0 border-b p-4">
        <div
          data-testid="view-heading"
          data-collapsed={heading.collapsed ? '' : undefined}
          className={`flex items-start justify-between gap-3 ${heading.collapsed ? 'max-sm:hidden' : ''}`}
        >
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">Sets</h2>
          </div>
          {selectedSet ? (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{summary.total} slots</span>
          ) : null}
        </div>

        <div
          className={`border-border/55 bg-background/58 dark:bg-background/35 flex items-center gap-2 rounded-2xl border px-3 py-2 dark:border-white/10 ${heading.collapsed ? 'mt-4 max-sm:mt-0' : 'mt-4'}`}
        >
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSets([]);
              setError(null);
            }}
            placeholder={selectedSet ? 'Add another set by name, code or year' : 'Find a set by name, code or year'}
            aria-label="Search sets by name, code or year"
            enterKeyHint="search"
            className="placeholder:text-muted-foreground/70 -my-2 min-w-0 flex-1 bg-transparent py-2 text-base outline-none md:text-sm"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSets([]);
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground -my-1 flex h-9 w-9 items-center justify-center rounded-full p-2"
              aria-label="Clear set search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {isLoading ? <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> : null}
        </div>

        {isShowingSavedSets ? (
          <p className="text-muted-foreground mt-2 text-[11px]">Showing saved set data on this device.</p>
        ) : null}

        {isBrowsing ? (
          <div
            role="group"
            aria-label="Filter sets by series"
            className="scrollbar-hide -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1"
          >
            {[{ series: null, count: allSets.length }, ...seriesOptions].map(({ series, count }) => {
              const isActive = seriesFilter === series;
              return (
                <button
                  key={series ?? 'all'}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSeriesFilter(series)}
                  className={`min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold whitespace-nowrap transition-colors ${isActive ? 'holo-selected text-primary border-transparent' : 'border-border/55 bg-background/45 text-muted-foreground hover:text-foreground dark:border-white/10'}`}
                >
                  {series ?? 'All series'} <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {!isBrowsing && sets.length > 0 ? (
          <div className="scrollbar-hide mt-3 flex gap-2 overflow-x-auto pb-1">
            {sets.map((set) => {
              const isActive = selectedSets.some((selected) => selected.id === set.id);

              return (
                <button
                  key={set.id}
                  type="button"
                  aria-label={set.name}
                  aria-pressed={isActive}
                  onClick={() => {
                    addSet(set);
                  }}
                  className={`w-[min(14rem,72vw)] shrink-0 rounded-2xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-primary/35 bg-primary/12 text-foreground'
                      : 'border-border/55 bg-background/45 text-muted-foreground hover:text-foreground dark:border-white/10'
                  }`}
                >
                  <p className="truncate text-sm font-semibold">{set.name}</p>
                  <p className="mt-0.5 truncate text-[11px]">{formatSetMeta(set) || set.id}</p>
                </button>
              );
            })}
          </div>
        ) : null}

        {selectedSets.length > 0 ? (
          <div className="mt-3 space-y-3">
            <div role="group" aria-label="Selected sets" className="flex flex-wrap gap-1.5">
              {selectedSets.map((set) => (
                <button
                  key={set.id}
                  type="button"
                  aria-label={`Remove ${set.name}`}
                  onClick={() => {
                    setIsLoading(
                      selectedSets.some((selected) => selected.id !== set.id && !payloadsBySetId[selected.id]),
                    );
                    setError(null);
                    setSelectedSets((current) => current.filter((selected) => selected.id !== set.id));
                  }}
                  className="border-primary/35 bg-primary/10 inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-semibold"
                >
                  <span className="truncate">{set.name}</span>
                  <X className="h-3.5 w-3.5 shrink-0" />
                </button>
              ))}
              <button
                type="button"
                aria-label="Clear all matches"
                onClick={() => {
                  setIsLoading(false);
                  setError(null);
                  setSelectedSets([]);
                  setMatchedPokemonIds([]);
                  setPokemonQuery('');
                  setSlotSearch('');
                  setSlotFilter('all');
                  setQuery('');
                }}
                className="text-muted-foreground min-h-9 px-2 text-xs"
              >
                Clear all
              </button>
            </div>
            {setCompletions.length > 0 ? (
              <ul aria-label="Set completion" className="space-y-1.5">
                {setCompletions.map(({ set, owned, total, percent, complete, hasFullCardList }) => (
                  <li
                    key={set.id}
                    className="border-border/45 bg-background/45 rounded-2xl border px-3 py-2 dark:border-white/10"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-semibold">{set.name}</span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {owned}/{total} {hasFullCardList ? 'cards' : 'Pokémon cards'} · {percent}%
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${set.name} completion`}
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-valuenow={owned}
                      aria-valuetext={`${owned} of ${total} cards owned`}
                      className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full dark:bg-white/10"
                    >
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${complete ? 'bg-emerald-500' : 'bg-primary'}`}
                        style={{ width: `${total > 0 ? (owned / total) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <label className="border-border/55 bg-background/45 flex items-center gap-2 rounded-2xl border px-3">
              <Search className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="sr-only">Add Pokémon to match</span>
              <input
                value={pokemonQuery}
                onChange={(event) => setPokemonQuery(event.target.value)}
                placeholder="Add Pokémon, e.g. Mareep"
                className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none md:text-sm"
              />
            </label>
            {pokemonQuery.trim() ? (
              <div className="flex flex-wrap gap-1.5">
                {pokemonSuggestions.map((pokemon) => (
                  <button
                    key={pokemon.id}
                    type="button"
                    aria-label={`Match ${formatPokemonDisplayName(pokemon.name)}`}
                    onClick={() => {
                      setMatchedPokemonIds((current) => [...current, pokemon.id]);
                      setPokemonQuery('');
                    }}
                    className="border-border/55 min-h-9 rounded-full border px-3 text-xs"
                  >
                    {formatPokemonDisplayName(pokemon.name)}
                  </button>
                ))}
                {!pokemonSuggestions.length ? (
                  <p className="text-muted-foreground text-xs">No more Pokémon match this search.</p>
                ) : null}
              </div>
            ) : null}
            {matchedPokemonIds.length > 0 ? (
              <div role="group" aria-label="Selected Pokémon" className="flex flex-wrap gap-1.5">
                {matchedPokemonIds.map((id) => {
                  const name = formatPokemonDisplayName(POKEMON_CATALOG.find((pokemon) => pokemon.id === id)!.name);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => setMatchedPokemonIds((current) => current.filter((selected) => selected !== id))}
                      className="border-primary/35 bg-primary/10 inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold"
                    >
                      {name}
                      <X className="h-3.5 w-3.5" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                All Pokémon in your selected sets. Add names to narrow the matches.
              </p>
            )}
          </div>
        ) : null}

        {selectedSet && checklistView === 'cards' ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              [checklistView === 'cards' ? 'Cards' : 'Pokémon', visibleSummary.total],
              ['Owned', visibleSummary.owned],
              ['Missing', visibleSummary.missing],
              ['Wanted', visibleSummary.wanted],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 px-1.5 py-1.5 text-center sm:px-3 sm:py-2">
                <p className="text-muted-foreground truncate text-xs font-medium">{label}</p>
                <p className="mt-0.5 text-base font-bold tabular-nums sm:mt-1 sm:text-lg">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        {selectedSet ? (
          <div className="mt-3 space-y-2">
            {stagedCreation && !readOnly && selectedSets.length === 1 && (
              <button
                type="button"
                className="border-border min-h-11 rounded-xl border px-3 text-sm"
                onClick={() => setPresetSet(selectedSet)}
              >
                Create binder from this set
              </button>
            )}
            {stagedCreation && presetSet && (
              <BinderCreationPresets
                key={presetSet.id}
                initialSet={presetSet}
                ownerUserId={stagedCreation.ownerUserId}
                onDraft={stagedCreation.onDraft}
                isOnline={stagedCreation.isOnline}
              />
            )}
            <div role="group" aria-label="Set checklist" className="flex gap-2">
              {(['pokemon', 'cards'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={checklistView === view}
                  onClick={() => {
                    setChecklistView(view);
                    setSlotFilter('all');
                    setSlotSearch('');
                  }}
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${checklistView === view ? 'border-primary/45 bg-primary text-primary-foreground' : 'border-border/55 bg-background/45'}`}
                >
                  {view === 'pokemon' ? 'Pokémon' : 'Cards'}
                </button>
              ))}
            </div>
            {checklistView === 'cards' ? (
              <p className="text-muted-foreground text-xs">
                {hasFullCardList
                  ? 'Mirrored cards. Owned means the printing tracked in your binder.'
                  : 'Saved Pokémon cards only. Full set checklist unavailable in this saved lookup.'}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Filters use your whole binder. Matching printings are shown below.
              </p>
            )}

            {checklistView === 'cards' ? (
              <div className="border-border/45 bg-background/45 flex items-center gap-2 rounded-2xl border px-3 py-2 dark:border-white/10">
                <Search className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <input
                  value={slotSearch}
                  onChange={(event) => setSlotSearch(event.target.value)}
                  aria-label="Filter set checklist"
                  placeholder="Filter names, numbers, rarities..."
                  className="placeholder:text-muted-foreground/70 -my-2 min-w-0 flex-1 bg-transparent py-2 text-base outline-none md:text-sm"
                />
                {slotSearch ? (
                  <button
                    type="button"
                    onClick={() => setSlotSearch('')}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground -my-1 flex h-9 w-9 items-center justify-center rounded-full p-2"
                    aria-label="Clear slot filter"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : null}
            <div
              role="group"
              aria-label={checklistView === 'pokemon' ? 'Filter by Holo Folder state' : 'Filter card printings'}
              className="flex flex-wrap gap-1.5"
            >
              {SET_SLOT_FILTERS.filter((filter) => checklistView === 'pokemon' || filter.id !== 'multiple').map(
                (filter) => {
                  const isActive = slotFilter === filter.id;
                  const count = checklistView === 'cards' ? cardCounts[filter.id] : filterCounts[filter.id];

                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setSlotFilter(filter.id)}
                      aria-pressed={isActive}
                      className={`min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                        isActive
                          ? 'border-primary/45 bg-primary text-primary-foreground'
                          : 'border-border/55 bg-background/45 text-muted-foreground hover:bg-background/75 hover:text-foreground dark:border-white/10'
                      }`}
                    >
                      {checklistView === 'pokemon'
                        ? {
                            all: 'All',
                            open: 'Missing from binder',
                            owned: 'Already have',
                            wanted: 'Wanted',
                            multiple: 'Multiple printings',
                          }[filter.id]
                        : filter.id === 'open'
                          ? 'Missing'
                          : filter.label}{' '}
                      <span className="tabular-nums opacity-75">{count}</span>
                    </button>
                  );
                },
              )}
            </div>
            {checklistView === 'pokemon' && !readOnly && selectedDexIds.size > 0 ? (
              <div className="border-primary/20 bg-primary/8 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2">
                <span className="text-primary mr-auto text-xs font-semibold">{selectedBulkCards.length} selected</span>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 rounded-full px-3 text-[11px]"
                  disabled={selectedBulkCards.length === 0}
                  onClick={() => {
                    if (onCollectCards) {
                      void onCollectCards(selectedBulkCards);
                    } else {
                      selectedBulkCards.forEach(({ slot, card }) => void onCollectCard(slot, card));
                    }
                    setSelectedDexIds(new Set());
                  }}
                >
                  {selectedBulkCards.some(({ slot, card }) => {
                    const item = collectionByPokemonId.get(slot.dexId);
                    return item && item.status !== 'wishlisted' && item.card_id !== card.id;
                  })
                    ? 'Replace selected binder cards'
                    : 'Add selected'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full px-3 text-[11px]"
                  disabled={selectedBulkCards.length === 0}
                  onClick={() => {
                    if (onWantCards) {
                      void onWantCards(selectedBulkCards);
                    } else {
                      selectedBulkCards.forEach(({ slot, card }) => void onWantCard(slot, card));
                    }
                    setSelectedDexIds(new Set());
                  }}
                >
                  Want selected
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 rounded-full px-2.5 text-[11px]"
                  onClick={() => setSelectedDexIds(new Set())}
                >
                  Clear
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 p-2">
        {selectedSets.length === 1 && matchedPokemonIds.length === 0 && !isLoading ? (
          <CardHighlights
            key={selectedSet.id}
            name={selectedSet.name}
            cards={highlightCards}
            prices={setPrices.pricesByCardId}
            formatPrice={formatPrice}
            showValues
            isLoading={setPrices.isLoading}
          />
        ) : null}
        {error ? (
          <div
            role="alert"
            className="border-destructive/25 bg-destructive/8 text-destructive mb-2 rounded-2xl border p-4 text-sm"
          >
            {error}
          </div>
        ) : null}
        {!selectedSet ? (
          <div className="px-1 pb-2">
            {allSetsState === 'saved' ? (
              <p className="text-muted-foreground px-1 py-2 text-xs">
                Offline. Showing sets saved on this device; sets you haven&apos;t opened before need a connection.
              </p>
            ) : null}
            {allSetsState === 'loading' ? (
              <p className="text-muted-foreground flex items-center gap-2 px-1 py-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sets…
              </p>
            ) : null}
            {allSetsState === 'failed' ? (
              <p className="text-muted-foreground px-1 py-3 text-sm">
                Couldn&apos;t load the set list. Search by name, code or year, or reconnect.
              </p>
            ) : null}
            {isBrowsing && browseGroups.length === 0 ? (
              <p className="text-muted-foreground px-1 py-3 text-sm">No sets match this search.</p>
            ) : null}
            {browseGroups.map((group) => (
              <section key={group.series} aria-label={`${group.series} sets`} className="pt-3">
                <h3 className="text-muted-foreground flex items-baseline justify-between gap-2 px-1 pb-2 text-[11px] font-semibold tracking-[0.16em] uppercase">
                  <span className="truncate">{group.series}</span>
                  <span className="shrink-0 tabular-nums">{group.sets.length}</span>
                </h3>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {group.sets.map((set) => (
                    <li key={set.id} className="min-w-0">
                      <button
                        type="button"
                        aria-label={set.name}
                        title={formatSetMeta(set) || set.id}
                        onClick={() => addSet(set)}
                        className="border-border/45 bg-background/45 hover:bg-background/75 flex h-full min-h-[8.5rem] w-full flex-col gap-2 rounded-2xl border p-3 text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] dark:border-white/10"
                      >
                        <SetArtwork set={set} />
                        <span className="line-clamp-2 text-sm leading-tight font-semibold break-words">{set.name}</span>
                        <span className="text-muted-foreground mt-auto truncate text-[11px] tabular-nums">
                          {[
                            set.releaseDate?.slice(0, 4),
                            set.officialCardCount ? `${set.officialCardCount} cards` : null,
                            set.id.toUpperCase(),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : selectedSet && checklistView === 'cards' ? (
          <ul aria-label={`${setLabel} card checklist`} className="space-y-2">
            {visibleCards.length === 0 ? (
              <li className="text-muted-foreground p-4 text-sm">
                {setCards.length ? 'No cards match the current filters.' : 'Card checklist unavailable for this set.'}
              </li>
            ) : null}
            {visibleCards.map(({ card, owned, wanted }) => {
              const mappedSlots = slots.filter((slot) => slot.cards.some((slotCard) => slotCard.id === card.id));
              const price = formatPrice(setPrices.pricesByCardId[getCardPriceKey(card.id, card.language)]);
              return (
                <li
                  key={card.id}
                  aria-label={`${card.name} ${formatCardNumber(card)}${owned ? ', owned' : ''}${wanted ? ', wanted' : ''}`}
                  className="border-border/45 bg-background/45 flex min-w-0 gap-3 rounded-2xl border p-3"
                >
                  <div className="trading-card bg-muted/45 flex w-14 shrink-0 items-center justify-center self-start">
                    {card.image ? (
                      <NextImage
                        unoptimized
                        width={56}
                        height={78}
                        src={getProxiedThumbnailUrl(card.image) ?? card.image}
                        alt={card.name}
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">No image</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold break-words">{card.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {[card.set.name, formatCardNumber(card), card.rarity, ...getCardVariantLabels(card.variants)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {owned ? (
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">Owned</span>
                      ) : null}
                      {wanted ? <span className="font-semibold text-amber-700 dark:text-amber-300">Wanted</span> : null}
                      {price ? <span>{price}</span> : null}
                    </div>
                    {mappedSlots.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {mappedSlots.map((slot) => (
                          <button
                            key={slot.dexId}
                            type="button"
                            onClick={() => onBrowseCard(slot, card)}
                            className="border-border/55 min-h-9 rounded-full border px-3 text-xs capitalize"
                          >
                            Browse {slot.pokemonName} cards
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground mt-2 text-xs">Unavailable for binder, no Pokémon slot</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : selectedSet && slots.length === 0 && !isLoading ? (
          <div className="border-border/45 bg-background/45 text-muted-foreground rounded-2xl border p-4 text-sm">
            No Pokemon dex slots found for this set. Trainer, energy, and item-only cards are ignored here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredSlots.length === 0 ? (
              <div className="border-border/45 bg-background/45 text-muted-foreground rounded-2xl border p-4 text-sm">
                No slots match the current filters.
              </div>
            ) : null}
            {filteredSlots.map((slot) => {
              const item = collectionByPokemonId.get(slot.dexId);
              const isOwned = Boolean(item && item.status !== 'wishlisted');
              const wanted = Boolean(item?.status === 'wishlisted' || item?.wanted_cards.length);
              const { ownedElsewhere } = getSetSlotState(slot, item);
              const primaryCard = getSelectedSetCard(slot, selectedCardIdsByDexId);
              const priceLabel = primaryCard
                ? formatPrice(setPrices.pricesByCardId[getCardPriceKey(primaryCard.id, primaryCard.language)])
                : null;
              const isSelected = selectedDexIds.has(slot.dexId);

              return (
                <div
                  key={slot.dexId}
                  role="region"
                  aria-label={`${formatPokemonDisplayName(slot.pokemonName)} matches`}
                  className={`grid w-full ${readOnly ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-[auto_auto_minmax(0,1fr)]'} hover:border-border/60 hover:bg-background/70 items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors dark:hover:border-white/10 ${
                    isSelected
                      ? 'border-primary/35 bg-primary/8'
                      : 'bg-background/35 dark:bg-background/22 border-transparent'
                  }`}
                >
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSelectedDexId(slot.dexId);
                      }}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${slot.pokemonName}`}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border/55 bg-background/55 text-muted-foreground hover:bg-background/85 hover:text-foreground dark:border-white/10'
                      }`}
                    >
                      {isSelected ? <Check className="h-4 w-4" /> : null}
                    </button>
                  ) : null}
                  <div className="trading-card border-border/45 bg-muted/45 relative flex w-12 shrink-0 items-center justify-center border">
                    {primaryCard?.image ? (
                      <img
                        src={toCardImageSrc(primaryCard.image) ?? undefined}
                        alt={primaryCard.name}
                        className="h-full w-full object-contain"
                        loading="lazy"
                        onError={savedThumbnailOnError(primaryCard.image)}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs font-semibold">{formatDexNumber(slot.dexId)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectSlot(slot)}
                          className="min-h-9 text-left text-sm font-semibold"
                        >
                          {formatPokemonDisplayName(slot.pokemonName)}
                        </button>
                        <p className="text-muted-foreground truncate text-[11px]">
                          {formatDexNumber(slot.dexId)} · {slot.cards.length} printing
                          {slot.cards.length === 1 ? '' : 's'} across{' '}
                          {new Set(slot.cards.map((card) => card.set.id)).size} set
                          {new Set(slot.cards.map((card) => card.set.id)).size === 1 ? '' : 's'}
                        </p>
                        {primaryCard ? (
                          <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
                            {primaryCard.set.name} ·{' '}
                            {primaryCard.set.officialCardCount
                              ? `${primaryCard.localId}/${primaryCard.set.officialCardCount}`
                              : `#${primaryCard.localId}`}{' '}
                            · {primaryCard.rarity ?? 'Unknown rarity'}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${
                          isOwned
                            ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-600 dark:text-emerald-300'
                            : 'border-border/55 bg-muted/35 text-muted-foreground'
                        }`}
                      >
                        {isOwned ? <Check className="h-3 w-3" /> : <Heart className="h-3 w-3" />}
                        {isOwned ? 'Already have' : 'Missing from binder'}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {wanted ? (
                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          Wanted Pokémon
                        </span>
                      ) : null}
                      {primaryCard && isOwned && matchesCatalogCardId(primaryCard, item?.card_id) ? (
                        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          Your binder card
                        </span>
                      ) : null}
                      {ownedElsewhere ? (
                        <span className="text-muted-foreground text-[11px]">
                          {item?.card_id ? 'Owned elsewhere' : 'Owned printing unspecified'}
                        </span>
                      ) : null}
                      {priceLabel ? (
                        <span className="border-primary/20 bg-primary/8 text-primary rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                          {priceLabel}
                        </span>
                      ) : null}
                      {slot.cards.length > 0 ? (
                        <div className="scrollbar-hide flex w-full gap-1 overflow-x-auto pb-0.5">
                          {slot.cards.map((card) => {
                            const isActiveCard = primaryCard?.id === card.id;
                            const { wanted: wantedPrinting } = getSetCardState(card, item ? [item] : []);

                            return (
                              <button
                                key={card.id}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedCardIdsByDexId((current) => ({
                                    ...current,
                                    [slot.dexId]: card.id,
                                  }));
                                }}
                                aria-label={`${card.set.name} ${formatCardNumber(card)} ${card.rarity ?? ''} ${card.name}${isOwned && matchesCatalogCardId(card, item?.card_id) ? ' Your binder card' : ''}`}
                                aria-pressed={isActiveCard}
                                className={`min-h-9 max-w-52 min-w-24 shrink-0 rounded-xl border px-2 py-1 text-left transition-colors ${
                                  isActiveCard
                                    ? 'border-primary/45 bg-primary/12 text-foreground'
                                    : 'border-border/45 bg-background/45 text-muted-foreground hover:bg-background/75 hover:text-foreground dark:border-white/10'
                                }`}
                              >
                                <p className="truncate text-[11px] font-semibold">{card.set.name}</p>
                                <p className="truncate text-[10px] font-semibold">
                                  {card.set.officialCardCount
                                    ? `${card.localId}/${card.set.officialCardCount}`
                                    : `#${card.localId}`}
                                </p>
                                {card.name.includes('(') ? <p className="truncate text-[10px]">{card.name}</p> : null}
                                <p className="truncate text-[10px]">
                                  {[card.rarity, ...getCardVariantLabels(card.variants)].filter(Boolean).join(' · ') ||
                                    'Unknown rarity'}
                                  {isOwned && matchesCatalogCardId(card, item?.card_id) ? ' · Your binder card' : ''}
                                  {wantedPrinting ? ' · Wanted printing' : ''}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {!readOnly && primaryCard ? (
                        <span className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="min-h-9 rounded-full px-3 text-[11px]"
                            disabled={isOwned && matchesCatalogCardId(primaryCard, item?.card_id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              onCollectCard(slot, primaryCard);
                            }}
                          >
                            {isOwned && matchesCatalogCardId(primaryCard, item?.card_id)
                              ? 'In binder'
                              : isOwned
                                ? 'Replace binder card'
                                : 'Add'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-9 rounded-full px-3 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              onWantCard(slot, primaryCard);
                            }}
                          >
                            {hasWantedSetCard(primaryCard, item) ? 'Remove wanted' : 'Want'}
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
