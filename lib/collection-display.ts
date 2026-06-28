import type { CardFinish, CardLanguage, CollectedPokemon, WantedCard } from "@/hooks/use-collection"

export interface WantedDisplayCard {
  id: string | null
  name: string
  image: string | null
  set: string | null
  language: CardLanguage | null
  finish: CardFinish | null
  isSpecificCard: boolean
}

export function getWantedCardPreview(item: Pick<CollectedPokemon, "wanted_cards"> | null | undefined): WantedCard | null {
  return item?.wanted_cards?.[0] ?? null
}

export function getWantedDisplayCard(
  item: Pick<CollectedPokemon, "wanted_cards"> | null | undefined,
  fallbackName: string,
): WantedDisplayCard {
  const wantedCard = getWantedCardPreview(item)

  if (!wantedCard) {
    return {
      id: null,
      name: fallbackName,
      image: null,
      set: null,
      language: null,
      finish: null,
      isSpecificCard: false,
    }
  }

  return {
    id: wantedCard.card_id,
    name: wantedCard.card_name,
    image: wantedCard.card_image ?? null,
    set: wantedCard.card_set ?? null,
    language: wantedCard.card_language ?? null,
    finish: wantedCard.card_finish ?? null,
    isSpecificCard: true,
  }
}
