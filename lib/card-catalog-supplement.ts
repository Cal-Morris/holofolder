import { inferDexIdsFromCardName } from "./card-dex-inference"
import { readCatalogMetadata } from "./card-catalog"
import type { MirrorCardRow, MirrorSetRow, MirrorCardExternalSourceRow } from "./card-db-sync"

export type CatalogProduct = {
  productId: number
  groupId: number
  name: string
  extendedData?: Array<{ name: string; value: string }>
}
export type LegacyCatalogCard = {
  id: string
  sourceSetId: string
  name?: string
  number?: string
  supertype?: string
  hp?: string
  nationalPokedexNumbers?: number[]
  rarity?: string
  artist?: string
  types?: string[]
  images?: { large?: string; small?: string }
  tcgplayer?: { url?: string }
}
type LegacySet = { id: string; name?: string; releaseDate?: string; printedTotal?: number }
type Variant = { type?: string; size?: string; stamp?: string[]; variantId?: string; thirdParty?: { tcgplayer?: number } }

const SET_ALIASES: Record<string, string> = {
  hsp: "hgssp", cel25c: "cel25cc", me55c: "30th-c", me55: "30th",
  zsv10pt5: "sv10.5b", rsv10pt5: "sv10.5w", mcd16: "2016xy", mcd17: "2017sm", mcd18: "2018sm",
  tk1a: "tk-ex-latia", tk1b: "tk-ex-latio", sm35: "sm3.5", sm75: "sm7.5",
}
const GROUP_SETS: Record<number, string> = { 24451: "mep", 22872: "svp", 1451: "xyp", 2545: "swshp", 1453: "hgssp", 1938: "alternate-art-promos" }
const STAMP_LABELS: Record<string, string> = { "pokemon-center": "Pokémon Center", staff: "Staff", "pre-release": "Prerelease", "set-logo": "Set logo", "1st-edition": "1st Edition" }

export function normalizeCatalogName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
}
function number(value: string) { return value.toLowerCase().replace(/(?<!\d)0+(?=\d)/g, "") }
function parentSet(value: string) { return value.replace(/(?:tg|gg|sv)$/, "") }
function details(product: CatalogProduct) { return Object.fromEntries((product.extendedData ?? []).map(d => [d.name, d.value])) }
function englishProduct(product: CatalogProduct) {
  const d = details(product)
  return /^[a-z]*\d+[a-z]?(?:\/\d+)?$/i.test(d.Number ?? "") && !/printed in Japanese only/i.test(d.CardText ?? "")
}
function productId(value: unknown): string | undefined { return /^[1-9]\d*$/.test(String(value)) ? String(value) : undefined }
function variants(card: MirrorCardRow): Variant[] {
  const raw = Array.isArray(card.raw_json.variants) ? card.raw_json.variants : card.raw_json.variants_detailed
  return Array.isArray(raw) ? raw.filter(v => v && typeof v === "object") : []
}
function sourceProduct(card: LegacyCatalogCard) {
  return card.tcgplayer?.url?.match(/(?:product\/|[?&]id=)(\d+)/)?.[1]
}
function species(name: string | null | undefined) {
  return inferDexIdsFromCardName(name?.replace(/-(GX|EX|V|VMAX|VSTAR)\b/gi, " $1"))
}

