import { getCardPriceKey, isStandardFinishVariantKey, type CardPriceSnapshot } from "@/lib/card-pricing"
import { isCardFinish, isCardLanguage, type CollectedPokemon, type WantedCard } from "@/lib/domain/cards"
import { getFallingMomentum, getRisingMomentum, type PriceMomentum } from "@/lib/price-momentum"
import { getPriceDataAgeDays } from "@/lib/price-freshness"

export interface AnalyticsCard {
  key: string
  pokemonId: number
  pokemonName: string
  scope: "owned" | "wanted"
  card: Omit<WantedCard, "added_at"> & { added_at?: string }
  price: CardPriceSnapshot | null
  amount: number | null
}

export interface AnalyticsMover extends AnalyticsCard { momentum: PriceMomentum }

function exactQuote(card: AnalyticsCard["card"], snapshot: CardPriceSnapshot | undefined): CardPriceSnapshot | null {
  if (!snapshot) return null
  const finish = card.card_finish ?? "normal"
  if (snapshot.finishPrices?.length) {
    const matching = snapshot.finishPrices.filter(price => price.finish === finish && isStandardFinishVariantKey(price.variantKey))
    return matching.find(price => price.source === snapshot.source) ?? matching[0] ?? null
  }
  const variant = snapshot.variantLabel?.toLowerCase().replaceAll(/[^a-z]/g, "")
  const verifiedFinish = variant === "normal" || variant === "nonholo" || variant === "unlimited" ? "normal"
    : variant === "holo" || variant === "holofoil" ? "holo"
      : variant === "reverseholo" || variant === "reverseholofoil" ? "reverse_holo" : null
  return verifiedFinish === finish ? snapshot : null
}

/**
 * `countCopies`: the All binders view, where a Pokémon can sit in several binders. Each binder's copy of an owned
 * card counts (and is valued) separately; species still count once.
 */
export function buildCollectionAnalytics(collection: CollectedPokemon[], prices: Record<string, CardPriceSnapshot>, now = Date.now(), { countCopies = false }: { countCopies?: boolean } = {}) {
  const cards: AnalyticsCard[] = []
  const seen = new Set<string>()
  const add = (item: CollectedPokemon, card: AnalyticsCard["card"], scope: AnalyticsCard["scope"]) => {
    const key = `${countCopies && scope === "owned" ? `${item.id}:` : ""}${item.pokemon_id}:${scope}:${getCardPriceKey(card.card_id, card.card_language)}:${card.card_finish ?? "normal"}`
    if (seen.has(key)) return
    seen.add(key)
    const price = exactQuote(card, prices[getCardPriceKey(card.card_id, card.card_language)])
    const rawAmount = price?.marketGbpAmount ?? price?.gbpAmount
    const age = getPriceDataAgeDays(price?.updatedAt, now)
    const amount = typeof rawAmount === "number" && Number.isFinite(rawAmount) && rawAmount > 0 && age !== null && age <= 30 && Date.parse(price?.updatedAt ?? "") <= now ? rawAmount : null
    cards.push({ key, pokemonId: item.pokemon_id, pokemonName: item.pokemon_name, scope, card, price, amount })
  }
  for (const item of collection) {
    if (item.status !== "wishlisted" && item.card_id) add(item, { ...item, card_id: item.card_id, card_name: item.card_name ?? item.pokemon_name }, "owned")
    const wanted = item.wanted_cards ?? []
    for (const card of wanted) add(item, card, "wanted")
    if (item.status === "wishlisted" && item.card_id && wanted.length === 0) add(item, { ...item, card_id: item.card_id, card_name: item.card_name ?? item.pokemon_name, added_at: item.collected_at }, "wanted")
  }
  const rising: AnalyticsMover[] = []
  const falling: AnalyticsMover[] = []
  for (const entry of cards) {
    const timestamp = Date.parse(entry.price?.updatedAt ?? "")
    if (!Number.isFinite(timestamp) || timestamp > now || entry.amount === null) continue
    const momentum = getRisingMomentum(entry.price, now)
    if (momentum) rising.push({ ...entry, momentum })
    const decline = getFallingMomentum(entry.price, now)
    if (decline) falling.push({ ...entry, momentum: decline })
  }
  rising.sort((a, b) => b.momentum.change - a.momentum.change || a.key.localeCompare(b.key))
  falling.sort((a, b) => a.momentum.change - b.momentum.change || a.key.localeCompare(b.key))
  const owned = cards.filter(card => card.scope === "owned")
  return {
    ownedSpecies: new Set(collection.filter(item => item.status !== "wishlisted").map(item => item.pokemon_id)).size,
    assignedCards: owned.length,
    wantedCards: cards.filter(card => card.scope === "wanted").length,
    pricedCards: owned.filter(card => card.amount !== null).length,
    valueGbp: owned.reduce((sum, card) => sum + (card.amount ?? 0), 0),
    cards, rising, falling,
  }
}

export interface AnalyticsActivity {
  id: string
  pokemon_id: number
  pokemon_name: string
  recorded_at: string
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
}
export interface AnalyticsPricePoint {
  card_id: string
  language: string
  finish: string
  variant_key: string
  source: string
  observed_day: string
  recorded_at: string
  gbp_amount: number
  confidence: "high" | "medium" | "low" | "unknown"
  source_updated_at: string | null
}

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10)

