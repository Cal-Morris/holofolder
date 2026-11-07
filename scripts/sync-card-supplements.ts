import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Client } from "pg"
import { buildCatalogSupplement, type CatalogProduct, type LegacyCatalogCard } from "../lib/card-catalog-supplement"
import { getMirrorDatabaseUrl, upsertRestSetPayload, type MirrorCardRow, type MirrorSetRow } from "../lib/card-db-sync"
import { mapWithConcurrency } from "../lib/card-db-sync-concurrency"
import { loadProjectEnvFiles } from "../lib/load-project-env"
import { catalogDatabaseIdentity, catalogFingerprint } from "../lib/card-catalog-safety"

const args = process.argv.slice(2)
const option = (name: string) => args[args.indexOf(name) + 1]
const applying = args.includes("--apply")
const sourceDir = args.includes("--source-dir") ? path.resolve(option("--source-dir")) : path.resolve(".cache/card-catalog")
const reportPath = args.includes("--report") ? path.resolve(option("--report")) : path.join(sourceDir, "supplement-report.json")
const BACKUP_TABLES = ["pokemon_collection", "user_settings", "partnerships", "partner_invites", "binder_shares", "binder_appearances", "collection_activity"]
const CARD_SELECT = "select id, series_id, set_id, local_id, local_id_sort, name_json, name_en, category, rarity, hp, illustrator, types_json, image_languages_json, variants_json, external_ids_json, raw_json from public.tcg_cards order by id"
const SET_SELECT = "select id, series_id, name_json, name_en, official_card_count, release_date::text, raw_json from public.tcg_sets order by id"

async function jsonFile<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T }
async function cachedJson<T>(filename: string, url: string): Promise<T> {
  const file = path.join(sourceDir, filename)
  try { if (Date.now() - (await stat(file)).mtimeMs < 86_400_000) return await jsonFile<T>(file) } catch { /* Fetch an absent snapshot. */ }
  const response = await fetch(url, { headers: { "User-Agent": "HoloFolderCatalog/1.0 (+https://holofolder.com)", Accept: "application/json" }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Catalog source ${filename}: HTTP ${response.status}; no changes applied`)
  const value = await response.json() as T
  await writeFile(file, JSON.stringify(value))
  return value
}

async function loadSources() {
  await mkdir(sourceDir, { recursive: true })
  const legacyRoot = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/39a26a144c8b6ef6c2fb17b2c29d0bb7121e3a11"
  const archived = path.join(sourceDir, "pokemon-tcg-data-master")
  const hasArchive = await stat(archived).then(s => s.isDirectory()).catch(() => false)
  const legacySets = hasArchive
    ? await jsonFile<Array<{ id: string }>>(path.join(archived, "sets/en.json"))
    : await cachedJson<Array<{ id: string }>>("legacy-sets.json", `${legacyRoot}/sets/en.json`)
  if (!Array.isArray(legacySets) || legacySets.some(s => typeof s.id !== "string" || !/^[a-z0-9._-]+$/i.test(s.id))) throw new Error("Invalid legacy set source")
  const groups = await cachedJson<{ results: Array<{ groupId: number }> }>("tcgcsv-groups.json", "https://tcgcsv.com/tcgplayer/3/groups")
  if (!Array.isArray(groups.results) || !groups.results.length) throw new Error("Invalid product group source")
  const sourceCards = await mapWithConcurrency(legacySets, 6, async set => {
    const cards = hasArchive
      ? await jsonFile<LegacyCatalogCard[]>(path.join(archived, `cards/en/${set.id}.json`))
      : await cachedJson<LegacyCatalogCard[]>(`legacy-${set.id}.json`, `${legacyRoot}/cards/en/${set.id}.json`)
    if (!Array.isArray(cards) || cards.some(c => typeof c.id !== "string" || (c.name != null && typeof c.name !== "string"))) throw new Error(`Invalid card source ${set.id}`)
    return cards.map(card => ({ ...card, sourceSetId: set.id }))
  })
  const productGroups = await mapWithConcurrency(groups.results, 6, async group => {
    if (!Number.isInteger(group.groupId)) throw new Error("Invalid product group ID")
    const payload = await cachedJson<{ results: CatalogProduct[] }>(`tcgcsv-${group.groupId}.json`, `https://tcgcsv.com/tcgplayer/3/${group.groupId}/products`)
    if (!Array.isArray(payload.results) || payload.results.some(p => !Number.isInteger(p.productId) || typeof p.name !== "string" || !Array.isArray(p.extendedData))) throw new Error(`Invalid product source ${group.groupId}`)
    return payload.results
  })
  return { legacyCards: sourceCards.flat(), legacySets, products: productGroups.flat() }
}

async function userFingerprints(client: Client) {
  const result: Record<string, { count: number; hash: string }> = {}
  for (const table of BACKUP_TABLES) {
    const query = await client.query(`select count(*)::int as count, md5(coalesce(string_agg(row_hash, '' order by row_hash), '')) as hash from (select md5(row_to_json(t)::text) as row_hash from public.${table} t) rows`)
    result[table] = query.rows[0]
  }
  return result
}

