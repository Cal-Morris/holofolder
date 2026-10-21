/**
 * Fills catalog gaps from public sources (pokemontcg-data / Scrydex, Limitless, TCGplayer product data and playshop.fr scans):
 * images for cards the primary source has no image for, cross-source aliases, and promo sets the
 * primary source does not list. See lib/card-gap-fill.ts for the rules and docs/card-image-store.md
 * for how the images are mirrored.
 *
 *   bun scripts/fill-card-gaps.ts            # dry run, writes .cache/card-gap-fill/report.json
 *   bun scripts/fill-card-gaps.ts --apply    # writes through Supabase REST with the service role key
 *
 * Afterwards run the image backfill for the touched sets (POST /api/admin/mirror-card-images?set=<id>)
 * and revalidate the mirror cache (a real POST /api/admin/sync-card-db?set=<id>&images=0).
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { readCatalogMetadata } from "../lib/card-catalog"
import { mapWithConcurrency } from "../lib/card-db-sync-concurrency"
import { currentFallbackImageUrl, GAP_CARD_ALIASES, GAP_IMAGE_SOURCES, GAP_NEW_SETS, planCardGapFill, type GapCard, type GapImagePatch, type GapShopProduct, type GapPlan, type GapLegacyCard, type GapProduct } from "../lib/card-gap-fill"
import { loadProjectEnvFiles } from "../lib/load-project-env"

const args = process.argv.slice(2)
const applying = args.includes("--apply")
const cacheDir = path.resolve(".cache/card-gap-fill")
const USER_AGENT = "BinderDexCatalog/1.0 (+https://binder.cal.gg)"
const LEGACY_ROOT = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en"

async function cachedJson<T>(name: string, url: string): Promise<T> {
  const file = path.join(cacheDir, name)
  try { if (Date.now() - (await stat(file)).mtimeMs < 86_400_000) return JSON.parse(await readFile(file, "utf8")) as T } catch { /* Fetch a fresh copy. */ }
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}; no changes applied`)
  const value = await response.json() as T
  await writeFile(file, JSON.stringify(value))
  return value
}

const SCRYDEX = "https://images.scrydex.com/"
/** Scrydex answers unknown card ids with 200 and a stock "image not found" picture; its ETag identifies it. */
async function scrydexPlaceholderEtag() {
  const response = await fetch(`${SCRYDEX}pokemon/binderdex-missing-0/large`, { method: "HEAD", headers: { "User-Agent": USER_AGENT, Accept: "image/png" }, signal: AbortSignal.timeout(20_000) }).catch(() => null)
  return response?.headers.get("etag") ?? null
}

/**
 * HEAD each image once; results are cached so reruns do not hit the origins again. Scrydex answers
 * are rechecked every run and only count when they are not the placeholder picture.
 */
async function checkImages(urls: string[], scrydexPlaceholder: string | null) {
  const file = path.join(cacheDir, "image-checks.json")
  const known: Record<string, boolean> = await readFile(file, "utf8").then(JSON.parse).catch(() => ({}))
  const todo = [...new Set(urls)].filter(url => !(url in known) || (url.startsWith(SCRYDEX) && !checkedThisRun.has(url)))
  await mapWithConcurrency(todo, 6, async url => {
    const scrydex = url.startsWith(SCRYDEX)
    const response = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT, ...(scrydex ? { Accept: "image/png" } : {}) }, signal: AbortSignal.timeout(20_000) }).catch(() => null)
    const ok = Boolean(response?.ok && (response.headers.get("content-type") ?? "").startsWith("image/"))
    known[url] = ok && !(scrydex && (!scrydexPlaceholder || response?.headers.get("etag") === scrydexPlaceholder))
    if (scrydex) checkedThisRun.add(url)
  })
  await writeFile(file, JSON.stringify(known))
  return known
}
const checkedThisRun = new Set<string>()

/** playshop.fr products for the given TCGdex set ids, found through the store's product sitemaps. */
async function playshopProducts(setIds: string[]): Promise<Record<string, GapShopProduct[]>> {
  if (!setIds.length) return {}
  const file = path.join(cacheDir, "playshop.json")
  try { if (Date.now() - (await stat(file)).mtimeMs < 86_400_000) return JSON.parse(await readFile(file, "utf8")) } catch { /* Fetch a fresh copy. */ }
  const get = async (url: string) => { const r = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`playshop ${new URL(url).pathname}: HTTP ${r.status}`); return r.text() }
  const sitemaps = [...(await get("https://playshop.fr/sitemap.xml")).matchAll(/<loc>(https:\/\/playshop\.fr\/sitemap_products_[^<]+)<\/loc>/g)].map(m => m[1].replaceAll("&amp;", "&"))
  const handles: string[] = []
  for (const sitemap of sitemaps) {
    for (const m of (await get(sitemap)).matchAll(/<loc>https:\/\/playshop\.fr\/products\/(pokemon-[a-z0-9-]+)<\/loc>/g)) {
      if (setIds.some(id => m[1].startsWith(`pokemon-${id}-`))) handles.push(m[1])
    }
  }
  const result: Record<string, GapShopProduct[]> = Object.fromEntries(setIds.map(id => [id, []]))
  await mapWithConcurrency(handles, 3, async handle => {
    const product = JSON.parse(await get(`https://playshop.fr/products/${handle}.json`)).product as { title: string; images: Array<{ src: string }> }
    // Only single-image products: extra images are packaging or back shots.
    if (product.images.length !== 1) return
    const setId = setIds.filter(id => handle.startsWith(`pokemon-${id}-`)).sort((a, b) => b.length - a.length)[0]
    result[setId].push({ handle, title: product.title, image: product.images[0].src })
  })
  for (const list of Object.values(result)) list.sort((a, b) => a.handle.localeCompare(b.handle))
  await writeFile(file, JSON.stringify(result))
  return result
}

