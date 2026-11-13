import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import type { InventoryBrowseRow } from '@/lib/domain/inventory-browse';
import {
  getFallingMomentum,
  getRisingMomentum,
  type MomentumPriceInput,
  isMomentumEligibleConfidence,
  type PriceMomentum,
} from '@/lib/price-momentum';
import { wantedCompletionTotal, type WantedDashboardCard } from '@/lib/wanted-dashboard';

type InsightRow = Pick<
  InventoryBrowseRow,
  'itemId' | 'name' | 'cardId' | 'speciesNames' | 'setName' | 'image' | 'language' | 'finish' | 'graded'
>;
type InsightCopy = {
  itemId: string;
  amountGbp: number | null;
  quote: (MomentumPriceInput & { confidence: string }) | null;
};

export interface InsightCard {
  key: string;
  name: string;
  setName: string | null;
  image: string | null;
  language: string | null;
  finish: string | null;
  /** One copy's price; unknown stays null. */
  amountGbp: number | null;
  copies: number;
  quote: InsightCopy['quote'];
}

export type ConfidenceBucket = 'high' | 'medium' | 'low' | 'unpriced' | 'graded';
export const CONFIDENCE_BUCKETS: readonly ConfidenceBucket[] = ['high', 'medium', 'low', 'unpriced', 'graded'];
/** Legend labels and theme colours for the price confidence chart. */
export const CONFIDENCE_STYLE: Record<ConfidenceBucket, { label: string; color: string }> = {
  high: { label: 'High confidence', color: 'var(--highlight)' },
  medium: { label: 'Medium confidence', color: 'var(--primary)' },
  low: { label: 'Low confidence', color: 'var(--muted-foreground)' },
  unpriced: { label: 'No price yet', color: 'var(--input)' },
  graded: { label: 'Graded, not valued', color: 'var(--secondary-foreground)' },
};

const TOP_SETS = 6;
const LIST_LIMIT = 6;
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Presentation insights over the same rows and copy values as the collection total.
 * Copies of one printing collapse into one card. Rising and falling use the shared confidence-gated momentum rules,
 * and graded copies never get a raw-price signal.
 */
export function buildCollectionInsights(rows: readonly InsightRow[], copies: readonly InsightCopy[], now = Date.now()) {
  const copyById = new Map(copies.map((c) => [c.itemId, c]));
  const printings = new Map<string, InsightCard>();
  const sets = new Map<string, { valueGbp: number; copies: number }>();
  const confidence: Record<ConfidenceBucket, number> = { high: 0, medium: 0, low: 0, unpriced: 0, graded: 0 };
  const languages = new Map<string, number>();
  const finishes = new Map<string, number>();

  for (const row of rows) {
    const copy = copyById.get(row.itemId);
    const amount = copy?.amountGbp ?? null;
    const setName = row.setName?.trim() || 'Unknown set';
    const set = sets.get(setName) ?? { valueGbp: 0, copies: 0 };
    sets.set(setName, { valueGbp: set.valueGbp + (amount ?? 0), copies: set.copies + 1 });
    const level = copy?.quote?.confidence;
    const bucket: ConfidenceBucket = row.graded
      ? 'graded'
      : amount === null
        ? 'unpriced'
        : level === 'high' || level === 'medium'
          ? level
          : 'low';
    confidence[bucket] += 1;
    if (row.language) languages.set(row.language, (languages.get(row.language) ?? 0) + 1);
    if (row.finish) finishes.set(row.finish, (finishes.get(row.finish) ?? 0) + 1);

    if (row.graded) continue;
    const key = row.cardId ? [row.cardId, row.language, row.finish].join('|') : row.itemId;
    const existing = printings.get(key);
    if (existing) existing.copies += 1;
    else
      printings.set(key, {
        key,
        name: row.name ?? (row.speciesNames.join(', ') || 'Unknown card'),
        setName: row.setName,
        image: row.image,
        language: row.language,
        finish: row.finish,
        amountGbp: amount,
        copies: 1,
        quote: copy?.quote ?? null,
      });
  }

  const cards = [...printings.values()];
  const withMomentum = (pick: typeof getRisingMomentum) =>
    cards.flatMap((card) => {
      const momentum = pick(card.quote, now);
      return momentum ? [{ ...card, momentum }] : [];
    });
  const bySize = (a: { momentum: PriceMomentum }, b: { momentum: PriceMomentum }) =>
    Math.abs(b.momentum.change) - Math.abs(a.momentum.change);

  const setList = [...sets.entries()]
    .map(([name, s]) => ({ name, valueGbp: cents(s.valueGbp), copies: s.copies }))
    .sort((a, b) => b.valueGbp - a.valueGbp || b.copies - a.copies);
  const rest = setList.slice(TOP_SETS);
  const valueBySet = rest.length
    ? [
        ...setList.slice(0, TOP_SETS),
        {
          name: `${rest.length} other ${rest.length === 1 ? 'set' : 'sets'}`,
          valueGbp: cents(rest.reduce((n, s) => n + s.valueGbp, 0)),
          copies: rest.reduce((n, s) => n + s.copies, 0),
        },
      ]
    : setList;

  return {
    topCards: cards
      .filter((c) => c.amountGbp !== null)
      .toSorted((a, b) => b.amountGbp! - a.amountGbp!)
      .slice(0, LIST_LIMIT),
    rising: withMomentum(getRisingMomentum).toSorted(bySize).slice(0, LIST_LIMIT),
    falling: withMomentum(getFallingMomentum).toSorted(bySize).slice(0, LIST_LIMIT),
    valueBySet,
    setCount: setList.length,
    confidence,
    languages: Array.from(languages).toSorted((a, b) => b[1] - a[1]),
    finishes: Array.from(finishes).toSorted((a, b) => b[1] - a[1]),
  };
}

