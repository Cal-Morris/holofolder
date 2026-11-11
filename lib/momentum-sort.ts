// "% down" / "% up" ordering for card lists (Show Hunting, a Pokémon's cards, Quick results). A thin switch over
// price-momentum's sortByFallingMomentum / sortByRisingMomentum: qualifying movers first by biggest move, the
// rest keep their order. No thresholds live here.
import { sortByFallingMomentum, sortByRisingMomentum, type MomentumPriceGetter } from '@/lib/price-momentum';

export type MomentumSort = 'default' | 'falling' | 'rising';

export const MOMENTUM_SORT_OPTIONS: ReadonlyArray<{ id: MomentumSort; label: string; ariaLabel: string }> = [
  { id: 'default', label: 'Default', ariaLabel: 'Default order' },
  { id: 'falling', label: '% down', ariaLabel: 'Biggest price drop first' },
  { id: 'rising', label: '% up', ariaLabel: 'Biggest price rise first' },
];

export function applyMomentumSort<T>(
  items: readonly T[],
  sort: MomentumSort,
  getPrice: MomentumPriceGetter<T>,
  now = Date.now(),
): T[] {
  if (sort === 'falling') return sortByFallingMomentum(items, getPrice, now);
  if (sort === 'rising') return sortByRisingMomentum(items, getPrice, now);
  return [...items];
}
