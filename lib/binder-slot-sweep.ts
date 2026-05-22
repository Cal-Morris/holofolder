import { aggregateCardScanMatches, type AggregatedCardScanMatch, type CardScanFrameMatch } from "./card-scan-matching"

const DEFAULT_MINIMUM_FRAMES_PER_SLOT = 2
const DEFAULT_MINIMUM_APPEARANCE_RATIO = 0.45
const DEFAULT_MINIMUM_CONFIDENCE = 0.56
const DEFAULT_MINIMUM_SIMILARITY = 0.58
const DEFAULT_MAX_RESULTS_PER_SLOT = 6

export type BinderSlotSweepState = "empty" | "needs-more-frames" | "uncertain" | "matched"

export interface BinderSlotSweepFrame<TCard> {
  slotIndex: number
  matches: CardScanFrameMatch<TCard>[]
}

export interface BinderSlotSweepSlot<TCard> {
  slotIndex: number
  frames: number
  usableFrames: number
  state: BinderSlotSweepState
  match: AggregatedCardScanMatch<TCard> | null
  matches: AggregatedCardScanMatch<TCard>[]
}

export interface BinderSlotSweepResult<TCard> {
  slots: BinderSlotSweepSlot<TCard>[]
  scannedSlots: number
  matchedSlots: number
}

export interface AggregateBinderSlotSweepOptions<TCard> {
  slotCount: number
  getCardId: (card: TCard) => string
  minimumFramesPerSlot?: number
  minimumAppearanceRatio?: number
  minimumFrameSimilarity?: number
  minimumConfidence?: number
  minimumSimilarity?: number
  maxResultsPerSlot?: number
}

function clampIndex(index: number, slotCount: number) {
  if (!Number.isFinite(index)) return null
  if (index < 0 || index >= slotCount) return null
  return Math.floor(index)
}

function hasUsableFrameMatch<TCard>(matches: CardScanFrameMatch<TCard>[], minimumFrameSimilarity: number) {
  return matches.some((match) => match.similarity >= minimumFrameSimilarity)
}

export function aggregateBinderSlotSweep<TCard>(
  frames: BinderSlotSweepFrame<TCard>[],
  options: AggregateBinderSlotSweepOptions<TCard>,
): BinderSlotSweepResult<TCard> {
  const slotCount = Math.max(0, options.slotCount)
  const minimumFramesPerSlot = options.minimumFramesPerSlot ?? DEFAULT_MINIMUM_FRAMES_PER_SLOT
  const minimumAppearanceRatio = options.minimumAppearanceRatio ?? DEFAULT_MINIMUM_APPEARANCE_RATIO
  const minimumFrameSimilarity = options.minimumFrameSimilarity ?? 0
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE
  const minimumSimilarity = options.minimumSimilarity ?? DEFAULT_MINIMUM_SIMILARITY
  const maxResultsPerSlot = options.maxResultsPerSlot ?? DEFAULT_MAX_RESULTS_PER_SLOT
  const frameMatchesBySlot = new Map<number, CardScanFrameMatch<TCard>[][]>()

  for (const frame of frames) {
    const slotIndex = clampIndex(frame.slotIndex, slotCount)
    if (slotIndex === null) continue

    const slotFrames = frameMatchesBySlot.get(slotIndex) ?? []
    slotFrames.push(frame.matches)
    frameMatchesBySlot.set(slotIndex, slotFrames)
  }

  const slots = Array.from({ length: slotCount }, (_, slotIndex): BinderSlotSweepSlot<TCard> => {
    const slotFrames = frameMatchesBySlot.get(slotIndex) ?? []
    const usableFrames = slotFrames.filter((matches) => hasUsableFrameMatch(matches, minimumFrameSimilarity)).length
    const minimumAppearances = Math.max(1, Math.ceil(Math.max(usableFrames, 1) * minimumAppearanceRatio))
    const matches = aggregateCardScanMatches(slotFrames, {
      getCardId: options.getCardId,
      minimumAppearances,
      minimumFrameSimilarity,
      maxResults: maxResultsPerSlot,
    })
    const match = matches[0] ?? null

    if (slotFrames.length < minimumFramesPerSlot) {
      return {
        slotIndex,
        frames: slotFrames.length,
        usableFrames,
        state: "needs-more-frames",
        match,
        matches,
      }
    }

    if (usableFrames === 0) {
      return {
        slotIndex,
        frames: slotFrames.length,
        usableFrames,
        state: "empty",
        match: null,
        matches: [],
      }
    }

    const isMatched =
      Boolean(match) &&
      match.confidence >= minimumConfidence &&
      match.similarity >= minimumSimilarity &&
      match.appearanceRatio >= minimumAppearanceRatio

    return {
      slotIndex,
      frames: slotFrames.length,
      usableFrames,
      state: isMatched ? "matched" : "uncertain",
      match,
      matches,
    }
  })

  return {
    slots,
    scannedSlots: slots.filter((slot) => slot.frames >= minimumFramesPerSlot).length,
    matchedSlots: slots.filter((slot) => slot.state === "matched").length,
  }
}

export function getNextSweepSlotIndex<TSlot>(
  slots: Array<TSlot | null | undefined>,
  currentIndex: number,
  completedSlotIndexes: Set<number>,
) {
  for (let index = currentIndex + 1; index < slots.length; index += 1) {
    if (slots[index] && !completedSlotIndexes.has(index)) return index
  }

  for (let index = 0; index <= currentIndex && index < slots.length; index += 1) {
    if (slots[index] && !completedSlotIndexes.has(index)) return index
  }

  return null
}
