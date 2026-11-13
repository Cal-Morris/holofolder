export type PriceProvider =
  'tcgplayer' | 'cardmarket' | 'ebay' | 'pricecharting' | 'pokescope' | 'pokepulse' | 'eyevo' | 'public-page';
export type PriceCurrency = 'USD' | 'EUR' | 'GBP';
export type PriceMatchRating = 'exact' | 'strong' | 'weak' | 'rejected';
export type BuySignalStatus = 'good' | 'fair' | 'hold' | 'rising';

export type PriceSubjectVariant = 'normal' | 'holo' | 'reverse' | '1st-edition';

export interface PriceSubject {
  cardId: string;
  name: string;
  setId: string | null;
  setName: string | null;
  /** Reviewed market names for this catalog set. */
  setAliases?: string[];
  /** Full catalog variant list proves this stamped printing has only this finish. */
  unambiguousPrintingFinish?: PriceSubjectVariant;
  officialCardCount?: number | null;
  localId: string | null;
  language: string;
  /** Printing being priced. When set, listings for a different printing are rejected. */
  variant?: PriceSubjectVariant | null;
  /** Catalog-verified stamp, independent of the card name and foil finish. */
  printing?: 'pokemon-center' | 'staff' | 'pre-release';
}

export interface PriceObservation {
  provider: PriceProvider;
  title: string;
  sourceUrl: string;
  amount: number;
  currency: PriceCurrency;
  observedAt: string;
  soldAt?: string | null;
  condition?: string | null;
}

export interface PriceObservationMatch {
  score: number;
  rating: PriceMatchRating;
  rejected: boolean;
  reasons: string[];
  rejectReasons: string[];
}

export interface CardBuySignal {
  status: BuySignalStatus;
  label: string;
  reason: string;
}

const MULTI_CARD_PATTERNS = [
  /\bchoose\s+your\s+card\b/i,
  /\bpick\s+your\s+card\b/i,
  /\bselect\s+your\s+card\b/i,
  /\bcomplete\s+set\b/i,
];

const LOT_PATTERNS = [
  /\b(?:[2-9]\d*\s*x|1\d+\s*x|x\s*(?:[2-9]\d*|1\d+)|playset|pair)\b/i,
  /\blot\b/i,
  /\bbundle\b/i,
  /\b\d+\s+cards?\b/i,
];

const GRADED_PATTERNS = [
  /\bpsa\s*\d+/i,
  /\bcgc\s*\d+/i,
  /\bbgs\s*\d+/i,
  /\bbeckett\s*\d+/i,
  /\b(?:sgc|ags|tag|ace)\s*(?:grade\s*)?\d+(?:\.\d)?\b(?!\s*\/)/i,
  /\bgraded\b/i,
  /\bslab(?:bed)?\b/i,
];

const BAD_PATTERNS = [/\bproxy\b/i, /\bcustom\b/i, /\bfake\b/i, /\bdigital\b/i];

const OVERSIZED_PATTERNS = [/\bjumbo\b/i, /\boversized?\b/i];

const REVERSE_HOLO_PATTERNS = [/\breverse\b/i, /\breverse[\s-]*holo(?:foil)?\b/i, /\brev[\s-]*holo\b/i, /\br\/h\b/i];

const FIRST_EDITION_PATTERNS = [/\b1st[\s-]*ed(?:ition|\.)?(?=\W|$)/i, /\bfirst[\s-]*edition\b/i];

export function buildPriceResearchHeaders(contactUrl = 'https://holofolder.com') {
  return {
    'User-Agent': `HoloFolderPriceResearch/1.0 (+${contactUrl})`,
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  };
}