async function main() {
  await loadProjectEnvFiles()
  const sources = await loadSources()
  const client = new Client({ connectionString: getMirrorDatabaseUrl() })
  await client.connect()
  try {
    const cards = (await client.query<MirrorCardRow>(CARD_SELECT)).rows
    const sets = (await client.query<MirrorSetRow>(SET_SELECT)).rows
    const plannedSnapshot = catalogFingerprint({ cards, sets })
    const original = new Map(cards.map(c => [c.id, c]))
    console.log(`Read ${cards.length} catalog cards, ${sources.products.length} products and ${sources.legacyCards.length} legacy cards`)
    const prospective = buildCatalogSupplement({ ...sources, cards, sets, checkedImages: new Set(sources.products.map(p => String(p.productId))) })
    const imageIds = [...new Set(prospective.cards.filter(c => !isDeepStrictEqual(original.get(c.id), c)).map(c => (c.external_ids_json.catalog as { productId?: string })?.productId).filter((id): id is string => Boolean(id)))]
    const checked = await mapWithConcurrency(imageIds, 6, async id => {
      const file = path.join(sourceDir, `image-check-${id}.json`)
      try { if (Date.now() - (await stat(file)).mtimeMs < 86_400_000) return await jsonFile<{ id: string; available: boolean }>(file) } catch { /* Check a new product image. */ }
      const available = await fetch(`https://product-images.tcgplayer.com/${id}.jpg`, { method: "HEAD", signal: AbortSignal.timeout(15_000) }).then(r => r.ok && Boolean(r.headers.get("content-type")?.startsWith("image/"))).catch(() => false)
      const result = { id, available }; await writeFile(file, JSON.stringify(result)); return result
    })
    const result = buildCatalogSupplement({ ...sources, cards, sets, checkedImages: new Set(checked.filter(c => c.available).map(c => c.id)) })
    const changed = result.cards.filter(c => !isDeepStrictEqual(original.get(c.id), c))
    const unresolved = [...new Map([...prospective.report.unresolved, ...result.report.unresolved].map(row => [`${row.source}:${row.id}:${row.reason}`, row])).values()]
    const report = { ...result.report, unresolved, changed: changed.length, checkedImages: checked.length, availableImages: checked.filter(c => c.available).length,
      cards: changed.map(c => ({ id: c.id, name: c.name_en, set: c.set_id, metadata: c.external_ids_json.catalog })) }
    await mkdir(path.dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ added: report.added, changed: report.changed, aliases: report.aliases, unresolved: report.unresolved.length, checkedImages: report.checkedImages, availableImages: report.availableImages, reportPath }))
    if (!applying) return
    if (!args.includes("--backup-dir")) throw new Error("--apply requires --backup-dir with a verified private production backup")
    const backup = path.resolve(option("--backup-dir"))
    const manifest = await jsonFile<{ createdAt: string; databaseIdentity: string; sha256: string }>(path.join(backup, "manifest.json"))
    const hash = createHash("sha256").update(await readFile(path.join(backup, "public-schema.dump"))).digest("hex")
    const age = Date.now() - Date.parse(manifest.createdAt)
    if (hash !== manifest.sha256 || !Number.isFinite(age) || age < 0 || age > 86_400_000 || manifest.databaseIdentity !== catalogDatabaseIdentity(getMirrorDatabaseUrl())) throw new Error("Backup is invalid, stale or belongs to another target")
    await client.query("BEGIN")
    try {
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '60s'")
      const lock = await client.query("select pg_try_advisory_xact_lock(10250418) as locked")
      if (!lock.rows[0].locked) throw new Error("Another catalog sync is running")
      const fresh = (await client.query<MirrorCardRow>(CARD_SELECT)).rows
      const freshSets = (await client.query<MirrorSetRow>(SET_SELECT)).rows
      if (catalogFingerprint({ cards: fresh, sets: freshSets }) !== plannedSnapshot) throw new Error("Catalog changed while planning; rerun against the fresh source rows")
      await client.query(`LOCK TABLE ${BACKUP_TABLES.map(t => `public.${t}`).join(", ")} IN SHARE MODE`)
      const before = await userFingerprints(client)
      const current = (await client.query("select id, updated_at::text from public.tcg_cards order by id")).rows
      await upsertRestSetPayload(client, { series: result.series, sets: result.sets, cards: changed, dexLinks: result.dexLinks, externalSources: result.externalSources }, undefined, false)
      const after = await userFingerprints(client)
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Binder-data verification failed; rolling back catalog update")
      const idsAfter = new Set((await client.query("select id from public.tcg_cards")).rows.map(r => r.id))
      if (current.some(c => !idsAfter.has(c.id))) throw new Error("Existing catalog ID disappeared; rolling back")
      await writeFile(path.join(backup, "apply-verification.json"), JSON.stringify({ at: new Date().toISOString(), reportPath, before, after, existingIdsPreserved: current.length, added: report.added, changed: changed.length }, null, 2), { mode: 0o600 })
      await client.query("COMMIT")
      console.log(`Applied ${changed.length} catalog rows; all saved binder rows and ${current.length} existing catalog IDs preserved`)
    } catch (error) { await client.query("ROLLBACK"); throw error }
  } finally { await client.end() }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Catalog supplement failed"); process.exitCode = 1 })
