/**
 * malie.io publishes the card renders from the official Pokémon TCG Live client (per-set JSON exports) and the
 * retired TCG Online client (per-set HTML listings). This turns both into per-card image URLs for our card ids.
 * `scripts/card-assets.ts discover malie` does the fetching; `card-assets/pokemon/tcg/malie-sets.csv` maps sets.
 */

export const MALIE_EXPORT_INDEX = "https://cdn.malie.io/file/malie-io/tcgl/export/index.json"
export const MALIE_EXPORT_BASE = "https://cdn.malie.io/file/malie-io/tcgl/export/"
export const MALIE_LISTING_BASE = "https://malie.io/static/listings/"

export interface MalieEntry {
  /** The printed collector number as malie gives it (`001`, `SV122`, `GG070`). */
  number: string
  /** The card name (TCG Live) or the file-name slug (TCG Online). */
  name: string
  url: string
}

export interface MalieCard {
  id: string
  local_id: string
  name_en: string | null
}

/** `001` → `1`, `SM01` → `SM1`, `GG070` → `GG70`, `9A` → `9A`: zero-padding differs between sources. */
export function normalizeCollectorNumber(value: string) {
  const match = /^([A-Za-z]*)0*(\d+)([A-Za-z]*)$/.exec(value.trim())
  return match ? `${match[1].toUpperCase()}${Number(match[2])}${match[3].toUpperCase()}` : value.trim().toUpperCase()
}

const ENERGY_SYMBOLS: Record<string, string> = { g: "grass", r: "fire", w: "water", l: "lightning", p: "psychic", f: "fighting", d: "darkness", m: "metal", y: "fairy", n: "dragon", c: "colorless" }

/**
 * Lowercase letters and digits only. Energy symbols are spelled out (`{G}` and `_g_` become `grass`) and the word
 * "basic" is dropped, because malie writes "Basic {G} Energy" where we have "Grass Energy".
 */
export function normalizeCardName(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\{([a-z])\}/g, (symbol, letter: string) => ENERGY_SYMBOLS[letter] ?? symbol)
    .split(/[^a-z0-9]+/).map(word => (word.length === 1 && ENERGY_SYMBOLS[word]) || word).filter(word => word && word !== "basic").join("")
}

/** Names match when one normalized form starts with the other (`mewtwo_gx-ya` vs `Mewtwo-GX`). */
export function namesMatch(a: string, b: string) {
  const x = normalizeCardName(a)
  const y = normalizeCardName(b)
  return Boolean(x && y) && (x.startsWith(y) || y.startsWith(x))
}

interface TcglCard {
  name?: unknown
  collector_number?: { numerator?: unknown }
  ext?: { tcgl?: { longFormID?: unknown } }
  images?: { tcgl?: { png?: { front?: unknown } } }
}

/** A TCG Live set export: the standard print of each card (reverse-holo `_ph` entries share its image). */
export function parseTcglExport(value: unknown): MalieEntry[] {
  if (!Array.isArray(value)) throw new Error("malie export: expected an array of cards")
  const entries: MalieEntry[] = []
  for (const card of value as TcglCard[]) {
    const longFormId = card.ext?.tcgl?.longFormID
    const url = card.images?.tcgl?.png?.front
    const number = card.collector_number?.numerator
    // oxlint-disable-next-line react-doctor/js-set-map-lookups -- substring check on a string
    if (typeof longFormId !== "string" || !longFormId.includes("_std_") || typeof url !== "string" || typeof number !== "string" || typeof card.name !== "string") continue
    entries.push({ number, name: card.name, url })
  }
  return entries
}

/** A TCG Online listing page: every English PNG, `…/en_US-<CODE>-<NNN>-<name>.png`. */
export function parseTcgoListing(html: string, code: string): MalieEntry[] {
  const entries = new Map<string, MalieEntry>()
  const prefix = `en_US-${code}-`
  for (const [url] of html.matchAll(/https:\/\/cdn\.malie\.io\/file\/malie-io\/art\/cards\/png\/en_US\/[^"'<>\s]+\.png/g)) {
    const file = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1, -4))
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length)
    // oxlint-disable-next-line react-doctor/js-set-map-lookups -- position in a string
    const dash = rest.indexOf("-")
    if (dash <= 0) continue
    entries.set(url, { number: rest.slice(0, dash), name: rest.slice(dash + 1), url })
  }
  return [...entries.values()]
}

/**
 * Pairs our cards with malie entries: same collector number and a matching name. When several prints share a
 * number (alternate arts), the one whose name matches most closely wins. Cards with no confident match are left out.
 */
export function matchMalieEntries(cards: readonly MalieCard[], entries: readonly MalieEntry[]) {
  const byNumber = new Map<string, MalieEntry[]>()
  for (const entry of entries) {
    const key = normalizeCollectorNumber(entry.number)
    byNumber.set(key, [...(byNumber.get(key) ?? []), entry])
  }
  const matches = new Map<string, MalieEntry>()
  let nameMismatch = 0
  for (const card of cards) {
    const sameNumber = byNumber.get(normalizeCollectorNumber(card.local_id)) ?? []
    const named = sameNumber.filter(entry => card.name_en && namesMatch(entry.name, card.name_en))
    if (!named.length) {
      if (sameNumber.length) nameMismatch++
      continue
    }
    const target = normalizeCardName(card.name_en ?? "")
    named.sort((a, b) => Math.abs(normalizeCardName(a.name).length - target.length) - Math.abs(normalizeCardName(b.name).length - target.length))
    matches.set(card.id, named[0])
  }
  return { matches, nameMismatch, unmatched: cards.length - matches.size }
}