export function scorePriceObservationMatch(
  subject: PriceSubject,
  observation: PriceObservation,
): PriceObservationMatch {
  const title = observation.title.trim();
  const rejectReasons = hardRejectReasons(title);

  if (rejectReasons.length > 0) {
    return rejectedMatch(rejectReasons);
  }

  const variantMismatch = findVariantMismatch(subject.variant ?? null, title);
  if (variantMismatch) {
    return rejectedMatch([variantMismatch]);
  }

  const normalizedTitle = normalizeComparableText(title);
  const normalizedName = normalizeComparableText(subject.name);
  const stampPatterns = {
    'pokemon-center': /\bpokemon cent(?:er|re)\b/,
    staff: /\bstaff\b/,
    'pre-release': /\bpre ?release\b/,
  };
  for (const [stamp, pattern] of Object.entries(stampPatterns)) {
    if (pattern.test(normalizedTitle) !== (subject.printing === stamp))
      return rejectedMatch(['printing stamp mismatch']);
  }
  if (
    /\b(?:gamestop|game stop|eb games|best buy|pokemon together|pokemon league|play pokemon|set logo|w promo)\b/.test(
      normalizedTitle,
    )
  )
    return rejectedMatch(['unsupported printing stamp']);
  if (subject.printing && /\b(?:non|not|no|without|unstamped|un stamped|regular|standard)\b/.test(normalizedTitle))
    return rejectedMatch(['ambiguous printing stamp']);

  if (
    normalizeComparableText(subject.setName ?? '') === 'base set' &&
    /\b(?:base set (?:2|ii)|celebrations?|classic collection|legendary collection|evolutions|anniversary|25th|reprint|world championship|tcg classic|pokemon classic)\b/.test(
      normalizedTitle,
    )
  )
    return rejectedMatch(['set mismatch']);
  const reasons: string[] = [];
  let score = 0;

  if (normalizedName && hasTokenSequence(normalizedTitle, normalizedName)) {
    score += 35;
    reasons.push('name matched');
  } else {
    return rejectedMatch(['card name missing']);
  }

  const numberAliases = buildCollectorNumberAliases(subject);
  const prefixedNumberAliases = numberAliases.filter((alias) => /[a-z]/.test(alias) && /\d/.test(alias));

  const prefixedNumberMatched = prefixedNumberAliases.some((alias) => normalizedTitle.includes(alias));
  if (numberAliases.some((alias) => normalizedTitle.includes(alias))) {
    score += 40;
    reasons.push('number matched');
  }

  const conflictingPrefixedNumber = findConflictingPrefixedCollectorNumber(normalizedTitle, prefixedNumberAliases);
  if (conflictingPrefixedNumber) {
    return rejectedMatch(['collector number mismatch']);
  }

  const setSignals = buildSetSignals(subject);
  if (setSignals.some((signal) => hasTokenSequence(normalizedTitle, signal)) || prefixedNumberMatched) {
    score += 20;
    reasons.push('set matched');
  }

  if (observation.soldAt) {
    score += 5;
    reasons.push('sold comp');
  }

  const rating: PriceMatchRating = score >= 90 ? 'exact' : score >= 70 ? 'strong' : 'weak';

  return {
    score,
    rating,
    rejected: false,
    reasons,
    rejectReasons: [],
  };
}

