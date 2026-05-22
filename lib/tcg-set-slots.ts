import type { CardFinish, CardLanguage } from "@/hooks/use-collection"

export interface TCGSetSummary {
  id: string
  name: string
  seriesName?: string
  officialCardCount?: number
  releaseDate?: string
}

export interface TCGSetSlotCard {
  id: string
  localId: string
  name: string
  image?: string
  language: CardLanguage
  set: TCGSetSummary
  rarity?: string
  variants?: {
    normal?: boolean
    reverse?: boolean
    holo?: boolean
    firstEdition?: boolean
    wPromo?: boolean
  }
  inferredFinish: CardFinish
}

export interface TCGSetDexSlot {
  dexId: number
  pokemonName: string
  cards: TCGSetSlotCard[]
}

export interface TCGSetSlotsResponse {
  sets: TCGSetSummary[]
  selectedSet: TCGSetSummary | null
  slots: TCGSetDexSlot[]
}
