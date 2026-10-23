import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { WantedCard } from "@/hooks/use-collection"
import { getRisingMomentum } from "@/lib/price-momentum"

export type WantedDashboardSort = "highest" | "lowest" | "cheapest-set" | "name" | "set" | "newest" | "rising" | "dex" | "unpriced"
export type WantedDashboardPriceBandId = "under-5" | "five-to-15" | "fifteen-to-50" | "over-50" | "unpriced"

export interface WantedDashboardEntry {
  pokemonId: number
  pokemonName: string
  card: WantedCard
  /** Set in the All binders want list: the binder this printing is wanted in. */
  binderId?: string
  binderName?: string
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
        ...(entry.binderId ? [entry.binderId] : []),
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

export const WANTED_SORTS: Array<{ id: WantedDashboardSort; label: string; short: string }> = [
  { id: "highest", label: "Price: high to low", short: "Price ↓" },
  { id: "lowest", label: "Price: low to high", short: "Price ↑" },
  { id: "cheapest-set", label: "Cheapest set to finish first", short: "Cheapest set" },
  { id: "name", label: "Name", short: "Name" },
  { id: "set", label: "Set", short: "Set" },
  { id: "newest", label: "Recently added", short: "Newest" },
  { id: "rising", label: "Rising prices first", short: "Rising" },
  { id: "dex", label: "Pokédex number", short: "Dex no." },
  { id: "unpriced", label: "Unpriced first", short: "Unpriced" },
]

export function normalizeWantedSort(value: unknown): WantedDashboardSort {
  return WANTED_SORTS.some((sort) => sort.id === value) ? value as WantedDashboardSort : "highest"
}

export function sortWantedDashboardEntries<T extends WantedDashboardCard>(
  cards: T[],
  sort: WantedDashboardSort,
  now = Date.now(),
): T[] {
  if (sort === "cheapest-set") {
    // Sets whose remaining wanted cards cost least come first; unpriced cards count as unknown
    // and push their set after fully priced ones. Within a set, cheapest card first.
    const setCost = new Map<string, { total: number; unpriced: number }>()
    for (const card of cards) {
      const key = card.card.card_set || "Unknown set"
      const current = setCost.get(key) ?? { total: 0, unpriced: 0 }
      if (card.effectiveGbpAmount == null) current.unpriced += 1
      else current.total = roundMoney(current.total + card.effectiveGbpAmount)
      setCost.set(key, current)
    }
    return [...cards].sort((left, right) => {
      const leftSet = left.card.card_set || "Unknown set"
      const rightSet = right.card.card_set || "Unknown set"
      const a = setCost.get(leftSet)!
      const b = setCost.get(rightSet)!
      return Number(a.unpriced > 0) - Number(b.unpriced > 0) ||
        a.total - b.total ||
        leftSet.localeCompare(rightSet) ||
        comparePriceAscending(left, right) ||
        compareDex(left, right)
    })
  }

  if (sort === "rising") {
    const change = new Map(cards.map((card) => [card.key, getRisingMomentum(card.price, now)?.change ?? null]))
    return [...cards].sort((left, right) =>
      compareMaybePrice(negate(change.get(left.key) ?? null), negate(change.get(right.key) ?? null)) ||
      comparePriceDescending(left, right) ||
      compareDex(left, right))
  }

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

    if (sort === "name") {
      return left.card.card_name.localeCompare(right.card.card_name) ||
        (left.card.card_set || "").localeCompare(right.card.card_set || "") ||
        compareLocalId(left, right)
    }

    if (sort === "set") {
      return (left.card.card_set || "").localeCompare(right.card.card_set || "") ||
        compareLocalId(left, right) ||
        compareDex(left, right) ||
        left.card.card_name.localeCompare(right.card.card_name)
    }

    return compareNewest(left, right) || compareDex(left, right)
  })
}

function negate(value: number | null) {
  return value == null ? null : -value
}

function compareLocalId(left: WantedDashboardCard, right: WantedDashboardCard) {
  const a = Number.parseInt(left.card.local_id ?? "", 10)
  const b = Number.parseInt(right.card.local_id ?? "", 10)
  return compareMaybePrice(Number.isFinite(a) ? a : null, Number.isFinite(b) ? b : null)
}

