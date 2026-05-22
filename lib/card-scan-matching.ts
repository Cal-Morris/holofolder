const DEFAULT_MAX_FRAME_MATCHES = 6
const DEFAULT_MAX_RESULTS = 6
const DEFAULT_MINIMUM_APPEARANCES = 1
const DEFAULT_RANK_DECAY = 0.12
const EPSILON = 1e-6

export interface CardScanFrameMatch<TCard> {
  card: TCard
  similarity: number
}

export interface AggregatedCardScanMatch<TCard> {
  card: TCard
  similarity: number
  score: number
  appearances: number
  appearanceRatio: number
  confidence: number
  margin: number
}

export interface AggregateCardScanMatchesOptions<TCard> {
  getCardId: (card: TCard) => string
  minimumAppearances?: number
  minimumFrameSimilarity?: number
  maxFrameMatches?: number
  maxResults?: number
  rankDecay?: number
}

export interface PageSlotScanFrames<TCard> {
  slotIndex: number
  frameMatches: CardScanFrameMatch<TCard>[][]
}

export interface PageSlotScanMatch<TCard> {
  slotIndex: number
  matches: AggregatedCardScanMatch<TCard>[]
}

export interface AggregatePageSlotScanMatchesOptions<TCard> extends Omit<AggregateCardScanMatchesOptions<TCard>, "maxResults"> {
  maxResultsPerSlot?: number
}

interface MutableAggregatedCardScanMatch<TCard> {
  card: TCard
  weightedScore: number
  similaritySum: number
  appearances: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function aggregateCardScanMatches<TCard>(
  frameMatches: CardScanFrameMatch<TCard>[][],
  options: AggregateCardScanMatchesOptions<TCard>,
): AggregatedCardScanMatch<TCard>[] {
  const maxFrameMatches = options.maxFrameMatches ?? DEFAULT_MAX_FRAME_MATCHES
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS
  const minimumAppearances = options.minimumAppearances ?? DEFAULT_MINIMUM_APPEARANCES
  const minimumFrameSimilarity = options.minimumFrameSimilarity ?? 0
  const rankDecay = options.rankDecay ?? DEFAULT_RANK_DECAY
  let usableFrameCount = 0

  const aggregateMap = new Map<string, MutableAggregatedCardScanMatch<TCard>>()

  for (const matches of frameMatches) {
    const bestFrameMatchByCardId = new Map<string, CardScanFrameMatch<TCard> & { index: number }>()

    matches.slice(0, maxFrameMatches).forEach((match, index) => {
      const cardId = options.getCardId(match.card)
      if (!cardId) return
      if (match.similarity < minimumFrameSimilarity) return

      const existing = bestFrameMatchByCardId.get(cardId)
      if (!existing || match.similarity > existing.similarity) {
        bestFrameMatchByCardId.set(cardId, { ...match, index })
      }
    })

    if (bestFrameMatchByCardId.size === 0) {
      continue
    }

    usableFrameCount += 1

    for (const match of bestFrameMatchByCardId.values()) {
      const cardId = options.getCardId(match.card)
      if (!cardId) continue

      const entry = aggregateMap.get(cardId) ?? {
        card: match.card,
        weightedScore: 0,
        similaritySum: 0,
        appearances: 0,
      }
      const rankWeight = Math.max(0.08, 1.2 - match.index * rankDecay)
      const normalizedSimilarity = clamp(match.similarity, 0, 1)

      entry.weightedScore += rankWeight * normalizedSimilarity
      entry.similaritySum += normalizedSimilarity
      entry.appearances += 1
      aggregateMap.set(cardId, entry)
    }
  }

  if (usableFrameCount === 0) {
    return []
  }

  const ranked = [...aggregateMap.values()]
    .filter((entry) => entry.appearances >= minimumAppearances)
    .map((entry) => {
      const similarity = entry.similaritySum / Math.max(entry.appearances, 1)
      const appearanceRatio = entry.appearances / usableFrameCount
      const weightedAverage = entry.weightedScore / Math.max(entry.appearances, 1)
      const score =
        similarity * 0.56 +
        clamp(weightedAverage / 1.2, 0, 1) * 0.22 +
        appearanceRatio * 0.22

      return {
        card: entry.card,
        similarity,
        score,
        appearances: entry.appearances,
        appearanceRatio,
        confidence: 0,
        margin: 0,
      }
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.appearances !== left.appearances) return right.appearances - left.appearances
      return right.similarity - left.similarity
    })

  return ranked.slice(0, maxResults).map((entry, index, entries) => {
    const nextScore = entries[index + 1]?.score ?? 0
    const margin = Math.max(0, entry.score - nextScore)
    const confidence = clamp(
      entry.score * 0.66 +
      entry.appearanceRatio * 0.22 +
      Math.min(0.2, margin) * 0.6 -
      Math.max(0, minimumAppearances - entry.appearances) * 0.08,
      0,
      1,
    )

    return {
      ...entry,
      margin: Number.isFinite(margin) ? margin : 0,
      confidence: Number.isFinite(confidence) ? confidence : EPSILON,
    }
  })
}

export function aggregatePageSlotScanMatches<TCard>(
  slots: PageSlotScanFrames<TCard>[],
  options: AggregatePageSlotScanMatchesOptions<TCard>,
): PageSlotScanMatch<TCard>[] {
  return slots
    .map((slot) => ({
      slotIndex: slot.slotIndex,
      matches: aggregateCardScanMatches(slot.frameMatches, {
        ...options,
        maxResults: options.maxResultsPerSlot ?? DEFAULT_MAX_RESULTS,
      }),
    }))
    .filter((slot) => slot.matches.length > 0)
    .sort((left, right) => left.slotIndex - right.slotIndex)
}
