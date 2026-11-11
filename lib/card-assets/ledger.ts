import { readCatalogMetadata } from "../card-catalog"
import { parseSourceCardImageUrl, pickPokemonComImageUrl } from "../card-image-sources"
import { buildTcgdexAssetImageUrl, pickImageLanguage, pickTcgdexImageFromExternalIds, TCGDEX_ASSET_HOST } from "../tcgdex-shared"

/**
 * Pure logic behind `scripts/card-assets.ts`: the source list, the preference rules and the per-set ledger
 * kept in `card-assets/<brand>/<game>/`. See `card-assets/AGENTS.md`.
 */

export const SOURCE_KINDS = ["official-render", "official-scan", "rehost", "fan-scan", "retail-photo"] as const
export const SOURCE_PERMISSIONS = ["none", "granted", "needed", "forbidden"] as const
/** Pseudo-source in `rules.csv`: the card's reviewed catalog image (`external_ids_json.catalog.image`), whatever its host. */
export const REVIEWED = "reviewed"

export type SourceKind = (typeof SOURCE_KINDS)[number]
export type SourcePermission = (typeof SOURCE_PERMISSIONS)[number]

export interface AssetSource {
  id: string
  name: string
  kind: SourceKind
  permission: SourcePermission
  permissionNote: string
  hosts: string
  maxSize: string
  credit: string
  creditUrl: string
  atlasId: string
}

export interface AssetRule {
  scope: string
  lang: string
  prefer: string[]
  reason: string
  decided: string
}

export interface MirrorCardRow {
  id: string
  series_id: string
  set_id: string
  local_id: string
  name_en: string | null
  image_languages_json: unknown
  external_ids_json: unknown
}

export interface ImageCandidate {
  source: string
  url: string
  /** TCGdex image language; null for every other source. */
  language: string | null
  reviewed: boolean
  /** False when the app would never show it (pokemon.com is skipped while TCGdex only has a foreign print). */
  eligible: boolean
}

export const LEDGER_COLUMNS = ["card_id", "local_id", "name", "rule", "source", "kind", "image_language", "url", "alternatives"] as const
export type LedgerRow = Record<(typeof LEDGER_COLUMNS)[number], string>

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { row.push(field); field = "" }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = "" }
    else if (ch !== "\r") field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter(cells => cells.some(cell => cell !== ""))
  if (!header) return []
  return body.map(cells => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])))
}

export function toCsv(header: readonly string[], rows: readonly Record<string, string>[]) {
  const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
  return [header, ...rows.map(row => header.map(name => row[name] ?? ""))].map(cells => cells.map(cell).join(",")).join("\n") + "\n"
}