/** The want list's filters. Empty lists mean "any". */
export interface WantedFilters {
  bands: WantedDashboardPriceBandId[]
  sets: string[]
  finishes: string[]
  languages: string[]
  risingOnly: boolean
}

export const EMPTY_WANTED_FILTERS: WantedFilters = { bands: [], sets: [], finishes: [], languages: [], risingOnly: false }

const PRICE_BAND_IDS = new Set<string>(["under-5", "five-to-15", "fifteen-to-50", "over-50", "unpriced"])

function stringList(value: unknown, limit = 50) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 120))].slice(0, limit) : []
}

export function normalizeWantedFilters(value: unknown): WantedFilters {
  if (!value || typeof value !== "object") return EMPTY_WANTED_FILTERS
  const raw = value as Record<string, unknown>
  return {
    bands: stringList(raw.bands).filter((band): band is WantedDashboardPriceBandId => PRICE_BAND_IDS.has(band)),
    sets: stringList(raw.sets),
    finishes: stringList(raw.finishes),
    languages: stringList(raw.languages),
    risingOnly: raw.risingOnly === true,
  }
}

export function countWantedFilters(filters: WantedFilters) {
  return filters.bands.length + filters.sets.length + filters.finishes.length + filters.languages.length + Number(filters.risingOnly)
}

export function applyWantedFilters<T extends WantedDashboardCard>(cards: T[], filters: WantedFilters, now = Date.now()): T[] {
  if (countWantedFilters(filters) === 0) return cards
  return cards.filter((card) =>
    (filters.bands.length === 0 || filters.bands.includes(card.priceBandId)) &&
    (filters.sets.length === 0 || filters.sets.includes(card.card.card_set || "Unknown set")) &&
    (filters.finishes.length === 0 || filters.finishes.includes(card.card.card_finish ?? "normal")) &&
    (filters.languages.length === 0 || filters.languages.includes(card.card.card_language ?? "en")) &&
    (!filters.risingOnly || getRisingMomentum(card.price, now) != null))
}

export function toggleWantedFilter<K extends Exclude<keyof WantedFilters, "risingOnly">>(filters: WantedFilters, key: K, value: WantedFilters[K][number]): WantedFilters {
  const list = filters[key] as string[]
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  return { ...filters, [key]: next }
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

/** Lowercase, strip accents (Flabébé, Kouki Saitō) and collapse spaces so search is forgiving. */
export function normalizeWantedSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

function wantedSearchHaystack(entry: WantedDashboardEntry) {
  const { card } = entry
  const localId = card.local_id?.trim()
  const numberParts = localId
    ? [localId, `#${localId}`, localId.replace(/^0+(?=\d)/, ""), card.set_total ? `${localId}/${card.set_total}` : ""]
    : []
  return normalizeWantedSearchText([
    card.card_name,
    entry.pokemonName,
    card.card_set ?? "",
    card.rarity ?? "",
    card.illustrator ?? "",
    card.card_finish ?? "",
    ...numberParts,
  ].join(" "))
}

/**
 * Want-list search: every word must match the card name, Pokémon, set, number (007, #7, 7/165),
 * rarity, finish or illustrator. An empty query matches everything.
 */
export function matchesWantedSearch(entry: WantedDashboardEntry, query: string) {
  const words = normalizeWantedSearchText(query).split(" ").filter(Boolean)
  if (words.length === 0) return true
  const haystack = wantedSearchHaystack(entry)
  const tokens = haystack.split(" ")
  return words.every((word) => {
    const bare = word.replace(/^#/, "").replace(/^0+(?=\d)/, "")
    if (/^\d+$/.test(bare)) {
      // Numbers match a card number exactly (7 finds #007, not #070 or #171).
      return tokens.some((token) => token.replace(/^#/, "").replace(/^0+(?=\d)/, "") === bare || token === word)
    }
    return haystack.includes(word)
  })
}

export function filterWantedDashboardEntries<T extends WantedDashboardEntry>(cards: T[], query: string): T[] {
  if (!normalizeWantedSearchText(query)) return cards
  return cards.filter((card) => matchesWantedSearch(card, query))
}
