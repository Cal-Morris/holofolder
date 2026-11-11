import { deduplicateCatalogCards, matchesCatalogCardId } from '@/lib/card-catalog';
import type { CollectedPokemon } from '@/lib/domain/cards';
import type { TCGSetDexSlot, TCGSetSlotCard, TCGSetSlotsResponse } from '@/lib/tcg-set-slots';

export function getSetSlotState(slot: TCGSetDexSlot, item: CollectedPokemon | undefined) {
  const speciesOwned = Boolean(item && item.status !== 'wishlisted');
  const ownedInSet = speciesOwned && slot.cards.some((card) => matchesCatalogCardId(card, item?.card_id));
  const wantedIds = new Set(item?.wanted_cards.map((card) => card.card_id) ?? []);
  if (item?.status === 'wishlisted' && item.card_id) wantedIds.add(item.card_id);
  return {
    ownedInSet,
    ownedElsewhere: speciesOwned && !ownedInSet,
    wantedInSet: slot.cards.some((card) => [...wantedIds].some((id) => matchesCatalogCardId(card, id))),
  };
}

export function getSetCardState(card: TCGSetSlotCard, collection: Iterable<CollectedPokemon>) {
  let owned = false;
  let wanted = false;
  for (const item of collection) {
    if (matchesCatalogCardId(card, item.card_id)) {
      if (item.status === 'wishlisted') wanted = true;
      else owned = true;
    }
    if (item.wanted_cards.some((wantedCard) => matchesCatalogCardId(card, wantedCard.card_id))) wanted = true;
  }
  return { owned, wanted };
}

export function hasWantedSetCard(card: TCGSetSlotCard, item: CollectedPokemon | undefined) {
  return Boolean(
    item?.wanted_cards.some(
      (wanted) =>
        matchesCatalogCardId(card, wanted.card_id) &&
        (wanted.card_language ?? 'en') === card.language &&
        (wanted.card_finish ?? 'normal') === card.inferredFinish,
    ),
  );
}

export function getSetChecklistCards(payload: TCGSetSlotsResponse) {
  return deduplicateCatalogCards(payload.cards ?? payload.slots.flatMap((slot) => slot.cards));
}

export type SetSlotFilter = 'all' | 'open' | 'owned' | 'wanted' | 'multiple';

export function mergeSetSlots(groups: TCGSetDexSlot[][]): TCGSetDexSlot[] {
  const slots = new Map<number, TCGSetDexSlot>();
  for (const group of groups) {
    for (const slot of group) {
      const previous = slots.get(slot.dexId);
      slots.set(slot.dexId, {
        ...slot,
        cards: deduplicateCatalogCards([...(previous?.cards ?? []), ...slot.cards]),
      });
    }
  }
  return [...slots.values()].sort((left, right) => left.dexId - right.dexId);
}

export function matchesSetSlotFilter(slot: TCGSetDexSlot, item: CollectedPokemon | undefined, filter: SetSlotFilter) {
  const owned = Boolean(item && item.status !== 'wishlisted');
  const wanted = Boolean(item?.status === 'wishlisted' || item?.wanted_cards.length);
  return (
    filter === 'all' ||
    (filter === 'open' && !owned) ||
    (filter === 'owned' && owned) ||
    (filter === 'wanted' && wanted && !owned) ||
    (filter === 'multiple' && slot.cards.length > 1)
  );
}