/** Oldest, 7 day and current amounts from the momentum's own source, for a three-point sparkline. */
export function momentumSparkline(quote: MomentumPriceInput | null, momentum: PriceMomentum) {
  const amounts = new Map<string, number>();
  for (const p of quote?.trendPoints ?? [])
    if (p.source === momentum.source) amounts.set(p.label.trim().toLowerCase(), p.gbpAmount);
  return [amounts.get('30d'), amounts.get('7d'), momentum.currentGbpAmount].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
  );
}

/**
 * Want list highlights from the Wanted tab's own priced cards: confidence-gated drops and rises,
 * the cheapest reliably priced wants and the cost to buy the reliably priced rest.
 */
export function buildWantListInsights(cards: readonly WantedDashboardCard[], now = Date.now()) {
  // A printing wanted in several pockets lists once; the total still counts every pocket.
  const printings = [
    ...new Map(
      cards.map((c) => [[c.card.card_id, c.card.card_language ?? 'en', c.card.card_finish ?? 'normal'].join('|'), c]),
    ).values(),
  ];
  const moves = (pick: typeof getRisingMomentum) =>
    printings.flatMap((card) => {
      const momentum = card.isPriced ? pick(card.price, now) : null;
      return momentum ? [{ card, momentum }] : [];
    });
  const bySize = (a: { momentum: PriceMomentum }, b: { momentum: PriceMomentum }) =>
    Math.abs(b.momentum.change) - Math.abs(a.momentum.change);
  return {
    count: cards.length,
    total: wantedCompletionTotal(cards),
    drops: moves(getFallingMomentum).toSorted(bySize).slice(0, LIST_LIMIT),
    rising: moves(getRisingMomentum).toSorted(bySize).slice(0, LIST_LIMIT),
    cheapest: printings
      .filter((c) => c.effectiveGbpAmount !== null && isMomentumEligibleConfidence(c.price?.confidence))
      .toSorted((a, b) => a.effectiveGbpAmount! - b.effectiveGbpAmount!)
      .slice(0, 5),
  };
}

/** "Set · English · Holo · ×2" detail line for an insight card. */
export const insightDetail = (card: Pick<InsightCard, 'setName' | 'language' | 'finish' | 'copies'>) =>
  [
    card.setName,
    card.language ? formatCardLanguageLabel(card.language) : null,
    card.finish ? formatCardFinishLabel(card.finish) : null,
    card.copies > 1 ? `×${card.copies}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
