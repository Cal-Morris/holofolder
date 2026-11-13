export interface SearchableCard {
  id: string;
  localId: string;
  name: string;
  set: {
    id: string;
    name: string;
    officialCardCount?: number;
  };
  rarity?: string;
  types?: string[];
  illustrator?: string;
  variants?: {
    normal?: boolean;
    reverse?: boolean;
    holo?: boolean;
    firstEdition?: boolean;
    wPromo?: boolean;
    jumbo?: boolean;
  };
}

export interface CardSearchFilters {
  set?: string;
  rarity?: string;
  variant?: string;
  searchQuery?: string;
}

interface CardSearchDocument<TCard extends SearchableCard> {
  card: TCard;
  localNumber: string | null;
  setTotal: string | null;
  fullCollectorNumber: string | null;
  exactTokens: Set<string>;
  fields: Array<{ value: string; weight: number }>;
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNumber(value: string | number | null | undefined) {
  if (value == null) return null;
  const match = String(value).match(/\d+/);
  if (!match) return null;

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function normalizeCollectorNumber(value: string) {
  const [left, right] = value.split('/');
  const localNumber = normalizeNumber(left);
  const setTotal = normalizeNumber(right);

  return {
    localNumber,
    setTotal,
    fullCollectorNumber: localNumber && setTotal ? `${localNumber}/${setTotal}` : null,
  };
}

function getWords(value: string) {
  return normalizeText(value)
    .split(/[\s/.-]+/)
    .filter(Boolean);
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

function scoreWordAgainstField(word: string, fieldValue: string) {
  if (!word || !fieldValue) return 0;
  if (fieldValue === word) return 1;
  if (fieldValue.includes(word)) return 0.92;

  const fieldWords = getWords(fieldValue);
  let bestScore = 0;

  for (const fieldWord of fieldWords) {
    if (fieldWord === word) return 1;
    if (fieldWord.startsWith(word) || word.startsWith(fieldWord)) {
      bestScore = Math.max(bestScore, 0.86);
      continue;
    }

    if (word.length >= 4 && fieldWord.length >= 4) {
      const distance = levenshteinDistance(word, fieldWord);
      const maxDistance = Math.min(word.length, fieldWord.length) >= 7 ? 2 : 1;
      if (distance <= maxDistance) {
        bestScore = Math.max(bestScore, distance === 1 ? 0.78 : 0.68);
      }
    }
  }

  return bestScore;
}

function buildSearchDocument<TCard extends SearchableCard>(card: TCard): CardSearchDocument<TCard> {
  const collectorNumber = normalizeCollectorNumber(card.localId);
  const setTotal = normalizeNumber(card.set.officialCardCount);
  const fullCollectorNumber =
    collectorNumber.localNumber && setTotal
      ? `${collectorNumber.localNumber}/${setTotal}`
      : collectorNumber.fullCollectorNumber;
  const exactTokens = new Set<string>();
  const addExactTokens = (value?: string | null) => {
    if (!value) return;
    for (const word of getWords(value)) {
      exactTokens.add(word);
    }
  };

  addExactTokens(card.name);
  addExactTokens(card.set.name);
  addExactTokens(card.set.id);
  addExactTokens(card.rarity);
  addExactTokens(card.illustrator);
  card.types?.forEach(addExactTokens);
  if (card.variants?.jumbo) {
    for (const token of ['jumbo', 'oversized', 'starter', 'partner', 'first']) {
      exactTokens.add(token);
    }
  }
  if (collectorNumber.localNumber) exactTokens.add(collectorNumber.localNumber);
  if (setTotal) exactTokens.add(setTotal);
  if (fullCollectorNumber) exactTokens.add(fullCollectorNumber);

  return {
    card,
    localNumber: collectorNumber.localNumber,
    setTotal,
    fullCollectorNumber,
    exactTokens,
    fields: [
      { value: normalizeText(card.name), weight: 9 },
      { value: normalizeText(card.set.name), weight: 8 },
      { value: normalizeText(card.set.id), weight: 7 },
      { value: normalizeText(card.localId), weight: 10 },
      { value: fullCollectorNumber || '', weight: 10 },
      { value: normalizeText(card.rarity || ''), weight: 5 },
      { value: normalizeText(card.illustrator || ''), weight: 4 },
      { value: card.variants?.jumbo ? 'jumbo oversized starter partner first partner' : '', weight: 3 },
      ...(card.types || []).map((type) => ({ value: normalizeText(type), weight: 5 })),
    ],
  };
}

function passesStructuredFilters(card: SearchableCard, filters: CardSearchFilters) {
  if (filters.set && card.set.id !== filters.set) return false;
  if (filters.rarity && card.rarity !== filters.rarity) return false;

  if (filters.variant) {
    if (filters.variant === 'normal' && !card.variants?.normal) return false;
    if (filters.variant === 'reverse' && !card.variants?.reverse) return false;
    if (filters.variant === 'holo' && !card.variants?.holo) return false;
    if (filters.variant === 'firstEdition' && !card.variants?.firstEdition) return false;
    if (filters.variant === 'jumbo' && !card.variants?.jumbo) return false;
  }

  return true;
}

function scoreQuery<TCard extends SearchableCard>(document: CardSearchDocument<TCard>, rawQuery: string) {
  const query = normalizeText(rawQuery);
  if (!query) return 1;

  const collectorQuery = query.match(/^(\d{1,4})\s*\/\s*(\d{1,4})$/);
  if (collectorQuery) {
    const localNumber = normalizeNumber(collectorQuery[1]);
    const setTotal = normalizeNumber(collectorQuery[2]);
    return localNumber === document.localNumber && setTotal === document.setTotal ? 100 : 0;
  }

  const words = getWords(query);
  if (words.length === 0) return 1;

  const isNumericOnlyQuery = words.every((word) => /^\d+$/.test(word));
  if (isNumericOnlyQuery) {
    return words.every((word) => normalizeNumber(word) === document.localNumber) ? 90 : 0;
  }

  let score = 0;

  for (const word of words) {
    let bestWeightedScore = 0;

    for (const field of document.fields) {
      const wordScore = scoreWordAgainstField(word, field.value);
      bestWeightedScore = Math.max(bestWeightedScore, wordScore * field.weight);
    }

    if (bestWeightedScore < 2.5) {
      return 0;
    }

    score += bestWeightedScore;
  }

  if (document.fields.some((field) => field.value.includes(query))) {
    score += 12;
  }

  for (const word of words) {
    if (document.exactTokens.has(word)) {
      score += 2;
    }
  }

  return score;
}

function compareCardsByLocalId(left: SearchableCard, right: SearchableCard) {
  return left.localId.localeCompare(right.localId, undefined, { numeric: true, sensitivity: 'base' });
}

export function filterAndRankCards<TCard extends SearchableCard>(cards: TCard[], filters: CardSearchFilters): TCard[] {
  const matchingCards = cards.filter((card) => passesStructuredFilters(card, filters));
  const query = filters.searchQuery?.trim();

  if (!query) {
    return matchingCards;
  }

  return matchingCards
    .flatMap((card) => {
      const score = scoreQuery(buildSearchDocument(card), query);
      return score > 0 ? [{ card, score }] : [];
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return compareCardsByLocalId(left.card, right.card);
    })
    .map((match) => match.card);
}
