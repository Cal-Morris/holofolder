import type { PricedCardFinish } from "./card-pricing"
import { normalizeCatalogName } from "./card-catalog"

export const PRICE_HISTORY_DAYS = 90
export interface CardPriceHistoryPoint {
  date: string
  source: "tcgplayer"
  currency: "USD"
  amount: number
  lowAmount: number | null
  finish: PricedCardFinish
  productId: string
}

const FINISHES: Record<string, PricedCardFinish> = { Normal: "normal", Holofoil: "holo", "Reverse Holofoil": "reverse_holo" }
const SET_NAMES: Record<string, string> = {
  wizardsblackstarpromos: "wotcpromo", dpblackstarpromos: "diamondandpearlpromos",
  nintendoblackstarpromos: "nintendopromos", bwblackstarpromos: "blackandwhitepromos",
  svpblackstarpromos: "scarletvioletpromocards",
}
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0
const validDate = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && Date.parse(date) <= Date.now()

export function normalizePriceCardName(name: string, number: string) {
  const repeatedNumber = name.match(/\s+(?:-\s+([a-z]*\d+[a-z]?)|\(([a-z]*\d+[a-z]?)\))$/i)
  if (repeatedNumber && (repeatedNumber[1] ?? repeatedNumber[2]).toLowerCase() === number.split("/")[0].toLowerCase()) name = name.slice(0, repeatedNumber.index)
  const qualifier = name.match(/\s+\((?:([a-z]*\d+[a-z]?)\s+)?(?:Full Art|Secret|Prime)\)$/i)
  if (qualifier && (!qualifier[1] || qualifier[1].toLowerCase() === number.split("/")[0].toLowerCase())) name = name.slice(0, qualifier.index)
  return normalizeCatalogName(name.replaceAll("♀", " F").replaceAll("♂", " M"))
}

export function normalizePriceHistory(value: unknown): CardPriceHistoryPoint[] {
  if (!Array.isArray(value)) return []
  const points = new Map<string, CardPriceHistoryPoint>()
  for (const row of value.slice(-PRICE_HISTORY_DAYS * 6)) {
    if (!row || typeof row !== "object" || !validDate(row.date) || !positive(row.amount)
      || row.currency !== "USD" || row.source !== "tcgplayer" || !/^[1-9]\d*$/.test(String(row.productId))
      || !["normal", "holo", "reverse_holo"].includes(row.finish)) continue
    const point: CardPriceHistoryPoint = { date: row.date, source: "tcgplayer", currency: "USD", amount: row.amount,
      lowAmount: positive(row.lowAmount) ? row.lowAmount : null, finish: row.finish, productId: String(row.productId) }
    points.set(`${point.date}:${point.productId}:${point.finish}`, point)
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date) || a.finish.localeCompare(b.finish)).slice(-PRICE_HISTORY_DAYS * 3)
}

export function priceHistoryFromRows(rows: unknown, productId: string, date: string): CardPriceHistoryPoint[] {
  if (!Array.isArray(rows) || !validDate(date)) return []
  return normalizePriceHistory(rows.flatMap(row => row && String(row.productId) === productId && FINISHES[row.subTypeName]
    ? [{ date, source: "tcgplayer", currency: "USD", productId, finish: FINISHES[row.subTypeName], amount: row.marketPrice, lowAmount: row.lowPrice }]
    : []))
}

export function matchPriceProduct(card: { name: string; number: string; setName: string },
  product: { name: string; extendedData?: Array<{ name: string; value: string }> }, groupName: string) {
  const number = product.extendedData?.find(d => d.name === "Number")?.value.split("/")[0]
  const normalizeNumber = (value: string) => value.toLowerCase().replace(/(?<!\d)0+(?=\d)/g, "")
  const normalizedSet = normalizeCatalogName(card.setName)
  const set = SET_NAMES[normalizedSet] ?? normalizedSet
  const fullGroup = groupName.replace(/^(?:SWSH|SV|SM|ME|XY|BW)\d*\s*(?::|-)\s*/i, "")
  const group = normalizeCatalogName(fullGroup.replace(/(?:\s*:\s*|\s+)(?:Shiny Vault|Trainer Gallery|Galarian Gallery|Radiant Collection)$/i, ""))
  const classic = set === "celebrations" && /a$/i.test(card.number) && group === "celebrationsclassiccollection"
  return Boolean(number && set && normalizeNumber(number) === normalizeNumber(classic ? card.number.slice(0, -1) : card.number)
    && normalizePriceCardName(card.name, card.number) === normalizePriceCardName(product.name, number)
    && (classic || normalizeCatalogName(fullGroup) === set || group === set || (set !== "baseset" && group === `${set}baseset`) || (set === "151" && group === "scarletviolet151")))
}