export function normalizeAnalyticsHistory(value: unknown) {
  const payload = record(value)
  const activity = (Array.isArray(payload?.activity) ? payload.activity : []).flatMap<AnalyticsActivity>(value => {
    const row = record(value)
    if (!row || !(typeof row.id === "string" ? /^[1-9]\d{0,18}$/.test(row.id) && BigInt(row.id) <= BigInt("9223372036854775807") : Number.isSafeInteger(row.id) && Number(row.id) > 0) || !Number.isSafeInteger(row.pokemon_id) || Number(row.pokemon_id) <= 0 || typeof row.pokemon_name !== "string" || !validDate(row.recorded_at)) return []
    return [{ id: String(row.id), pokemon_id: Number(row.pokemon_id), pokemon_name: row.pokemon_name, recorded_at: row.recorded_at, before_state: record(row.before_state), after_state: record(row.after_state) }]
  })
  const priceHistory = (Array.isArray(payload?.priceHistory) ? payload.priceHistory : []).flatMap<AnalyticsPricePoint>(value => {
    const row = record(value)
    const amount = row?.gbp_amount === null || row?.gbp_amount === "" ? NaN : typeof row?.gbp_amount === "number" || typeof row?.gbp_amount === "string" ? Number(row.gbp_amount) : NaN
    if (!row || typeof row.card_id !== "string" || !isCardLanguage(row.language) || (row.finish !== "" && !isCardFinish(row.finish)) || typeof row.variant_key !== "string" || !["tcgplayer", "cardmarket", "pokepulse"].includes(String(row.source)) || !validDate(row.observed_day) || !validDate(row.recorded_at) || !Number.isFinite(amount) || amount <= 0 || !["high", "medium", "low", "unknown"].includes(String(row.confidence))) return []
    return [{ card_id: row.card_id, language: row.language, finish: String(row.finish), variant_key: row.variant_key, source: String(row.source), observed_day: String(row.observed_day), recorded_at: row.recorded_at, gbp_amount: amount, confidence: row.confidence as AnalyticsPricePoint["confidence"], source_updated_at: validDate(row.source_updated_at) ? row.source_updated_at : null }]
  })
  return { activity, priceHistory, nextCursor: typeof payload?.nextCursor === "string" && /^\d+$/.test(payload.nextCursor) ? payload.nextCursor : null, historyAvailable: payload?.historyAvailable === true }
}

export function activityDescription(event: AnalyticsActivity) {
  const before = event.before_state
  const after = event.after_state
  const oldOwned = before?.status !== "wishlisted" && before?.card_id
  const newOwned = after?.status !== "wishlisted" && after?.card_id
  const changes: string[] = []
  if (oldOwned && !newOwned) changes.push(`Removed ${String(before?.card_name ?? event.pokemon_name)}`)
  else if (newOwned && !oldOwned) changes.push(`Added ${String(after?.card_name ?? event.pokemon_name)}`)
  else if (oldOwned && newOwned && ["card_id", "card_language", "card_finish"].some(key => before?.[key] !== after?.[key])) changes.push(`Replaced ${String(before?.card_name ?? event.pokemon_name)} with ${String(after?.card_name ?? event.pokemon_name)}`)
  else if ((!before || before.status === "wishlisted") && after && after.status !== "wishlisted") changes.push(`Marked ${event.pokemon_name} owned`)
  else if (before && before.status !== "wishlisted" && after?.status === "wishlisted") changes.push(`Marked ${event.pokemon_name} missing`)
  const wants = (state: Record<string, unknown> | null) => {
    const values = Array.isArray(state?.wanted_cards) && state.wanted_cards.length ? state.wanted_cards : state?.status === "wishlisted" && state.card_id ? [state] : []
    return new Map(values.flatMap(value => {
      const card = record(value)
      return card && typeof card.card_id === "string" ? [[`${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`, String(card.card_name ?? card.card_id)] as const] : []
    }))
  }
  const oldWants = wants(before)
  const newWants = wants(after)
  for (const [key, name] of newWants) if (!oldWants.has(key)) changes.push(`Wanted ${name}`)
  for (const [key, name] of oldWants) if (!newWants.has(key)) changes.push(`Removed wanted ${name}`)
  return changes.join("; ") || (!after ? `Cleared ${event.pokemon_name}` : `Updated ${event.pokemon_name} want list`)
}

export function parseAnalyticsQuery(params: URLSearchParams) {
  if (params.has("ownerId")) throw new Error("Owner is resolved from your account")
  const cardId = params.get("cardId")
  const language = params.get("language") ?? "en"
  const beforeId = params.get("beforeId")
  if (cardId !== null && !/^[a-zA-Z0-9_.:~-]{1,120}$/.test(cardId)) throw new Error("Invalid card identity")
  if (!isCardLanguage(language)) throw new Error("Invalid language")
  if (beforeId !== null && (!/^[1-9]\d{0,18}$/.test(beforeId) || BigInt(beforeId) > BigInt("9223372036854775807"))) throw new Error("Invalid activity cursor")
  return { cardId, language, beforeId }
}