function rest(base: string, key: string) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
  const call = async (pathAndQuery: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`REST ${init.method ?? "GET"} ${pathAndQuery.split("?")[0]}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
    return response
  }
  return {
    async all<T>(table: string, select: string): Promise<T[]> {
      const rows: T[] = []
      for (let offset = 0; ; offset += 1000) {
        const page = await (await call(`${table}?select=${select}&order=id&limit=1000&offset=${offset}`)).json() as T[]
        rows.push(...page)
        if (page.length < 1000) return rows
      }
    },
    async upsert(table: string, rows: unknown[], onConflict: string) {
      for (let i = 0; i < rows.length; i += 500) {
        await call(`${table}?on_conflict=${onConflict}`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) })
      }
    },
    async patch(table: string, id: string, values: unknown) {
      await call(`${table}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(values) })
    },
  }
}

async function main() {
  await loadProjectEnvFiles()
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  await mkdir(cacheDir, { recursive: true })
  const db = rest(base.replace(/\/$/, ""), key)

  const [cards, sets, series] = await Promise.all([
    db.all<GapCard>("tcg_cards", "id,set_id,local_id,name_en,image_languages_json,external_ids_json"),
    db.all<{ id: string }>("tcg_sets", "id"),
    db.all<{ id: string }>("tcg_series", "id"),
  ])
  const legacySets = new Set([...Object.values(GAP_IMAGE_SOURCES).flat(), ...GAP_CARD_ALIASES.map(a => a.source)].flatMap(s => "pokemontcg" in s ? [s.pokemontcg] : []))
  const groups = new Set([...Object.values(GAP_IMAGE_SOURCES).flat().flatMap(s => "tcgcsv" in s ? [s.tcgcsv] : []), ...GAP_NEW_SETS.map(s => s.group)])
  const pokemontcg: Record<string, GapLegacyCard[]> = {}
  for (const id of legacySets) pokemontcg[id] = await cachedJson(`pokemontcg-${id}.json`, `${LEGACY_ROOT}/${id}.json`)
  const tcgcsv: Record<number, GapProduct[]> = {}
  for (const group of groups) tcgcsv[group] = (await cachedJson<{ results: GapProduct[] }>(`tcgcsv-${group}.json`, `https://tcgcsv.com/tcgplayer/3/${group}/products`)).results

  const scrydexPlaceholder = await scrydexPlaceholderEtag()
  if (!scrydexPlaceholder) console.warn("[gap-fill] Scrydex placeholder check failed; Scrydex images are skipped this run.")
  const check = (urls: string[]) => checkImages(urls, scrydexPlaceholder)
  const playshop = await playshopProducts(Object.values(GAP_IMAGE_SOURCES).flat().flatMap(s => "playshop" in s ? [s.playshop] : []))
  const productChecks = await check([...groups].flatMap(g => tcgcsv[g].map(p => `https://product-images.tcgplayer.com/${p.productId}.jpg`)))
  // Cards that render a fallback image which no longer exists are filled like cards without an image.
  const current = cards.flatMap(card => { const url = currentFallbackImageUrl(card); return url ? [[card.id, url] as const] : [] })
  const currentChecks = await check(current.map(([, url]) => url))
  const brokenImages = new Set(current.filter(([, url]) => !currentChecks[url]).map(([id]) => id))
  const input = { brokenImages, cards, existingSetIds: new Set(sets.map(s => s.id)), existingSeriesIds: new Set(series.map(s => s.id)), pokemontcg, tcgcsv, playshop,
    hasProductImage: (pid: string) => productChecks[`https://product-images.tcgplayer.com/${pid}.jpg`] === true }
  // Plan, check every chosen image, and replan without the dead ones so the next source is tried.
  const unavailableImages = new Set<string>()
  let plan!: GapPlan
  for (let round = 0; round < 5; round++) {
    const draft = planCardGapFill({ ...input, unavailableImages })
    let checks = await check(draft.images.map(p => p.image))
    // pokemontcg.io lacks a few scans that Scrydex serves under the same card id.
    const images: Array<GapImagePatch & { original?: string }> = draft.images.map(p => {
      const id = p.source.startsWith("pokemontcg:") ? p.source.slice("pokemontcg:".length) : null
      return checks[p.image] || !id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? p : { ...p, original: p.image, image: `https://images.scrydex.com/pokemon/${id}/large` }
    })
    checks = { ...checks, ...await check(images.map(p => p.image)) }
    const dead = images.filter(p => !checks[p.image])
    const fresh = dead.filter(p => !unavailableImages.has(p.image))
    plan = { ...draft, images: images.filter(p => checks[p.image]).map(({ original: _original, ...p }) => p),
      unresolved: [...draft.unresolved, ...dead.map(p => ({ cardId: p.cardId, reason: `Source image unavailable: ${p.image}` }))] }
    if (!fresh.length) break
    for (const p of fresh) { unavailableImages.add(p.image); if (p.original) unavailableImages.add(p.original) }
  }

  const report = {
    brokenImages: [...brokenImages].sort(), images: plan.images.length, imagesBySet: Object.fromEntries([...new Set(plan.images.map(p => cards.find(c => c.id === p.cardId)?.set_id ?? "?"))].map(s => [s, plan.images.filter(p => cards.find(c => c.id === p.cardId)?.set_id === s).length])),
    aliases: plan.aliases, sets: plan.sets.map(s => ({ id: s.id, cards: plan.cards.filter(c => c.set_id === s.id).length })), dexLinks: plan.dexLinks.length,
    unresolved: plan.unresolved, notes: plan.notes, imagePatches: plan.images,
  }
  await writeFile(path.join(cacheDir, "report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, imagePatches: undefined }, null, 2))
  if (!applying) { console.log("Dry run; pass --apply to write."); return }

  // Catalog metadata is merged into the current row so other catalog keys survive.
  const patches = new Map<string, Record<string, unknown>>()
  for (const p of plan.images) patches.set(p.cardId, { ...patches.get(p.cardId), image: p.image, ...(p.productId ? { productId: p.productId } : {}), imageSource: p.source })
  for (const a of plan.aliases) patches.set(a.cardId, { ...patches.get(a.cardId), ...a.catalog })
  const byId = new Map(cards.map(c => [c.id, c]))
  await mapWithConcurrency([...patches], 6, async ([id, patch]) => {
    const current = byId.get(id)!.external_ids_json
    const existing = (current.catalog && typeof current.catalog === "object" ? current.catalog : {}) as Record<string, unknown>
    const aliasIds = [...new Set([...(readCatalogMetadata(current).aliasIds ?? []), ...((patch.aliasIds as string[] | undefined) ?? [])])].sort()
    await db.patch("tcg_cards", id, { external_ids_json: { ...current, catalog: { ...existing, ...patch, ...(aliasIds.length ? { aliasIds } : {}) } }, updated_at: new Date().toISOString() })
  })
  if (plan.series.length) await db.upsert("tcg_series", plan.series, "id")
  if (plan.sets.length) await db.upsert("tcg_sets", plan.sets, "id")
  if (plan.cards.length) await db.upsert("tcg_cards", plan.cards, "id")
  if (plan.externalSources.length) await db.upsert("tcg_card_external_sources", plan.externalSources, "card_id,source")
  if (plan.dexLinks.length) await db.upsert("tcg_card_dex_ids", plan.dexLinks, "card_id,dex_id")
  console.log(`Applied ${patches.size} catalog patches, ${plan.sets.length} sets, ${plan.cards.length} cards, ${plan.dexLinks.length} Pokédex links.`)
}

if (import.meta.main) {
  main().catch(error => { console.error("[gap-fill] Failed:", error instanceof Error ? error.message : error); process.exitCode = 1 })
}
