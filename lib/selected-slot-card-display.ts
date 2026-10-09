import type { CardFinish, CardLanguage, WantedCard } from "@/lib/domain/cards"

type SelectedSlotDisplayItem = {
  card_id?: string | null
  card_name?: string | null
  card_image?: string | null
  card_set?: string | null
  card_language?: CardLanguage | null
  card_finish?: CardFinish | null
  wanted_cards?: WantedCard[] | null
}

export type SelectedSlotDisplayCard = {
  cardId: string
  cardName: string
  cardImage?: string
  cardSet?: string
  cardLanguage?: CardLanguage
  cardFinish?: CardFinish
}

function getCurrentCard(item: SelectedSlotDisplayItem | null | undefined): SelectedSlotDisplayCard | null {
  if (!item?.card_id || !item.card_name) {
    return null
  }

  return {
    cardId: item.card_id,
    cardName: item.card_name,
    cardImage: item.card_image ?? undefined,
    cardSet: item.card_set ?? undefined,
    cardLanguage: item.card_language ?? undefined,
    cardFinish: item.card_finish ?? undefined,
  }
}

function getWantedCard(card: WantedCard | null | undefined): SelectedSlotDisplayCard | null {
  if (!card) {
    return null
  }

  return {
    cardId: card.card_id,
    cardName: card.card_name,
    cardImage: card.card_image,
    cardSet: card.card_set,
    cardLanguage: card.card_language,
    cardFinish: card.card_finish,
  }
}

export function getSelectedSlotCardDisplay(item: SelectedSlotDisplayItem | null | undefined) {
  const wantedCard = getWantedCard(item?.wanted_cards?.[0])
  const allocatedCard = getCurrentCard(item)

  return {
    primaryCard: wantedCard ?? allocatedCard,
    currentCard: wantedCard && allocatedCard ? allocatedCard : null,
  }
}
