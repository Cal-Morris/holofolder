import { rerankAggregatedCardScanMatches, type AggregatedCardScanMatch } from "./card-scan-matching"
import {
  applyCardTextSignalBoost,
  type CardTextSignals,
  type TextMatchableCard,
} from "./card-scan-text"

export interface RankAggregatedCardScanMatchesWithTextOptions<TCard> {
  candidateCards?: TCard[]
  candidateTextSignals?: Map<string, CardTextSignals | null | undefined>
  getCardId: (card: TCard) => string
}

export function rankAggregatedCardScanMatchesWithText<TCard extends TextMatchableCard>(
  matches: AggregatedCardScanMatch<TCard>[],
  textSignals: CardTextSignals | null | undefined,
  options: RankAggregatedCardScanMatchesWithTextOptions<TCard>,
): AggregatedCardScanMatch<TCard>[] {
  if (!textSignals) {
    return matches
  }

  const matchByCardId = new Map(matches.map((match) => [options.getCardId(match.card), match]))
  const boostedMatches = applyCardTextSignalBoost(matches, textSignals, {
    candidateCards: options.candidateCards,
    candidateTextSignals: options.candidateTextSignals,
    getCardId: options.getCardId,
  }).map((match): AggregatedCardScanMatch<TCard> => {
    const originalMatch = matchByCardId.get(options.getCardId(match.card))

    if (!originalMatch) {
      return {
        card: match.card,
        similarity: match.similarity,
        score: match.similarity,
        appearances: 1,
        appearanceRatio: 1,
        confidence: Math.min(1, 0.52 + match.textScore * 0.24),
        margin: 0,
      }
    }

    return {
      ...originalMatch,
      similarity: match.similarity,
      confidence: Math.min(1, originalMatch.confidence + match.textScore * 0.12),
    }
  })

  return rerankAggregatedCardScanMatches(boostedMatches)
}
