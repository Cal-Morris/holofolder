/**
 * Sort options for the card picker (Add card / Wanted). Pure, so the picker and unit tests share it.
 * Price sorts use the region-weighted market price (falling back to the "good" low price) for the
 * finish chosen in the picker, and always put unpriced cards last.
 */
import type { CardPriceSnapshot, PricedCardFinish } from "@/lib/card-pricing"
import type { CardFinish } from "@/lib/domain/cards"
import { getRegionalFinishPrices } from "@/lib/regional-price"
import type { PricingRegion } from "@/lib/pricing-region"

export type CardPickerSort = "default" | "price-desc" | "price-asc" | "newest" | "oldest"

export const CARD_PICKER_SORTS: Array<{ id: CardPickerSort; label: string }> = [
  { id: "default", label: "Best match" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "newest", label: "Newest set" },
  { id: "oldest", label: "Oldest set" },
]

export const CARD_PICKER_SORT_STORAGE_KEY = "binderdex_card_picker_sort"

export function normalizeCardPickerSort(value: unknown): CardPickerSort {
  return CARD_PICKER_SORTS.some((option) => option.id === value) ? value as CardPickerSort : "default"
}

/** The choice is remembered for the browser session only. */
export function readCardPickerSort(): CardPickerSort {
  try {
    return normalizeCardPickerSort(sessionStorage.getItem(CARD_PICKER_SORT_STORAGE_KEY))
  } catch {
    return "default"
  }
}

export function saveCardPickerSort(sort: CardPickerSort) {
  try {
    sessionStorage.setItem(CARD_PICKER_SORT_STORAGE_KEY, sort)
  } catch {
    // Private mode or storage disabled: the sort still applies for this sheet.
  }
}

function positive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

const PRICED_FINISHES = new Set<CardFinish>(["normal", "holo", "reverse_holo"])

/**
 * The amount a card is ranked by: the selected finish's own quote when one exists, else the card's
 * headline quote. Market price first, then the "good" (L) price. Null when unpriced.
 */
export function getCardPickerSortAmount(price: CardPriceSnapshot | undefined, finish: CardFinish, region: PricingRegion) {
  if (!price) return null
  const finishPrice = PRICED_FINISHES.has(finish) ? getRegionalFinishPrices(price, region)[finish as PricedCardFinish] : undefined
  for (const quote of [finishPrice, price]) {
    const amount = positive(quote?.marketGbpAmount ?? quote?.gbpAmount) ?? positive(quote?.goodGbpAmount)
    if (amount != null) return amount
  }
  return null
}

interface SortableCard {
  localId: string
  set: { id: string; releaseDate?: string }
}

function compareReleaseDate(a: SortableCard, b: SortableCard, direction: 1 | -1) {
  const aDate = a.set.releaseDate ?? ""
  const bDate = b.set.releaseDate ?? ""
  if (aDate === bDate) return 0
  if (!aDate) return 1
  if (!bDate) return -1
  return aDate.localeCompare(bDate) * direction
}

function compareNumber(a: SortableCard, b: SortableCard) {
  return a.set.id.localeCompare(b.set.id) || a.localId.localeCompare(b.localId, undefined, { numeric: true, sensitivity: "base" })
}

/**
 * Returns `cards` in the chosen order. "default" (Best match) puts the most likely picks first: cards
 * `likelyRank` ranks (lower first, e.g. the slot's wanted or current card), then newest set first.
 */
export function sortCardPickerCards<TCard extends SortableCard>(
  cards: readonly TCard[],
  sort: CardPickerSort,
  amountOf: (card: TCard) => number | null,
  likelyRank: (card: TCard) => number = () => Number.POSITIVE_INFINITY,
): TCard[] {
  if (sort === "default") {
    const ranks = new Map(cards.map((card) => [card, likelyRank(card)]))
    return [...cards].sort((a, b) => {
      const aRank = ranks.get(a) ?? Number.POSITIVE_INFINITY
      const bRank = ranks.get(b) ?? Number.POSITIVE_INFINITY
      if (aRank !== bRank) return aRank < bRank ? -1 : 1
      return compareReleaseDate(a, b, -1) || compareNumber(a, b)
    })
  }
  if (sort === "newest" || sort === "oldest") {
    const direction = sort === "newest" ? -1 : 1
    return [...cards].sort((a, b) => compareReleaseDate(a, b, direction) || compareNumber(a, b))
  }
  const amounts = new Map(cards.map((card) => [card, amountOf(card)]))
  return [...cards].sort((a, b) => {
    const aAmount = amounts.get(a) ?? null
    const bAmount = amounts.get(b) ?? null
    if (aAmount === bAmount) return 0
    if (aAmount == null) return 1
    if (bAmount == null) return -1
    return sort === "price-desc" ? bAmount - aAmount : aAmount - bAmount
  })
}
