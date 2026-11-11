'use client';

// Show mode: one Pokémon's cards, ordered for scanning a binder. Wanted first (highlighted, with what to pay up
// to), then the ones still missing, owned last and dimmed. Offline it falls back to the cards on this device.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useDisplayCardPrices } from '@/hooks/use-display-card-prices';
import { loadCardsForPokemon } from '@/hooks/use-tcgdex';
import type { CardFinish, WantedCard } from '@/lib/domain/cards';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { formatPokemonDisplayName } from '@/lib/pokemon-catalog';
import { inferCardFinish, type SearchCardResult } from '@/lib/pokemon-card-browse';
import type { DisplayFxRates } from '@/lib/regional-price';
import type { DisplayCurrency, PricingRegion } from '@/lib/pricing-region';
import { getSetEra, orderPokemonCards, wantedToSearchCard, type PokemonCardStanding } from '@/lib/show-hunt';
import { HuntCardRow, PokemonSprite, useDealThresholds } from '@/components/show-hunt';
import { MomentumSortChips } from '@/components/momentum-sort-chips';
import { applyMomentumSort, type MomentumSort } from '@/lib/momentum-sort';
import type { QuickCardState } from '@/components/quick-card-check';

const MAX_PRICED = 60;

export interface ShowPokemonCardsProps {
  pokemon: { id: number; name: string };
  wantedCards: readonly WantedCard[];
  getCardState: (card: SearchCardResult, pokemon: { id: number; name: string }) => QuickCardState;
  getOfflineCards: () => Promise<SearchCardResult[]>;
  currency: DisplayCurrency;
  fxRates?: DisplayFxRates | null;
  pricingRegion: PricingRegion;
  isOnline: boolean;
  onBack: () => void;
  onPickCard: (card: SearchCardResult, finish: CardFinish | null) => void;
}

export default function ShowPokemonCards({
  pokemon,
  wantedCards,
  getCardState,
  getOfflineCards,
  currency,
  fxRates,
  pricingRegion,
  isOnline,
  onBack,
  onPickCard,
}: ShowPokemonCardsProps) {
  const thresholds = useDealThresholds();
  const [loaded, setLoaded] = useState<{ cards: SearchCardResult[]; offline: boolean } | null>(null);
  const [era, setEra] = useState<string | null>(null);
  const [moveSort, setMoveSort] = useState<MomentumSort>('default');

  useEffect(() => {
    let cancelled = false;
    loadCardsForPokemon(pokemon.id)
      .then((cards) => cards.map((card) => ({ ...card, dexIds: [pokemon.id] }) as SearchCardResult))
      .then((cards) => ({ cards, offline: false }))
      .catch(async () => ({
        cards: (await getOfflineCards().catch(() => [])).filter((card) => card.dexIds.includes(pokemon.id)),
        offline: true,
      }))
      .then((result) => {
        if (!cancelled) setLoaded(result);
      });
    return () => {
      cancelled = true;
    };
  }, [getOfflineCards, pokemon.id]);

  // Wanted cards always show, even before (or without) the full list.
  const entries = useMemo(() => {
    const cards = [...(loaded?.cards ?? [])];
    for (const wanted of wantedCards) {
      if (!cards.some((card) => matchesCatalogCardId(card, wanted.card_id)))
        cards.push(wantedToSearchCard(wanted, pokemon.id));
    }
    return cards.map((card) => {
      const state = getCardState(card, pokemon);
      const wanted = wantedCards.find((entry) => matchesCatalogCardId(card, entry.card_id));
      const standing: PokemonCardStanding = state.owned ? 'owned' : state.wanted ? 'wanted' : 'missing';
      return {
        card,
        standing,
        finish: (wanted?.card_finish ?? null) as CardFinish | null,
        era: getSetEra(card.set.id),
      };
    });
  }, [getCardState, loaded, pokemon, wantedCards]);

  const lookups = useMemo(
    () =>
      entries.slice(0, MAX_PRICED).map((entry) => ({
        cardId: entry.card.id,
        language: entry.card.language ?? 'en',
        finish: entry.finish ?? inferCardFinish(entry.card.rarity, entry.card.variants),
      })),
    [entries],
  );
  const { priceOf, snapshotOf } = useDisplayCardPrices(lookups, pricingRegion, currency, fxRates);
  const priced = entries.map((entry) => {
    const market = priceOf({
      cardId: entry.card.id,
      language: entry.card.language ?? 'en',
      finish: entry.finish ?? inferCardFinish(entry.card.rarity, entry.card.variants),
    });
    return { ...entry, market, price: market?.amount ?? null };
  });
  const eras = [...new Map(priced.map((entry) => [entry.era.id, entry.era])).values()];
  const visible = applyMomentumSort(
    orderPokemonCards(era ? priced.filter((entry) => entry.era.id === era) : priced),
    moveSort,
    (entry) => snapshotOf({ cardId: entry.card.id, language: entry.card.language ?? 'en' }),
  );
  const counts = {
    wanted: priced.filter((entry) => entry.standing === 'wanted').length,
    owned: priced.filter((entry) => entry.standing === 'owned').length,
  };
  const name = formatPokemonDisplayName(pokemon.name);

  return (
    <section aria-label={`${name} cards`} className="flex min-h-0 flex-1 flex-col" data-testid="show-pokemon-cards">
      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <div
          data-hunt-controls
          className="border-border/40 bg-background sticky top-0 z-10 -mx-3 space-y-2 border-b px-3 pt-2 pb-2"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to hunting"
              className="bg-muted/70 flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <PokemonSprite id={pokemon.id} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg leading-tight font-bold">{name}</h3>
              <p className="text-muted-foreground truncate text-xs" data-testid="show-pokemon-counts">
                {loaded ? `${priced.length} cards` : 'Loading cards…'} · {counts.wanted} wanted · {counts.owned} owned
                {loaded?.offline || !isOnline ? ' · saved on this device' : ''}
              </p>
            </div>
            {!loaded && <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" aria-label="Loading cards" />}
          </div>
          {eras.length > 1 && (
            <div
              role="radiogroup"
              aria-label="Era"
              className="-mx-3 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-3"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!era}
                onClick={() => setEra(null)}
                className={`flex h-12 shrink-0 items-center rounded-full border px-4 text-sm font-semibold ${!era ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-card'}`}
              >
                All
              </button>
              {eras.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={era === entry.id}
                  onClick={() => setEra(era === entry.id ? null : entry.id)}
                  className={`flex h-12 shrink-0 items-center rounded-full border px-4 text-sm font-semibold ${era === entry.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-card'}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
          <MomentumSortChips value={moveSort} onChange={setMoveSort} className="-mx-3 px-3" />
        </div>
        <div className="grid grid-cols-1 gap-1.5 pt-3 @min-[48rem]:grid-cols-2">
          {visible.map((entry) => (
            <HuntCardRow
              key={`${entry.card.id}:${entry.card.language ?? 'en'}`}
              card={entry.card}
              finish={entry.finish}
              market={entry.market}
              thresholds={thresholds}
              standing={entry.standing}
              onPick={() => onPickCard(entry.card, entry.finish)}
            />
          ))}
          {loaded && visible.length === 0 && (
            <p role="status" className="text-muted-foreground px-3 py-8 text-center text-sm">
              {loaded.offline ? 'No cards for this Pokémon are saved on this device.' : 'No cards found.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
