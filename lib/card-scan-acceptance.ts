const DEFAULT_MINIMUM_SIMILARITY = 0.58
const DEFAULT_MINIMUM_CONFIDENCE = 0.62
const DEFAULT_MINIMUM_CLEAR_MARGIN = 0.045
const DEFAULT_STRONG_SIMILARITY = 0.68
const DEFAULT_STRONG_CONFIDENCE = 0.82
const DEFAULT_STRONG_APPEARANCE_RATIO = 0.72

export type CardScanAutoAcceptReason =
  | "clear-margin"
  | "strong-repeat"
  | "weak-similarity"
  | "weak-confidence"
  | "ambiguous-margin"

export interface CardScanAutoAcceptInput {
  similarity: number
  confidence: number
  margin?: number
  appearanceRatio?: number
}

export interface CardScanAutoAcceptOptions {
  minimumSimilarity?: number
  minimumConfidence?: number
  minimumClearMargin?: number
  strongSimilarity?: number
  strongConfidence?: number
  strongAppearanceRatio?: number
}

export interface CardScanAutoAcceptDecision {
  autoAccept: boolean
  reason: CardScanAutoAcceptReason
}

export function evaluateCardScanAutoAccept(
  match: CardScanAutoAcceptInput,
  options: CardScanAutoAcceptOptions = {},
): CardScanAutoAcceptDecision {
  const minimumSimilarity = options.minimumSimilarity ?? DEFAULT_MINIMUM_SIMILARITY
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE
  const minimumClearMargin = options.minimumClearMargin ?? DEFAULT_MINIMUM_CLEAR_MARGIN
  const strongSimilarity = options.strongSimilarity ?? DEFAULT_STRONG_SIMILARITY
  const strongConfidence = options.strongConfidence ?? DEFAULT_STRONG_CONFIDENCE
  const strongAppearanceRatio = options.strongAppearanceRatio ?? DEFAULT_STRONG_APPEARANCE_RATIO
  const margin = match.margin ?? 0
  const appearanceRatio = match.appearanceRatio ?? 0

  if (match.similarity < minimumSimilarity) {
    return { autoAccept: false, reason: "weak-similarity" }
  }

  if (match.confidence < minimumConfidence) {
    return { autoAccept: false, reason: "weak-confidence" }
  }

  if (margin >= minimumClearMargin) {
    return { autoAccept: true, reason: "clear-margin" }
  }

  if (
    match.similarity >= strongSimilarity &&
    match.confidence >= strongConfidence &&
    appearanceRatio >= strongAppearanceRatio
  ) {
    return { autoAccept: true, reason: "strong-repeat" }
  }

  return { autoAccept: false, reason: "ambiguous-margin" }
}

export function canAutoAcceptCardScanMatch(match: CardScanAutoAcceptInput, options?: CardScanAutoAcceptOptions) {
  return evaluateCardScanAutoAccept(match, options).autoAccept
}
