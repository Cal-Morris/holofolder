import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { WantedCard } from "@/hooks/use-collection"

export type WantedDashboardSort = "highest" | "lowest" | "dex" | "set" | "newest" | "unpriced"
export type WantedDashboardPriceBandId = "under-5" | "five-to-15" | "fifteen-to-50" | "over-50" | "unpriced"

export interface WantedDashboardEntry {
  pokemonId: number
  pokemonName: string
  card: WantedCard
}

export interface WantedDashboardCard extends WantedDashboardEntry {
  key: string
  price: CardPriceSnapshot | undefined
  marketGbpAmount: number | null
  goodGbpAmount: number | null
  effectiveGbpAmount: number | null
  isPriced: boolean
  priceBandId: WantedDashboardPriceBandId
}

export interface WantedDashboardPriceBand {
  id: WantedDashboardPriceBandId
  label: string
  count: number
  totalGbp: number
}

export interface WantedDashboardBreakdown {
  label: string
  count: number
  totalGbp: number
}

export interface WantedDashboardSummary {
  cards: WantedDashboardCard[]
  totalCards: number
  pricedCount: number
  unpricedCount: number
  marketTotalGbp: number
  averageGbp: number | null
  highestCards: WantedDashboardCard[]
  unpricedCards: WantedDashboardCard[]
  priceBands: WantedDashboardPriceBand[]
  setBreakdown: WantedDashboardBreakdown[]
  languageBreakdown: WantedDashboardBreakdown[]
  finishBreakdown: WantedDashboardBreakdown[]
}

export const WANTED_PRICE_BAND_LABELS: Record<WantedDashboardPriceBandId, string> = {
  "under-5": "Under £5",
  "five-to-15": "£5-£15",
  "fifteen-to-50": "£15-£50",
  "over-50": "£50+",
  unpriced: "Unpriced",
}

const PRICE_BANDS: Array<Pick<WantedDashboardPriceBand, "id" | "label">> = [
  { id: "under-5", label: WANTED_PRICE_BAND_LABELS["under-5"] },
  { id: "five-to-15", label: WANTED_PRICE_BAND_LABELS["five-to-15"] },
  { id: "fifteen-to-50", label: WANTED_PRICE_BAND_LABELS["fifteen-to-50"] },
  { id: "over-50", label: WANTED_PRICE_BAND_LABELS["over-50"] },
  { id: "unpriced", label: WANTED_PRICE_BAND_LABELS.unpriced },
]

const SUPPORTED_CARD_LANGUAGES = ["en", "fr", "de", "es", "it", "pt-br", "ja", "ko"]

export function buildWantedDashboardSummary(
  entries: WantedDashboardEntry[],
  pricesByCardKey: Record<string, CardPriceSnapshot>,
): WantedDashboardSummary {
  const cards = entries.map((entry) => {
    const language = entry.card.card_language ?? "en"
    const price = pricesByCardKey[getWantedCardPriceKey(entry.card.card_id, language)]
    const marketGbpAmount = getWantedPriceAmount(price)
    const goodGbpAmount = normalizePriceAmount(price?.goodGbpAmount)
    const isPriced = marketGbpAmount != null

    return {
      ...entry,
      key: [
        entry.pokemonId,
        entry.card.card_id,
        language,
        entry.card.card_finish ?? "normal",
        entry.card.added_at,
      ].join("::"),
      price,
      marketGbpAmount,
      goodGbpAmount,
      effectiveGbpAmount: marketGbpAmount,
      isPriced,
      priceBandId: getWantedPriceBandId(marketGbpAmount),
    }
  })

  const priceBands = PRICE_BANDS.map((band) => ({
    ...band,
    count: 0,
    totalGbp: 0,
  }))
  const bandById = new Map(priceBands.map((band) => [band.id, band]))
  const setGroups = new Map<string, WantedDashboardBreakdown>()
  const languageGroups = new Map<string, WantedDashboardBreakdown>()
  const finishGroups = new Map<string, WantedDashboardBreakdown>()
  let marketTotalGbp = 0
  let pricedCount = 0

  for (const card of cards) {
    const amount = card.effectiveGbpAmount ?? 0
    const band = bandById.get(card.priceBandId)
    if (band) {
      band.count += 1
      band.totalGbp = roundMoney(band.totalGbp + amount)
    }

    if (card.effectiveGbpAmount != null) {
      pricedCount += 1
      marketTotalGbp = roundMoney(marketTotalGbp + card.effectiveGbpAmount)
    }

    incrementBreakdown(setGroups, card.card.card_set || "Unknown set", amount)
    incrementBreakdown(languageGroups, card.card.card_language ?? "en", amount)
    incrementBreakdown(finishGroups, card.card.card_finish ?? "normal", amount)
  }

  return {
    cards,
    totalCards: cards.length,
    pricedCount,
    unpricedCount: cards.length - pricedCount,
    marketTotalGbp,
    averageGbp: pricedCount > 0 ? roundMoney(marketTotalGbp / pricedCount) : null,
    highestCards: sortWantedDashboardEntries(cards, "highest").filter((card) => card.isPriced).slice(0, 5),
    unpricedCards: cards.filter((card) => !card.isPriced).slice(0, 5),
    priceBands,
    setBreakdown: sortBreakdown(setGroups),
    languageBreakdown: sortBreakdown(languageGroups),
    finishBreakdown: sortBreakdown(finishGroups),
  }
}

