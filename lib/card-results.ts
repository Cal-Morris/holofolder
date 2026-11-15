/**
 * The shared card results grid (Add a card, Search, an illustrator's cards): its price lines and its set, rarity,
 * artist and Pokémon filters. Pure, so every grid and the unit tests agree. Sorting is `sortCardPickerCards`.
 */
import type { CardPriceSnapshot } from '@/lib/card-pricing';

/** The tile's price lines: the "good" (L) and market (M) prices, the range and the confidence, each null when unknown. */
export function cardResultPriceLabels<TPrice extends CardPriceSnapshot>(
  price: TPrice | undefined,
  formatAmount: (gbpAmount: number | null | undefined, price?: TPrice) => string | null,
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

export interface CardResultFilters {
  set?: string;
  rarity?: string;
  illustrator?: string;
  pokemon?: number;
}

interface FilterableCard {
  set: { id: string; name: string };
  rarity?: string;
  illustrator?: string;
  dexIds?: readonly number[];
}

/** The filter choices the cards themselves offer: their sets (by name), rarities and artists. */
export function cardResultFilterOptions(cards: readonly FilterableCard[]) {
  return {
    sets: [...new Map(cards.map((card) => [card.set.id, { id: card.set.id, name: card.set.name }])).values()]
      .filter((set) => Boolean(set.id))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    rarities: [...new Set(cards.flatMap((card) => (card.rarity ? [card.rarity] : [])))],
    illustrators: [...new Set(cards.flatMap((card) => (card.illustrator ? [card.illustrator] : [])))].toSorted((a, b) =>
      a.localeCompare(b),
    ),
  };
}

export function filterCardResults<TCard extends FilterableCard>(cards: readonly TCard[], filters: CardResultFilters) {
  return cards.filter(
    (card) =>
      (!filters.set || card.set.id === filters.set) &&
      (!filters.rarity || card.rarity === filters.rarity) &&
      (!filters.illustrator || card.illustrator === filters.illustrator) &&
      (filters.pokemon === undefined || Boolean(card.dexIds?.includes(filters.pokemon))),
  );
}
