import type { CollectedPokemon } from '@/lib/domain/cards';
import type { CheckCompsTarget } from '@/lib/check-comps';

/** Uses the current binder's full collection, independent of view/search filters. */
export function collectionCompsTargets(
  collection: readonly CollectedPokemon[],
  kind: 'wanted' | 'owned',
): CheckCompsTarget[] {
  const cards =
    kind === 'wanted'
      ? collection.flatMap((item) => item.wanted_cards)
      : collection.filter((item) => item.status !== 'wishlisted');
  return cards.flatMap((card) =>
    card.card_id ? [{ cardId: card.card_id, language: card.card_language, finish: card.card_finish }] : [],
  );
}