export function buildCatalogSupplement(input: {
  cards: MirrorCardRow[]; sets: MirrorSetRow[]; products: CatalogProduct[]
  legacySets: LegacySet[]; legacyCards: LegacyCatalogCard[]; checkedImages: ReadonlySet<string>
}) {
  const cards = new Map(input.cards.map(c => [c.id, { ...c, external_ids_json: { ...c.external_ids_json } }]))
  const sets = new Map(input.sets.map(s => [s.id, s]))
  const addedSets: MirrorSetRow[] = []
  const supplementalSeries = { id: "catalog-supplements", name_en: "Supplemental sets", name_json: { en: "Supplemental sets" }, raw_json: { source: "pokemon_tcg" } }
  const legacyById = new Map(input.legacyCards.map(c => [c.id, c]))
  const products = new Map(input.products.map(p => [String(p.productId), p]))
  const dexLinks: Array<{ card_id: string; dex_id: number }> = []
  const unresolved: Array<{ source: string; id: string; reason: string }> = []
  const originalIds = new Set(cards.keys())
  const byNumber = new Map<string, MirrorCardRow[]>()
  const rememberCard = (card: MirrorCardRow) => {
    cards.set(card.id, card)
    const key = `${card.set_id}:${number(card.local_id)}`
    const rows = byNumber.get(key) ?? []
    if (!rows.some(row => row.id === card.id)) rows.push(card)
    byNumber.set(key, rows)
  }
  for (const card of cards.values()) rememberCard(card)
  let aliases = 0
  const setAliases = new Map<string, string>(Object.entries(SET_ALIASES))
  const productCards = new Map<string, MirrorCardRow>()
  const printingCards = new Map<string, MirrorCardRow>()
  for (const card of cards.values()) {
    const saved = readCatalogMetadata(card.external_ids_json)
    if (saved.tcgdexCardId && saved.printingLabel) printingCards.set(`${saved.tcgdexCardId}:${saved.printingLabel}`, card)
  }
  const canonicalKey = (c: MirrorCardRow) => `${parentSet(c.set_id)}:${number(c.local_id)}:${normalizeCatalogName(c.name_en ?? "")}`
  const identities = new Map<string, MirrorCardRow>()
  const metadata = (c: MirrorCardRow, patch: Record<string, unknown>) => {
    c.external_ids_json.catalog = { ...readCatalogMetadata(c.external_ids_json), ...patch }
  }
  const matchesProduct = (c: MirrorCardRow, p: CatalogProduct, stamps = (variants(c).find(v => v.size !== "jumbo" && !v.stamp?.length) ?? variants(c).find(v => v.size !== "jumbo"))?.stamp ?? []) => {
    const d = details(p)
    const cardName = (c.name_en ?? "").replace(/ \([^)]*\)$/, "")
    const productName = p.name.split(/\s+-\s+/)[0]
    if (!englishProduct(p) || normalizeCatalogName(cardName) !== normalizeCatalogName(productName) || number(d.Number.split("/")[0]) !== number(readCatalogMetadata(c.external_ids_json).localId ?? c.local_id)) return false
    const qualifier = p.name.split(/\s+-\s+/).slice(1).join(" - ")
    if (!stamps.length && !readCatalogMetadata(c.external_ids_json).printingLabel && qualifier && !/^[a-z]*\d+[a-z]?(?:\/\d+)?$/i.test(qualifier.trim())) return false
    return stamps.every(stamp => normalizeCatalogName(p.name).includes(normalizeCatalogName(STAMP_LABELS[stamp] ?? stamp)))
  }
  const attachImage = (c: MirrorCardRow, pid?: string, stamps?: string[]) => {
    if (!pid || !input.checkedImages.has(pid)) return
    const source = products.get(pid)
    if (!source || !matchesProduct(c, source, stamps)) {
      unresolved.push({ source: "tcgcsv", id: pid, reason: `Product identity does not match ${c.id}` }); return
    }
    const existing = readCatalogMetadata(c.external_ids_json)
    if (!c.image_languages_json.length && !existing.image) metadata(c, { image: `https://product-images.tcgplayer.com/${pid}.jpg`, productId: pid })
  }
  const rememberProduct = (c: MirrorCardRow, pid?: string) => {
    if (!pid) return
    productCards.set(pid, c)
  }
  for (const c of cards.values()) {
    const key = canonicalKey(c)
    const existing = identities.get(key)
    if (existing && existing.set_id !== c.set_id && parentSet(existing.set_id) === parentSet(c.set_id)) {
      const preferred = c.set_id === parentSet(c.set_id) ? c : existing
      const alias = preferred === c ? existing : c
      metadata(alias, { canonicalId: preferred.id }); identities.set(key, preferred); aliases++
    } else identities.set(key, c)
    const source = c.external_ids_json.pokemon_tcg as { cardId?: string; setId?: string } | undefined
    if (source?.setId) setAliases.set(source.setId, c.set_id)
    const tcgdex = c.external_ids_json.tcgdex as { thirdParty?: { tcgplayer?: number }; variantThirdParty?: Array<{ tcgplayer?: number }> } | undefined
    rememberProduct(c, readCatalogMetadata(c.external_ids_json).productId)
    rememberProduct(c, productId(tcgdex?.thirdParty?.tcgplayer))
    if (source?.cardId) rememberProduct(c, sourceProduct(legacyById.get(source.cardId) ?? { id: "", sourceSetId: "" }))
    for (const v of variants(c)) if (!v.stamp?.length && v.size !== "jumbo") rememberProduct(c, productId(v.thirdParty?.tcgplayer))
  }
  const aliasFamilies = new Map<string, Set<string>>()
  for (const c of cards.values()) {
    const canonical = readCatalogMetadata(c.external_ids_json).canonicalId
    if (!canonical) continue
    const family = aliasFamilies.get(canonical) ?? new Set([canonical])
    family.add(c.id); aliasFamilies.set(canonical, family)
  }
  for (const family of aliasFamilies.values()) {
    for (const id of family) {
      const card = cards.get(id)
      if (card) metadata(card, { aliasIds: [...family].filter(alias => alias !== id).sort() })
    }
  }
  // Stable aliases and exact collector numbers, never a fuzzy set/date join.
  const find = (sid: string, localId: string, name: string) => (byNumber.get(`${sid}:${number(localId)}`) ?? []).filter(c => normalizeCatalogName(c.name_en ?? "") === normalizeCatalogName(name))
  for (const source of input.legacyCards) {
    if (source.supertype !== "Pokémon" || !source.name || !source.number) continue
    const sid = setAliases.get(source.sourceSetId) ?? source.sourceSetId
    const name = source.name
    let matches = cards.has(source.id) ? [cards.get(source.id)!] : find(sid, source.number, name)
    if (!matches.length && ["cel25c", "me55c"].includes(source.sourceSetId)) matches = [...cards.values()].filter(c => c.set_id === sid && normalizeCatalogName(c.name_en ?? "") === normalizeCatalogName(name))
    if (!matches.length && source.sourceSetId === "ex10" && name === "Unown") matches = find("exu", source.number, name)
    const pid = sourceProduct(source)
    if (matches.length === 1) { rememberProduct(matches[0], pid); attachImage(matches[0], pid); continue }
    if (matches.length > 1) { unresolved.push({ source: "pokemon_tcg", id: source.id, reason: "Ambiguous identity" }); continue }
    const inferred = species(name)
    const given = source.nationalPokedexNumbers ?? []
    if (!inferred.length || !given.length || inferred.some(id => !given.includes(id)) || given.some(id => !inferred.includes(id))) {
      unresolved.push({ source: "pokemon_tcg", id: source.id, reason: "Species identity needs review" }); continue
    }
    let set = sets.get(sid)
    const sourceSet = input.legacySets.find(s => s.id === source.sourceSetId)
    if (!set && sourceSet?.name) {
      const date = sourceSet.releaseDate?.replaceAll("/", "-")
      set = { id: sid, series_id: supplementalSeries.id, name_en: sourceSet.name, name_json: { en: sourceSet.name }, official_card_count: sourceSet.printedTotal ?? null,
        release_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, raw_json: { supplementalSources: { pokemon_tcg: sourceSet } } }
      sets.set(sid, set); addedSets.push(set)
    }
    if (!set || byNumber.has(`${sid}:${number(source.number)}`)) {
      unresolved.push({ source: "pokemon_tcg", id: source.id, reason: "Set/collector identity needs review" }); continue
    }
    const row: MirrorCardRow = {
      id: source.id, set_id: set.id, series_id: set.series_id, local_id: source.number, local_id_sort: Number.parseInt(source.number.replace(/\D/g, ""), 10) || 0,
      name_en: name, name_json: { en: name }, category: "Pokemon", hp: Number(source.hp) || null, rarity: source.rarity ?? null,
      illustrator: source.artist ?? null, types_json: source.types ?? [], variants_json: {}, image_languages_json: [],
      external_ids_json: { pokemon_tcg: { cardId: source.id, setId: source.sourceSetId } }, raw_json: { supplementalSources: { pokemon_tcg: source } },
    }
    rememberCard(row); rememberProduct(row, pid); attachImage(row, pid)
    for (const dex_id of inferred) dexLinks.push({ card_id: row.id, dex_id })
  }
  for (const base of [...cards.values()]) {
    if (readCatalogMetadata(base.external_ids_json).canonicalId || readCatalogMetadata(base.external_ids_json).variantId) continue
    const tcgdexCardId = typeof base.raw_json.id === "string" ? base.raw_json.id : base.id
    const standardVariants = variants(base).filter(v => v.size !== "jumbo")
    const baseVariant = standardVariants.find(v => !v.stamp?.length) ?? standardVariants[0]
    const stampKey = (variant: Variant | undefined) => [...(variant?.stamp ?? [])].sort().join("|")
    const seenStamps = new Set([stampKey(baseVariant)])
    for (const variant of standardVariants) {
      const pid = productId(variant.thirdParty?.tcgplayer)
      if (variant.size === "jumbo" || !pid) continue
      if (!variant.stamp?.length || variant === baseVariant) { attachImage(base, pid, variant.stamp); continue }
      if (seenStamps.has(stampKey(variant))) continue
      const p = products.get(pid)
      if (!p || !input.checkedImages.has(pid) || !species(base.name_en).length) continue
      if (!matchesProduct(base, p, variant.stamp)) { unresolved.push({ source: "tcgcsv", id: pid, reason: `Product identity does not match ${base.id}` }); continue }
      const printingLabel = [...variant.stamp].sort().map(s => STAMP_LABELS[s] ?? s.replaceAll("-", " ")).join(", ")
      const id = (printingCards.get(`${tcgdexCardId}:${printingLabel}`) ?? printingCards.get(`${base.id}:${printingLabel}`))?.id ?? `${base.id}~${pid}`
      // Product identity prevents the same stamped printing being imported through both providers.
      if (productCards.has(pid) && ![base.id, id].includes(productCards.get(pid)!.id)) continue
      const name = `${base.name_en} (${printingLabel})`
      const row: MirrorCardRow = { ...base, id, local_id: `${base.local_id}~${pid}`, name_en: name, name_json: { en: name }, image_languages_json: [],
        variants_json: { holo: variant.type === "holo", normal: variant.type === "normal", reverse: variant.type === "reverse", firstEdition: variant.stamp.includes("1st-edition"), wPromo: variant.stamp.includes("w-Promo") },
        external_ids_json: { catalog: { localId: base.local_id, tcgdexCardId, variantId: variant.variantId ?? pid, productId: pid, printingLabel, image: `https://product-images.tcgplayer.com/${pid}.jpg` } },
        raw_json: { supplementalSources: { tcgdexVariant: variant, tcgcsv: p } },
      }
      rememberCard(row); rememberProduct(row, pid); printingCards.set(`${tcgdexCardId}:${printingLabel}`, row); seenStamps.add(stampKey(variant))
      for (const dex_id of species(base.name_en)) dexLinks.push({ card_id: id, dex_id })
    }
  }
  for (const p of input.products) {
    const pid = String(p.productId)
    const known = productCards.get(pid)
    if (known) { attachImage(known, pid); continue }
    const d = details(p)
    if (!/^\d+$/.test(d.HP ?? "") || Number(d.HP) <= 0 || !d.Number || !input.checkedImages.has(pid)) continue
    if (!englishProduct(p)) { unresolved.push({ source: "tcgcsv", id: pid, reason: "Non-English or ambiguous collector number" }); continue }
    // Mixed miscellaneous product groups also contain Japanese cards and merchandise.
    if (!GROUP_SETS[p.groupId]) { unresolved.push({ source: "tcgcsv", id: pid, reason: "Set/language mapping needs review" }); continue }
    if (p.groupId === 1938) {
      const matches = [...cards.values()].filter(c => !readCatalogMetadata(c.external_ids_json).canonicalId && matchesProduct(c, p))
      if (matches.length === 1) { rememberProduct(matches[0], pid); attachImage(matches[0], pid); continue }
    }
    const sid = GROUP_SETS[p.groupId]
    const local = d.Number.split("/")[0].trim()
    const name = p.name.replace(/\s+-\s+.*$/, "").trim()
    const existing = find(sid, local, name)
    if (existing.length === 1 && p.name.includes(" - ") && !p.name.includes("(")) { rememberProduct(existing[0], pid); attachImage(existing[0], pid); continue }
    // A product without exact source variant metadata may be another finish, stamp or sealed item.
    if (byNumber.has(`${sid}:${number(local)}`) || p.name.includes("(")) {
      unresolved.push({ source: "tcgcsv", id: pid, reason: "Printing identity needs review" }); continue
    }
    const dexIds = species(name)
    const set = sets.get(sid)
    if (!set || !dexIds.length || !p.name.includes(" - ")) { unresolved.push({ source: "tcgcsv", id: pid, reason: "Card identity needs review" }); continue }
    const id = `tcgplayer-${pid}`
    const row: MirrorCardRow = { id, set_id: set.id, series_id: set.series_id, local_id: local, local_id_sort: Number.parseInt(local.replace(/\D/g, ""), 10) || 0,
      name_en: name, name_json: { en: name }, category: "Pokemon", hp: Number(d.HP), rarity: d.Rarity ?? null,
      illustrator: null, types_json: d["Card Type"] ? [d["Card Type"]] : [], variants_json: {}, image_languages_json: [],
      external_ids_json: { catalog: { productId: pid, image: `https://product-images.tcgplayer.com/${pid}.jpg` } }, raw_json: { supplementalSources: { tcgcsv: p } },
    }
    rememberCard(row); rememberProduct(row, pid)
    for (const dex_id of dexIds) dexLinks.push({ card_id: id, dex_id })
  }
  const externalSources: MirrorCardExternalSourceRow[] = []
  for (const card of cards.values()) {
    const pid = readCatalogMetadata(card.external_ids_json).productId
    const product = pid ? products.get(pid) : undefined
    if (pid && product) externalSources.push({ card_id: card.id, source: "tcgcsv", source_card_id: pid, source_set_id: String(product.groupId), raw_json: { ...product } })
    const legacy = card.external_ids_json.pokemon_tcg as { cardId?: string } | undefined
    const source = legacy?.cardId ? legacyById.get(legacy.cardId) : undefined
    if (source && !originalIds.has(card.id)) externalSources.push({ card_id: card.id, source: "pokemon_tcg", source_card_id: source.id, source_set_id: source.sourceSetId, raw_json: { ...source } })
  }
  return { cards: [...cards.values()], sets: addedSets, series: addedSets.length ? [supplementalSeries] : [], externalSources, dexLinks, report: { added: [...cards.keys()].filter(id => !originalIds.has(id)).length, aliases, unresolved } }
}