export function buildBuySignal(input: {
  marketGbpAmount: number | null;
  lowGbpAmount: number | null;
  highGbpAmount: number | null;
  confidence?: 'high' | 'medium' | 'low' | 'unknown';
  trendPoints: Array<{ label: string; gbpAmount: number }>;
}): CardBuySignal | null {
  const market = input.marketGbpAmount;
  if (market == null || !Number.isFinite(market) || market <= 0) return null;

  if (input.confidence !== 'high' && input.confidence !== 'medium')
    return {
      status: 'hold',
      label: 'Thin data',
      reason: 'Price confidence is too low to call the timing.',
    };

  const current = readTrendPoint(input.trendPoints, ['trend', 'now', '1d']) ?? market;
  const avg7 = readTrendPoint(input.trendPoints, ['7d']);
  const avg30 = readTrendPoint(input.trendPoints, ['30d']);

  if (avg30 != null) {
    const ratio = current / avg30;
    if (ratio <= 0.9) {
      return {
        status: 'good',
        label: 'Good time',
        reason: `Current trend is ${formatPercent(1 - ratio)} below 30d average.`,
      };
    }

    if (ratio >= 1.15) {
      return {
        status: 'rising',
        label: 'Rising',
        reason: `Current trend is ${formatPercent(ratio - 1)} above 30d average.`,
      };
    }
  }

  if (avg7 != null) {
    const ratio = current / avg7;
    if (ratio <= 0.92) {
      return {
        status: 'good',
        label: 'Good time',
        reason: `Current trend is ${formatPercent(1 - ratio)} below 7d average.`,
      };
    }

    if (ratio >= 1.1) {
      return {
        status: 'rising',
        label: 'Rising',
        reason: `Current trend is ${formatPercent(ratio - 1)} above 7d average.`,
      };
    }
  }

  if (avg7 == null && avg30 == null) {
    return {
      status: 'hold',
      label: 'Thin data',
      reason: 'Not enough recent history to call the timing.',
    };
  }

  const low = input.lowGbpAmount;
  const high = input.highGbpAmount;
  if (low != null && high != null && market <= low + (high - low) * 0.35) {
    return {
      status: 'fair',
      label: 'Fair',
      reason: 'Market is in the lower part of the current expected range.',
    };
  }

  return {
    status: 'hold',
    label: 'Hold',
    reason: 'Market is close to recent history.',
  };
}

function hardRejectReasons(title: string) {
  const reasons: string[] = [];
  if (MULTI_CARD_PATTERNS.some((pattern) => pattern.test(title))) reasons.push('multi-card selection listing');
  const lotTitle = title.replace(/\blv\.\s*x\b/gi, 'LVX');
  if (LOT_PATTERNS.some((pattern) => pattern.test(lotTitle))) reasons.push('lot or bundle listing');
  if (GRADED_PATTERNS.some((pattern) => pattern.test(title))) reasons.push('graded slab listing');
  if (BAD_PATTERNS.some((pattern) => pattern.test(title))) reasons.push('proxy or custom listing');
  if (OVERSIZED_PATTERNS.some((pattern) => pattern.test(title))) reasons.push('jumbo or oversized card listing');
  return reasons;
}

function findVariantMismatch(variant: PriceSubjectVariant | null, title: string) {
  if (!variant) return null;

  const titleIsReverse = REVERSE_HOLO_PATTERNS.some((pattern) => pattern.test(title));
  const titleIsFirstEdition = FIRST_EDITION_PATTERNS.some((pattern) => pattern.test(title));

  if (variant === 'reverse' ? !titleIsReverse : titleIsReverse) return 'variant mismatch: reverse holo';
  if (variant === '1st-edition' ? !titleIsFirstEdition : titleIsFirstEdition) return 'variant mismatch: 1st edition';
  return null;
}

function rejectedMatch(rejectReasons: string[]): PriceObservationMatch {
  return {
    score: 0,
    rating: 'rejected',
    rejected: true,
    reasons: [],
    rejectReasons,
  };
}

function normalizeComparableText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hasTokenSequence(text: string, needle: string) {
  return ` ${text} `.includes(` ${needle} `);
}

