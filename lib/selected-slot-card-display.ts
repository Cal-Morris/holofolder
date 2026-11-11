import type { CardFinish, CardLanguage, SlotStatus, WantedCard } from '@/lib/domain/cards';

type SelectedSlotDisplayItem = {
  card_id?: string | null;
  card_name?: string | null;
  card_image?: string | null;
  card_set?: string | null;
  card_language?: CardLanguage | null;
  card_finish?: CardFinish | null;
  status?: SlotStatus;
  wanted_cards?: WantedCard[] | null;
};

export type SelectedSlotDisplayCard = {
  cardId: string;
  cardName: string;
  cardImage?: string;
  cardSet?: string;
  cardLanguage?: CardLanguage;
  cardFinish?: CardFinish;
};

function getCurrentCard(item: SelectedSlotDisplayItem | null | undefined): SelectedSlotDisplayCard | null {
  if (!item?.card_id || !item.card_name) {
    return null;
  }

  return {
    cardId: item.card_id,
    cardName: item.card_name,
    cardImage: item.card_image ?? undefined,
    cardSet: item.card_set ?? undefined,
    cardLanguage: item.card_language ?? undefined,
    cardFinish: item.card_finish ?? undefined,
  };
}

export function getSelectedSlotCardDisplay(
  item: SelectedSlotDisplayItem | null | undefined,
  display: BinderCardDisplay,
  wantedCard?: WantedCard | null,
) {
  return {
    primaryCard: getCurrentCard(wantedCard ?? getBinderDisplayCard(item, display)),
    currentCard: getCurrentCard(getBinderDisplayCard(item, 'current')),
  };
}

export type BinderCardDisplay = 'mixed' | 'current' | 'wanted';

export function getBinderDisplayCard(item: SelectedSlotDisplayItem | null | undefined, display: BinderCardDisplay) {
  if (display !== 'current' && item?.wanted_cards?.[0]) return item.wanted_cards[0];
  return item?.card_id &&
    (display === 'mixed' || (display === 'wanted' ? item.status === 'wishlisted' : item.status !== 'wishlisted'))
    ? item
    : null;
}