function oneOf<T extends string>(allowed: readonly T[], value: string, what: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${what}: "${value}" is not one of ${allowed.join(", ")}`)
  return value as T
}

export function parseSources(text: string): AssetSource[] {
  const seen = new Set<string>()
  return parseCsv(text).map((row, i) => {
    const where = `sources.csv row ${i + 2}`
    if (!/^[a-z0-9-]+$/.test(row.id ?? "")) throw new Error(`${where}: id must be lowercase letters, digits or dashes`)
    if (seen.has(row.id)) throw new Error(`${where}: duplicate id ${row.id}`)
    seen.add(row.id)
    return {
      id: row.id,
      name: row.name ?? "",
      kind: oneOf(SOURCE_KINDS, row.kind ?? "", `${where} kind`),
      permission: oneOf(SOURCE_PERMISSIONS, row.permission ?? "", `${where} permission`),
      permissionNote: row.permission_note ?? "",
      hosts: row.hosts ?? "",
      maxSize: row.max_size ?? "",
      credit: row.credit ?? "",
      creditUrl: row.credit_url ?? "",
      atlasId: row.atlas_id ?? "",
    }
  })
}

const SCOPE_PATTERN = /^(\*|(card|set|series):[A-Za-z0-9._-]+\*?)$/

export function parseRules(text: string, sources: readonly AssetSource[]): AssetRule[] {
  const byId = new Map(sources.map(source => [source.id, source]))
  const seen = new Set<string>()
  return parseCsv(text).map((row, i) => {
    const where = `rules.csv row ${i + 2}`
    const scope = row.scope ?? ""
    if (!SCOPE_PATTERN.test(scope)) throw new Error(`${where}: scope "${scope}" must be *, card:<id>, set:<id> or series:<id> (a trailing * matches a prefix)`)
    const lang = row.lang ?? ""
    if (!/^[a-z]{2}(-[a-z]{2,3})?$/.test(lang)) throw new Error(`${where}: lang "${lang}" is not a language code`)
    if (seen.has(`${scope} ${lang}`)) throw new Error(`${where}: duplicate rule for ${scope} ${lang}`)
    seen.add(`${scope} ${lang}`)
    const prefer = (row.prefer ?? "").split(">").map(id => id.trim()).filter(Boolean)
    if (!prefer.length) throw new Error(`${where}: prefer is empty`)
    for (const id of prefer) {
      if (id === REVIEWED) continue
      const source = byId.get(id)
      if (!source) throw new Error(`${where}: unknown source "${id}" (add it to sources.csv first)`)
      if (source.permission !== "none" && source.permission !== "granted") throw new Error(`${where}: source "${id}" has permission "${source.permission}" and can't be preferred`)
    }
    return { scope, lang, prefer, reason: row.reason ?? "", decided: row.decided ?? "" }
  })
}

const SCOPE_RANK = { card: 3, set: 2, series: 1 } as const

function scopeRank(scope: string, card: Pick<MirrorCardRow, "id" | "set_id" | "series_id">): number | null {
  if (scope === "*") return 0
  const [kind, pattern] = scope.split(":") as [keyof typeof SCOPE_RANK, string]
  const value = kind === "card" ? card.id : kind === "set" ? card.set_id : card.series_id
  const matches = pattern.endsWith("*") ? value.startsWith(pattern.slice(0, -1)) : value === pattern
  // Exact scopes beat prefix scopes of the same kind, and longer prefixes beat shorter ones.
  return matches ? SCOPE_RANK[kind] + (pattern.endsWith("*") ? pattern.length / 1000 : 0.999) : null
}

/** The most specific rule for this card and language, or null when none matches. */
export function matchRule(rules: readonly AssetRule[], card: Pick<MirrorCardRow, "id" | "set_id" | "series_id">, lang: string) {
  let best: { rule: AssetRule; rank: number } | null = null
  for (const rule of rules) {
    if (rule.lang !== lang) continue
    const rank = scopeRank(rule.scope, card)
    if (rank !== null && (!best || rank > best.rank)) best = { rule, rank }
  }
  return best?.rule ?? null
}