function buildCollectorNumberAliases(subject: PriceSubject) {
  if (!subject.localId) return [];

  const localId = normalizeComparableText(subject.localId);
  const unpaddedLocalId = localId.replace(/^0+/, '') || localId;
  const setId = subject.setId ? normalizeComparableText(subject.setId).replace(/\s+/g, '') : '';
  const aliases = new Set<string>([localId, unpaddedLocalId, `# ${localId}`, `#${localId}`]);

  if (setId) {
    aliases.add(`${setId}${localId}`);
    aliases.add(`${setId}${unpaddedLocalId}`);
    aliases.add(`${setId} ${localId}`);
    aliases.add(`${setId} ${unpaddedLocalId}`);
  }

  return [...aliases].map((alias) => alias.replace(/[^a-z0-9#]+/g, ' ').trim());
}

function buildSetSignals(subject: PriceSubject) {
  return [subject.setId, subject.setName, ...(subject.setAliases ?? [])].flatMap((value) => {
    const text = value ? normalizeComparableText(value) : '';
    // An empty spaced form means the compact form is empty too.
    return text ? [text, text.replace(/\s+/g, '')].filter(Boolean) : [];
  });
}

function findConflictingPrefixedCollectorNumber(normalizedTitle: string, validAliases: string[]) {
  if (validAliases.length === 0) return null;

  const compactTitle = normalizedTitle.replace(/\s+/g, '');
  const validCompacts = new Set(validAliases.map((alias) => alias.replace(/\s+/g, '')));
  const setPrefixes = new Set(
    Array.from(validCompacts).flatMap((alias) => {
      const prefix = alias.replace(/\d+$/, '');
      return prefix ? [prefix] : [];
    }),
  );

  for (const prefix of setPrefixes) {
    // oxlint-disable-next-line react-doctor/js-hoist-regexp -- built from each set prefix
    const matches = compactTitle.match(new RegExp(`${escapeRegExp(prefix)}0*\\d{1,4}`, 'g')) ?? [];
    for (const match of matches) {
      if (!validCompacts.has(match)) {
        return match;
      }
    }
  }

  return null;
}

function readTrendPoint(points: Array<{ label: string; gbpAmount: number }>, labels: string[]) {
  const wanted = new Set(labels.map((label) => label.toLowerCase()));
  const point = [...points].reverse().find((candidate) => wanted.has(candidate.label.toLowerCase()));
  return point && Number.isFinite(point.gbpAmount) ? point.gbpAmount : null;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ObservationFxRates {
  eurToGbp: number;
  usdToGbp: number;
}

export interface PriceObservationSummary {
  marketGbpAmount: number | null;
  goodGbpAmount: number | null;
  lowGbpAmount: number | null;
  highGbpAmount: number | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  usedCount: number;
  soldCount: number;
  excluded: {
    rejected: number;
    weakMatch: number;
    invalidAmount: number;
    currency: number;
    stale: number;
    outlier: number;
  };
}

/** Observations older than this (by soldAt, else observedAt) are ignored. */
export const OBSERVATION_MAX_AGE_DAYS = 90;
/** Below this many usable comps the summary is "low" confidence (low-volume noise). */
export const OBSERVATION_MIN_MEDIUM_COUNT = 3;
/** At least this many comps, mostly sold, with a tight spread, are needed for "high". */
export const OBSERVATION_MIN_HIGH_COUNT = 8;
export const OBSERVATION_HIGH_MAX_SPREAD = 0.35;
/** Robust outlier cut-off in MAD-scaled standard deviations. */
export const OBSERVATION_OUTLIER_MADS = 3;
/** Fallback outlier band (x median) when MAD is degenerate or the sample is tiny. */
export const OBSERVATION_OUTLIER_RATIO = 2;

/**
 * Turns raw provider observations into a GBP market/good/range estimate.
 *
 * Pipeline: match scoring (rejected and weak matches dropped, which also drops variant
 * mismatches, lots, slabs and jumbos) -> positive finite amounts only -> currency conversion
 * (unknown/unusable rate dropped) -> recency window -> robust outlier removal (median/MAD,
 * ratio band fallback) -> percentiles: market = median, good = p25, range = p10..p90.
 * Confidence: 0 comps unknown, <3 low, <8 or wide spread or mostly listings medium, else high.
 */
export function summarizePriceObservations(
  subject: PriceSubject,
  observations: PriceObservation[],
  options: { fxRates: ObservationFxRates; now: number },
): PriceObservationSummary {
  const excluded = { rejected: 0, weakMatch: 0, invalidAmount: 0, currency: 0, stale: 0, outlier: 0 };
  const candidates: Array<{ gbp: number; sold: boolean }> = [];
  const maxAgeMs = OBSERVATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const futureToleranceMs = 24 * 60 * 60 * 1000;

  for (const observation of observations) {
    const match = scorePriceObservationMatch(subject, observation);
    if (match.rejected) {
      excluded.rejected += 1;
      continue;
    }
    if (match.rating === 'weak') {
      excluded.weakMatch += 1;
      continue;
    }

    if (typeof observation.amount !== 'number' || !Number.isFinite(observation.amount) || observation.amount <= 0) {
      excluded.invalidAmount += 1;
      continue;
    }

    const rate =
      observation.currency === 'GBP'
        ? 1
        : observation.currency === 'EUR'
          ? options.fxRates.eurToGbp
          : observation.currency === 'USD'
            ? options.fxRates.usdToGbp
            : NaN;
    if (!Number.isFinite(rate) || rate <= 0) {
      excluded.currency += 1;
      continue;
    }

    const seenAt = Date.parse(observation.soldAt ?? observation.observedAt);
    if (!Number.isFinite(seenAt) || options.now - seenAt > maxAgeMs || seenAt - options.now > futureToleranceMs) {
      excluded.stale += 1;
      continue;
    }

    candidates.push({ gbp: observation.amount * rate, sold: Boolean(observation.soldAt) });
  }

  const inliers = removeOutliers(candidates);
  excluded.outlier = candidates.length - inliers.length;

  if (inliers.length === 0) {
    return {
      marketGbpAmount: null,
      goodGbpAmount: null,
      lowGbpAmount: null,
      highGbpAmount: null,
      confidence: 'unknown',
      usedCount: 0,
      soldCount: 0,
      excluded,
    };
  }

  const amounts = inliers.map((item) => item.gbp).sort((left, right) => left - right);
  const market = percentile(amounts, 0.5);
  const soldCount = inliers.filter((item) => item.sold).length;
  const spread = market > 0 ? (percentile(amounts, 0.75) - percentile(amounts, 0.25)) / market : Infinity;

  const confidence: PriceObservationSummary['confidence'] =
    amounts.length < OBSERVATION_MIN_MEDIUM_COUNT
      ? 'low'
      : amounts.length >= OBSERVATION_MIN_HIGH_COUNT &&
          spread <= OBSERVATION_HIGH_MAX_SPREAD &&
          soldCount * 2 >= amounts.length
        ? 'high'
        : 'medium';

  return {
    marketGbpAmount: roundAmount(market),
    goodGbpAmount: roundAmount(percentile(amounts, 0.25)),
    lowGbpAmount: roundAmount(percentile(amounts, 0.1)),
    highGbpAmount: roundAmount(percentile(amounts, 0.9)),
    confidence,
    usedCount: amounts.length,
    soldCount,
    excluded,
  };
}

/** Robust outlier cut (median/MAD with a 2x-median band) shared by observation and sold-comp summaries. */
export function removeOutliers<T extends { gbp: number }>(items: T[]): T[] {
  if (items.length < 3) return items;

  const sorted = items.map((item) => item.gbp).sort((left, right) => left - right);
  const median = percentile(sorted, 0.5);
  const mad = percentile(
    sorted.map((value) => Math.abs(value - median)).sort((left, right) => left - right),
    0.5,
  );
  const ratioLow = median / OBSERVATION_OUTLIER_RATIO;
  const ratioHigh = median * OBSERVATION_OUTLIER_RATIO;

  if (items.length < 4 || mad === 0) {
    return items.filter((item) => item.gbp >= ratioLow && item.gbp <= ratioHigh);
  }

  const limit = OBSERVATION_OUTLIER_MADS * 1.4826 * mad;
  return items.filter((item) => Math.abs(item.gbp - median) <= limit && item.gbp >= ratioLow && item.gbp <= ratioHigh);
}

function percentile(sortedValues: number[], fraction: number) {
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function roundAmount(amount: number) {
  return Math.round(amount * 100) / 100;
}
