import type { WantedCard } from '@/lib/domain/cards';

export function wantedCardKey(card: Pick<WantedCard, 'card_id' | 'card_language' | 'card_finish'>) {
  return `${card.card_id}:${card.card_language ?? 'en'}:${card.card_finish ?? 'normal'}`;
}