export function sortWantedDashboardEntries(
  cards: WantedDashboardCard[],
  sort: WantedDashboardSort,
): WantedDashboardCard[] {
  return [...cards].sort((left, right) => {
    if (sort === "highest") {
      return comparePriceDescending(left, right) || compareDex(left, right)
    }

    if (sort === "lowest") {
      return comparePriceAscending(left, right) || compareDex(left, right)
    }

    if (sort === "unpriced") {
      return Number(left.isPriced) - Number(right.isPriced) || comparePriceDescending(left, right) || compareDex(left, right)
    }

    if (sort === "dex") {
      return compareDex(left, right)
    }

    if (sort === "set") {
      return (left.card.card_set || "").localeCompare(right.card.card_set || "") ||
        compareDex(left, right) ||
        left.card.card_name.localeCompare(right.card.card_name)
    }

    return compareNewest(left, right) || compareDex(left, right)
  })
}

function getWantedCardPriceKey(cardId: string, language: unknown = "en") {
  const normalized = typeof language === "string" ? language.trim().toLowerCase() : "en"
  const safeLanguage = SUPPORTED_CARD_LANGUAGES.includes(normalized) ? normalized : "en"
  return `${cardId}::${safeLanguage}`
}

function getWantedPriceAmount(price: CardPriceSnapshot | undefined) {
  return normalizePriceAmount(price?.marketGbpAmount) ??
    normalizePriceAmount(price?.gbpAmount) ??
    normalizePriceAmount(price?.goodGbpAmount) ??
    normalizePriceAmount(price?.lowGbpAmount)
}

function getWantedPriceBandId(amount: number | null): WantedDashboardPriceBandId {
  if (amount == null) return "unpriced"
  if (amount < 5) return "under-5"
  if (amount < 15) return "five-to-15"
  if (amount < 50) return "fifteen-to-50"
  return "over-50"
}

function normalizePriceAmount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? roundMoney(value) : null
}

function incrementBreakdown(groups: Map<string, WantedDashboardBreakdown>, label: string, amount: number) {
  const current = groups.get(label) ?? { label, count: 0, totalGbp: 0 }
  current.count += 1
  current.totalGbp = roundMoney(current.totalGbp + amount)
  groups.set(label, current)
}

function sortBreakdown(groups: Map<string, WantedDashboardBreakdown>) {
  return [...groups.values()].sort((left, right) =>
    right.count - left.count ||
    right.totalGbp - left.totalGbp ||
    left.label.localeCompare(right.label),
  )
}

function comparePriceDescending(left: WantedDashboardCard, right: WantedDashboardCard) {
  if (left.effectiveGbpAmount == null && right.effectiveGbpAmount == null) return 0
  if (left.effectiveGbpAmount == null) return 1
  if (right.effectiveGbpAmount == null) return -1
  return right.effectiveGbpAmount - left.effectiveGbpAmount
}

function comparePriceAscending(left: WantedDashboardCard, right: WantedDashboardCard) {
  return compareMaybePrice(left.effectiveGbpAmount, right.effectiveGbpAmount)
}

function compareMaybePrice(left: number | null, right: number | null) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return left - right
}

function compareDex(left: WantedDashboardCard, right: WantedDashboardCard) {
  return left.pokemonId - right.pokemonId ||
    left.pokemonName.localeCompare(right.pokemonName) ||
    left.card.card_name.localeCompare(right.card.card_name)
}

function compareNewest(left: WantedDashboardCard, right: WantedDashboardCard) {
  return Date.parse(right.card.added_at) - Date.parse(left.card.added_at)
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}