export function sourceIdForUrl(url: string): string | null {
  try {
    if (new URL(url).hostname === TCGDEX_ASSET_HOST) return "tcgdex"
  } catch {
    return null
  }
  return parseSourceCardImageUrl(url)?.source ?? null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function tcgplayerProductUrl(externalIds: unknown) {
  const tcgdex = asRecord(asRecord(externalIds)?.tcgdex)
  const ids = [asRecord(tcgdex?.thirdParty)?.tcgplayer, ...(Array.isArray(tcgdex?.variantThirdParty) ? tcgdex.variantThirdParty.map(entry => asRecord(entry)?.tcgplayer) : [])]
  for (const id of ids) {
    const value = typeof id === "number" ? String(id) : typeof id === "string" ? id.trim() : ""
    if (/^[1-9]\d*$/.test(value)) return `https://product-images.tcgplayer.com/${value}.jpg`
  }
  return null
}

/**
 * Every image we already know about for a card, from the fields the app reads (`pickCardImageUrl` in
 * `lib/card-image-sources.ts`). New sources (malie, …) add their candidates here.
 */
export function imageCandidates(card: MirrorCardRow, lang = "en"): ImageCandidate[] {
  const externalIds = card.external_ids_json
  const candidates: ImageCandidate[] = []
  const add = (url: string | null | undefined, extra: Partial<ImageCandidate> = {}) => {
    if (!url) return
    const source = sourceIdForUrl(url)
    if (source && !candidates.some(candidate => candidate.url === url)) candidates.push({ source, url, language: null, reviewed: false, eligible: true, ...extra })
  }
  add(readCatalogMetadata(externalIds).image, { reviewed: true })
  const imageLanguage = pickImageLanguage(card.image_languages_json, lang)
  // pokemon.com is English only; the app shows it only when TCGdex has no image or an English one.
  add(pickPokemonComImageUrl(externalIds), { eligible: imageLanguage === null || imageLanguage === "en" })
  if (imageLanguage) add(buildTcgdexAssetImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id), { language: imageLanguage })
  add(pickTcgdexImageFromExternalIds(externalIds), { language: null })
  const pokemonTcg = asRecord(asRecord(externalIds)?.pokemon_tcg)
  add([pokemonTcg?.imageLarge, pokemonTcg?.imageSmall].find((value): value is string => typeof value === "string" && value.length > 0))
  add(tcgplayerProductUrl(externalIds))
  return candidates
}

/** The candidate a rule picks: the first preferred source that has an eligible image. */
export function chooseImage(candidates: readonly ImageCandidate[], prefer: readonly string[]) {
  for (const id of prefer) {
    const match = candidates.find(candidate => candidate.eligible && (id === REVIEWED ? candidate.reviewed : !candidate.reviewed && candidate.source === id))
    if (match) return match
  }
  return null
}

export function ledgerRow(card: MirrorCardRow, rules: readonly AssetRule[], sources: readonly AssetSource[], lang = "en"): LedgerRow {
  const rule = matchRule(rules, card, lang)
  const candidates = imageCandidates(card, lang)
  const chosen = rule ? chooseImage(candidates, rule.prefer) : null
  const kinds = new Map(sources.map(source => [source.id, source.kind]))
  return {
    card_id: card.id,
    local_id: card.local_id,
    name: card.name_en ?? "",
    rule: rule?.scope ?? "",
    source: chosen?.source ?? "",
    kind: chosen ? kinds.get(chosen.source) ?? "" : "",
    image_language: chosen?.language ?? "",
    url: chosen?.url ?? "",
    alternatives: candidates.filter(candidate => candidate !== chosen).map(candidate => candidate.source + (candidate.language ? `:${candidate.language}` : "")).join(" "),
  }
}

/** Atlas `data.json` (github.com/nstrelow/ptcg-image-atlas), only the fields the cross-check reads. */
export interface AtlasData {
  sources: Array<{ id: string; name?: string }>
  gaps?: Array<{ lang: string; fills?: Array<{ source: string; permission: string }> }>
}

/**
 * Checks `sources.csv` against the atlas: errors for atlas ids that don't exist, warnings where we allow a
 * source that the atlas says needs someone's permission and we haven't recorded why it's fine.
 */
export function crossCheckAtlas(sources: readonly AssetSource[], atlas: AtlasData) {
  const atlasIds = new Set(atlas.sources.map(source => source.id))
  const errors: string[] = []
  const warnings: string[] = []
  for (const source of sources) {
    if (source.atlasId && !atlasIds.has(source.atlasId)) errors.push(`${source.id}: atlas_id "${source.atlasId}" is not in the atlas`)
    if (!source.atlasId || source.permissionNote || (source.permission !== "none" && source.permission !== "granted")) continue
    const flagged = (atlas.gaps ?? []).flatMap(gap => (gap.fills ?? []).filter(fill => fill.source === source.atlasId && fill.permission !== "none").map(fill => `${gap.lang}: ${fill.permission}`))
    if (flagged.length) warnings.push(`${source.id}: allowed here, but the atlas says ${[...new Set(flagged)].join(", ")}. Record why in permission_note.`)
  }
  return { errors, warnings }
}
