export interface SlotPreviewCandidateCard {
  id?: string | null
  name?: string | null
  image?: string | null
  set?: {
    id?: string | null
    name?: string | null
  } | null
  variants?: {
    normal?: boolean
    reverse?: boolean
    holo?: boolean
    firstEdition?: boolean
    wPromo?: boolean
    jumbo?: boolean
  } | null
  rarity?: string | null
}

export interface SlotPreviewCard {
  cardId: string | null
  image: string
  name: string | null
}

export function normalizeSlotPreviewImage(image: string | null | undefined) {
  const trimmedImage = image?.trim()
  return trimmedImage ? trimmedImage : null
}

export function pickRepresentativeSlotPreviewCard(cards: SlotPreviewCandidateCard[]): SlotPreviewCard | null {
  const rankedCards = cards
    .map((card, index) => ({ card, index, image: normalizeSlotPreviewImage(card.image) }))
    .filter((entry): entry is { card: SlotPreviewCandidateCard; index: number; image: string } => Boolean(entry.image))
    .sort((a, b) => getSlotPreviewCardRank(a.card, a.index) - getSlotPreviewCardRank(b.card, b.index))

  const selectedCard = rankedCards[0]
  if (!selectedCard) {
    return null
  }

  return {
    cardId: selectedCard.card.id ?? null,
    image: selectedCard.image,
    name: selectedCard.card.name ?? null,
  }
}

function getSlotPreviewCardRank(card: SlotPreviewCandidateCard, index: number) {
  const setId = card.set?.id?.toLowerCase() ?? ""
  const rarity = card.rarity?.toLowerCase() ?? ""
  const variants = card.variants ?? {}
  let score = index

  if (setId === "jumbo" || variants.jumbo) {
    score += 600
  }

  if (rarity.includes("promo") || variants.wPromo) {
    score += 40
  }

  if (variants.normal) {
    score -= 20
  } else if (variants.holo) {
    score -= 10
  }

  return score
}
