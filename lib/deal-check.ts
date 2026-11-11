// Deal checker: is this asking price a good buy against the card's market price? Pure and client-safe.
//
// Bands, by how far the asking price sits from market (negative = under market):
//   great       at or below -greatPct            (default 20% or more under)
//   good        below -fairPct                   (default more than 10% under)
//   fair        within ±fairPct                  (default ±10%)
//   overpriced  above +fairPct                   (default more than 10% over)
//   walk-away   at or above +walkAwayPct         (default 35% or more over)
// "Pay up to" is the top of the fair band: market × (1 + fairPct). Under market × (1 - fairPct) is good.
// Thresholds live on the device (localStorage) and are edited in Settings.

export type DealVerdict = 'great' | 'good' | 'fair' | 'overpriced' | 'walk-away';

export interface DealThresholds {
  /** % under market that counts as a great deal. */
  greatPct: number;
  /** ± % around market that counts as fair. */
  fairPct: number;
  /** % over market where you should walk away. */
  walkAwayPct: number;
}

export const DEFAULT_DEAL_THRESHOLDS: DealThresholds = { greatPct: 20, fairPct: 10, walkAwayPct: 35 };
export const DEAL_THRESHOLDS_KEY = 'binderdex:deal-thresholds:v1';

export const DEAL_VERDICT_LABELS: Record<DealVerdict, string> = {
  great: 'Great deal',
  good: 'Good price',
  fair: 'Fair price',
  overpriced: 'Overpriced',
  'walk-away': 'Walk away',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps the bands ordered: 1 ≤ fair < great ≤ 90 and fair < walk-away ≤ 500. */
export function normalizeDealThresholds(value: unknown): DealThresholds {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof DealThresholds, unknown>>;
  const num = (raw: unknown, fallback: number) =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : fallback;
  const fairPct = clamp(num(input.fairPct, DEFAULT_DEAL_THRESHOLDS.fairPct), 1, 50);
  const greatPct = clamp(num(input.greatPct, DEFAULT_DEAL_THRESHOLDS.greatPct), fairPct + 1, 90);
  const walkAwayPct = clamp(num(input.walkAwayPct, DEFAULT_DEAL_THRESHOLDS.walkAwayPct), fairPct + 1, 500);
  return { fairPct, greatPct, walkAwayPct };
}

export function parseDealThresholds(raw: string | null | undefined): DealThresholds {
  if (!raw) return DEFAULT_DEAL_THRESHOLDS;
  try {
    return normalizeDealThresholds(JSON.parse(raw));
  } catch {
    return DEFAULT_DEAL_THRESHOLDS;
  }
}

export function readDealThresholds(storage: Pick<Storage, 'getItem'> | undefined): DealThresholds {
  try {
    return parseDealThresholds(storage?.getItem(DEAL_THRESHOLDS_KEY));
  } catch {
    return DEFAULT_DEAL_THRESHOLDS;
  }
}

export function writeDealThresholds(storage: Pick<Storage, 'setItem'> | undefined, thresholds: DealThresholds) {
  try {
    storage?.setItem(DEAL_THRESHOLDS_KEY, JSON.stringify(normalizeDealThresholds(thresholds)));
  } catch {
    // Storage full or blocked: the defaults still apply.
  }
}

/** Parses what was typed on the keypad ("6", "6.5", "£6,50", "1,200") into an amount, or null. */
export function parseAskingPrice(input: string): number | null {
  let text = input.replace(/[^\d.,]/g, '');
  if (!text) return null;
  // "6,50" is a decimal comma; "1,200" and "1,200.50" use it for thousands.
  if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  if ((text.match(/\./g) ?? []).length > 1) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export interface DealCheckInput {
  askingPrice: number;
  /** Market price in the same currency as the asking price. */
  marketPrice: number | null | undefined;
  thresholds?: DealThresholds;
  confidence?: 'high' | 'medium' | 'low' | 'unknown' | null;
  /** Days since the provider last updated this price. */
  dataAgeDays?: number | null;
  isRising?: boolean;
}

export interface DealCheck {
  verdict: DealVerdict;
  label: string;
  /** (asking - market) / market, as a whole-number %. Negative = under market. */
  diffPct: number;
  /** asking - market. Negative = saving. */
  diffAmount: number;
  /** The most to pay that still counts as fair. */
  payUpTo: number;
  /** Below this counts as a good price. */
  goodBelow: number;
  /** Below or at this counts as a great deal. */
  greatAt: number;
  notes: string[];
}

export const THIN_DATA_NOTE = 'Thin price data: treat as a rough guide';
export const RISING_NOTE = 'Rising: this price may be fair soon';

export function checkDeal({
  askingPrice,
  marketPrice,
  thresholds = DEFAULT_DEAL_THRESHOLDS,
  confidence,
  dataAgeDays,
  isRising,
}: DealCheckInput): DealCheck | null {
  if (!Number.isFinite(askingPrice) || !(askingPrice > 0) || typeof marketPrice !== 'number') return null;
  const bands = buildDealPriceBands(marketPrice, thresholds);
  if (!bands) return null;
  const pct = ((askingPrice - marketPrice) / marketPrice) * 100;
  const verdict: DealVerdict =
    askingPrice < marketPrice && askingPrice <= bands.greatBelow
      ? 'great'
      : askingPrice < bands.fair.low
        ? 'good'
        : askingPrice <= bands.fair.high
          ? 'fair'
          : askingPrice >= bands.walkAwayAbove
            ? 'walk-away'
            : 'overpriced';

  const notes: string[] = [];
  if (confidence === 'low' || confidence === 'unknown') notes.push(THIN_DATA_NOTE);
  if (typeof dataAgeDays === 'number' && dataAgeDays > 7)
    notes.push(`Price data is ${Math.round(dataAgeDays)} days old`);
  if (isRising && verdict === 'overpriced') notes.push(RISING_NOTE);

  return {
    verdict,
    label: DEAL_VERDICT_LABELS[verdict],
    diffPct: Math.round(pct),
    diffAmount: roundMoney(askingPrice - marketPrice),
    payUpTo: bands.fair.high,
    goodBelow: bands.fair.low,
    greatAt: bands.greatBelow,
    notes,
  };
}

export interface BundleItem {
  /** Market price in the same currency as the asking total. */
  marketPrice: number | null | undefined;
}

/**
 * A bundle is one asking total for several cards, judged against the cards' combined market price. Cards
 * without a market price can't be valued. Native comparisons require every selected reference; legacy
 * comparisons cover the priced ones and say how many are unpriced.
 */
export function checkBundle(
  items: readonly BundleItem[],
  askingTotal: number | null,
  thresholds = DEFAULT_DEAL_THRESHOLDS,
  requireComplete = false,
) {
  const priced = items.filter(
    (item) => typeof item.marketPrice === 'number' && Number.isFinite(item.marketPrice) && item.marketPrice > 0,
  );
  const marketTotal = roundMoney(priced.reduce((sum, item) => sum + (item.marketPrice as number), 0));
  const unpricedCount = items.length - priced.length;
  const deal =
    askingTotal && askingTotal > 0 && priced.length > 0 && (!requireComplete || unpricedCount === 0)
      ? checkDeal({ askingPrice: askingTotal, marketPrice: marketTotal, thresholds })
      : null;
  if (deal && unpricedCount > 0)
    deal.notes.unshift(`${unpricedCount} card${unpricedCount === 1 ? ' has' : 's have'} no price: judged on the rest`);
  return { marketTotal, unpricedCount, deal };
}

/** The same thresholds used by checkDeal, expressed as prices for charts and scales. */
export function buildDealPriceBands(market: number, thresholds?: DealThresholds) {
  if (!Number.isFinite(market) || market <= 0) return null;
  const { greatPct, fairPct, walkAwayPct } = normalizeDealThresholds(thresholds);
  return {
    fair: { low: roundMoney(market * (1 - fairPct / 100)), high: roundMoney(market * (1 + fairPct / 100)) },
    greatBelow: roundMoney(market * (1 - greatPct / 100)),
    walkAwayAbove: roundMoney(market * (1 + walkAwayPct / 100)),
  };
}
