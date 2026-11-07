import { buildCollectionAnalytics } from "@/lib/collection-analytics"
import type { CardPriceSnapshot } from "@/lib/card-pricing"
import type { CollectedPokemon } from "@/lib/domain/cards"

export const COLLECTION_CSV_COLUMNS = [
  "dex_number",
  "pokemon",
  "list",
  "slot_status",
  "card_id",
  "card_name",
  "set",
  "language",
  "finish",
  "market_gbp",
  "price_source",
  "price_basis",
  "added",
] as const

type CsvValue = string | number | null | undefined

/** One CSV field: quoted when needed, and spreadsheet formulas neutralised. */
export function toCsvField(value: CsvValue) {
  if (value === null || value === undefined) return ""
  let text = String(value)
  // A leading = + - @ (or tab/CR) makes Excel/Sheets run the cell as a formula.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function isoDay(value: string | undefined) {
  if (!value) return ""
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : ""
}

/**
 * The collection as CSV: one row per owned card, wanted card and owned slot without a card.
 * Prices use the same fresh (≤30 days) quotes as Analytics, with generic finish estimates labelled.
 */
export function buildCollectionCsv(collection: CollectedPokemon[], prices: Record<string, CardPriceSnapshot>, now = Date.now()) {
  const statusByPokemon = new Map(collection.map(item => [item.pokemon_id, item.status]))
  const rows: CsvValue[][] = buildCollectionAnalytics(collection, prices, now).cards.map(entry => [
    entry.pokemonId,
    entry.pokemonName,
    entry.scope,
    statusByPokemon.get(entry.pokemonId),
    entry.card.card_id,
    entry.card.card_name,
    entry.card.card_set,
    entry.card.card_language ?? "en",
    entry.card.card_finish ?? "normal",
    entry.amount === null ? null : entry.amount.toFixed(2),
    entry.amount === null ? null : entry.price?.source,
    entry.amount === null ? null : entry.estimatedFinish ? "finish_estimate" : "exact_finish",
    isoDay(entry.card.added_at ?? (entry.scope === "owned" ? (entry.card as { collected_at?: string }).collected_at : undefined)),
  ])
  for (const item of collection) {
    if (item.status === "wishlisted" || item.card_id) continue
    rows.push([item.pokemon_id, item.pokemon_name, "owned", item.status, null, null, null, null, null, null, null, null, isoDay(item.collected_at)])
  }
  rows.sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[2]).localeCompare(String(b[2])))
  return [COLLECTION_CSV_COLUMNS, ...rows].map(row => row.map(toCsvField).join(",")).join("\r\n") + "\r\n"
}

export function collectionCsvFilename(now = new Date()) {
  return `holofolder-collection-${now.toISOString().slice(0, 10)}.csv`
}
