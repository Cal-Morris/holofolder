import type { AggregatedCardScanMatch } from './card-scan-matching';
import { scoreCardTextSignals, type CardTextSignals, type TextMatchableCard } from './card-scan-text';

const DEFAULT_MAX_CANDIDATE_ASSET_OCR_CARDS = 18;

export interface SelectCandidateCardsForAssetTextOcrOptions<TCard> {
  getCardId: (card: TCard) => string;
  maxCards?: number;
}

interface CandidateScore<TCard> {
  card: TCard;
  index: number;
  textScore: number;
  visualScore: number;
  score: number;
}

export function selectCandidateCardsForAssetTextOcr<TCard extends TextMatchableCard>(
  candidateCards: TCard[],
  visualMatches: Array<Pick<AggregatedCardScanMatch<TCard>, 'card' | 'similarity'>>,
  querySignals: CardTextSignals | null | undefined,
  options: SelectCandidateCardsForAssetTextOcrOptions<TCard>,
) {
  const maxCards = Math.max(0, options.maxCards ?? DEFAULT_MAX_CANDIDATE_ASSET_OCR_CARDS);
  if (maxCards === 0 || candidateCards.length === 0) return [];

  const visualScoreByCardId = new Map<string, number>();
  visualMatches.forEach((match, index) => {
    const cardId = options.getCardId(match.card);
    if (!cardId) return;

    const rankWeight = Math.max(0.18, 1 - index * 0.08);
    const visualScore = Math.max(0, Math.min(1, match.similarity)) * rankWeight;
    visualScoreByCardId.set(cardId, Math.max(visualScoreByCardId.get(cardId) ?? 0, visualScore));
  });

  const scoredCandidates: CandidateScore<TCard>[] = candidateCards.map((card, index) => {
    const cardId = options.getCardId(card);
    const textScore = scoreCardTextSignals(querySignals, card);
    const visualScore = cardId ? (visualScoreByCardId.get(cardId) ?? 0) : 0;
    const stableBias = 1 / Math.max(candidateCards.length + index + 1, 1);

    return {
      card,
      index,
      textScore,
      visualScore,
      score: textScore * 3 + visualScore * 0.35 + stableBias * 0.001,
    };
  });

  return scoredCandidates
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.textScore !== left.textScore) return right.textScore - left.textScore;
      if (right.visualScore !== left.visualScore) return right.visualScore - left.visualScore;
      return left.index - right.index;
    })
    .slice(0, maxCards)
    .map((entry) => entry.card);
}
