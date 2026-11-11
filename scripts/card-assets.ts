/**
 * Card image sourcing: which source each card's image comes from, and why. Read card-assets/AGENTS.md first.
 *
 *   bun run card-assets plan [--set a,b] [--game pokemon/tcg]   rewrite the ledger from the database and rules.csv
 *   bun run card-assets verify [--bucket <name>]                check sources, rules, atlas, ledger freshness and
 *                                                               what the app serves; --bucket also checks R2 coverage
 *   bun run card-assets atlas                                   refresh the pinned PTCG Image Atlas data.json
 *   bun run card-assets migrate-bucket [--apply]                copy cards/... from binderdex-card-images to
 *                                                               pokemon/tcg/cards/... in holofolder-assets
 *
 * plan, verify and atlas read Postgres (POSTGRES_URL_NON_POOLING or DATABASE_URL) in a read-only transaction and
 * write only files under card-assets/. migrate-bucket copies R2 objects server side and records them in
 * card_image_inventory; it needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY for a token that can
 * read the source bucket and write the destination.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { AwsClient } from "aws4fetch"
import { Client } from "pg"
import { parseListedObjects, planBucketCopy, type ListedObject } from "../lib/card-assets/bucket-migration"
import { pickCardImageUrl } from "../lib/card-image-sources"
import { crossCheckAtlas, LEDGER_COLUMNS, ledgerRow, parseRules, parseSources, toCsv, type AtlasData, type LedgerRow, type MirrorCardRow } from "../lib/card-assets/ledger"
import { getMirrorDatabaseUrl } from "../lib/card-db-sync"
import { developerImageKey } from "../lib/developer-api/image-identity"
import { loadProjectEnvFiles } from "../lib/load-project-env"
import { buildTcgdexAssetImageUrl, pickImageLanguage } from "../lib/tcgdex-shared"
import { CARD_IMAGE_BLOB_PREFIX, LEGACY_CARD_IMAGE_BLOB_PREFIX } from "../lib/tcgdex-card-image"

const ATLAS_REPO = "nstrelow/ptcg-image-atlas"
const LANG = "en"

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const game = arg("game") ?? "pokemon/tcg"
if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(game)) throw new Error("--game must look like <brand>/<game>, e.g. pokemon/tcg")
const root = path.resolve("card-assets", game)
const ledgerDir = path.join(root, "ledger", LANG)

async function loadConfig() {
  const sources = parseSources(await readFile(path.join(root, "sources.csv"), "utf8"))
  const rules = parseRules(await readFile(path.join(root, "rules.csv"), "utf8"), sources)
  const atlas = JSON.parse(await readFile(path.join(root, "atlas", "data.json"), "utf8")) as AtlasData
  return { sources, rules, atlas }
}

async function withDb<T>(run: (db: Client) => Promise<T>) {
  const db = new Client({ connectionString: getMirrorDatabaseUrl() })
  await db.connect()
  try {
    await db.query("begin read only")
    await db.query("set local statement_timeout = '120s'")
    return await run(db)
  } finally {
    await db.query("rollback").catch(() => {})
    await db.end()
  }
}

async function loadCards(db: Client, sets: string[] | null) {
  const { rows } = await db.query<MirrorCardRow>(
    `select id, series_id, set_id, local_id, name_en, image_languages_json, external_ids_json
       from public.tcg_cards ${sets ? "where set_id = any($1)" : ""}
      order by set_id, local_id_sort nulls last, local_id, id`,
    sets ? [sets] : [],
  )
  return rows
}

function buildLedgers(cards: readonly MirrorCardRow[], config: Awaited<ReturnType<typeof loadConfig>>) {
  const ledgers = new Map<string, LedgerRow[]>()
  for (const card of cards) {
    const rows = ledgers.get(card.set_id) ?? []
    rows.push(ledgerRow(card, config.rules, config.sources, LANG))
    ledgers.set(card.set_id, rows)
  }
  return ledgers
}

function ledgerFile(setId: string) {
  return path.join(ledgerDir, `${setId}.csv`)
}

/** What the app serves today for this card (lib/tcg-mirror.ts calls pickCardImageUrl the same way). */
function appImage(card: MirrorCardRow) {
  const imageLanguage = pickImageLanguage(card.image_languages_json, LANG)
  return pickCardImageUrl(card.external_ids_json, imageLanguage, imageLanguage && buildTcgdexAssetImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id), LANG) ?? ""
}

function summarize(ledgers: Map<string, LedgerRow[]>) {
  const rows = [...ledgers.values()].flat()
  const count = (pick: (row: LedgerRow) => string) => {
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(pick(row), (counts.get(pick(row)) ?? 0) + 1)
    return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]))
  }
  return {
    cards: rows.length,
    sets: ledgers.size,
    bySource: count(row => row.source || "none"),
    byKind: count(row => row.kind || "none"),
    weak: {
      none: rows.filter(row => !row.source).length,
      foreignPrint: rows.filter(row => row.image_language && row.image_language !== LANG).length,
      retailPhoto: rows.filter(row => row.kind === "retail-photo").length,
    },
  }
}

async function plan() {
  await loadProjectEnvFiles()
  const config = await loadConfig()
  const sets = arg("set")?.split(",").map(id => id.trim()).filter(Boolean) ?? null
  const cards = await withDb(db => loadCards(db, sets))
  const ledgers = buildLedgers(cards, config)
  await mkdir(ledgerDir, { recursive: true })
  if (!sets) {
    // A full plan also removes ledgers for sets that no longer exist.
    for (const file of await readdir(ledgerDir)) if (file.endsWith(".csv") && !ledgers.has(file.slice(0, -4))) await rm(path.join(ledgerDir, file))
  }
  for (const [setId, rows] of ledgers) await writeFile(ledgerFile(setId), toCsv(LEDGER_COLUMNS, rows))
  console.log(JSON.stringify(summarize(ledgers), null, 2))
}

async function verify() {
  await loadProjectEnvFiles()
  const config = await loadConfig()
  const problems: string[] = []
  const atlasCheck = crossCheckAtlas(config.sources, config.atlas)
  problems.push(...atlasCheck.errors)
  for (const warning of atlasCheck.warnings) console.warn(`warning: ${warning}`)

  const bucket = arg("bucket")
  const { cards, stored } = await withDb(async db => ({
    cards: await loadCards(db, null),
    stored: bucket ? new Set((await db.query<{ object_key: string }>("select object_key from public.card_image_inventory where bucket = $1", [bucket])).rows.map(row => row.object_key)) : null,
  }))
  const ledgers = buildLedgers(cards, config)

  const committed = new Set((await readdir(ledgerDir).catch(() => [] as string[])).filter(file => file.endsWith(".csv")).map(file => file.slice(0, -4)))
  const stale: string[] = []
  for (const [setId, rows] of ledgers) {
    const current = await readFile(ledgerFile(setId), "utf8").catch(() => null)
    if (current !== toCsv(LEDGER_COLUMNS, rows)) stale.push(setId)
    committed.delete(setId)
  }
  stale.push(...[...committed].map(setId => `${setId} (no longer in the database)`))
  if (stale.length) problems.push(`ledger is out of date for ${stale.length} set(s), run plan: ${stale.slice(0, 20).join(", ")}${stale.length > 20 ? ", …" : ""}`)

  // Rules the app doesn't serve yet: expected after a rule change until it's published, so reported, not failed.
  const byId = new Map(cards.map(card => [card.id, card]))
  const rows = [...ledgers.values()].flat()
  const unpublished = rows.filter(row => row.url !== appImage(byId.get(row.card_id)!))
  console.log(JSON.stringify({
    cards: rows.length,
    differsFromApp: unpublished.length,
    differsFromAppExamples: unpublished.slice(0, 10).map(row => ({ card: row.card_id, ledger: row.url, app: appImage(byId.get(row.card_id)!) })),
    ...(stored ? { notInBucket: rows.filter(row => { const key = row.url && developerImageKey(row.url); return key && !stored.has(key) }).length, bucket } : {}),
  }, null, 2))

  if (problems.length) {
    for (const problem of problems) console.error(`error: ${problem}`)
    process.exitCode = 1
  }
}

async function refreshAtlas() {
  const headers = { "User-Agent": "HoloFolderCardAssets/1.0 (+https://holofolder.com)", Accept: "application/vnd.github+json" }
  const commit = await fetch(`https://api.github.com/repos/${ATLAS_REPO}/commits/main`, { headers }).then(response => {
    if (!response.ok) throw new Error(`atlas commit lookup: HTTP ${response.status}`)
    return response.json() as Promise<{ sha: string; commit: { committer: { date: string } } }>
  })
  const response = await fetch(`https://raw.githubusercontent.com/${ATLAS_REPO}/${commit.sha}/data.json`, { headers })
  if (!response.ok) throw new Error(`atlas data.json: HTTP ${response.status}`)
  const text = await response.text()
  const atlas = JSON.parse(text) as AtlasData
  await mkdir(path.join(root, "atlas"), { recursive: true })
  await writeFile(path.join(root, "atlas", "data.json"), text)
  const licence = await fetch(`https://raw.githubusercontent.com/${ATLAS_REPO}/${commit.sha}/LICENSE`, { headers })
  if (!licence.ok) throw new Error(`atlas LICENSE: HTTP ${licence.status}`)
  await writeFile(path.join(root, "atlas", "LICENSE"), await licence.text())
  await writeFile(path.join(root, "atlas", "SOURCE"), `https://github.com/${ATLAS_REPO}/blob/${commit.sha}/data.json\ncommitted ${commit.commit.committer.date}\nMIT licence, by Luna (${ATLAS_REPO}). Pinned copy; refresh with: bun run card-assets atlas\n`)
  const sources = parseSources(await readFile(path.join(root, "sources.csv"), "utf8"))
  const known = new Set(sources.map(source => source.atlasId).filter(Boolean))
  console.log(JSON.stringify({ commit: commit.sha, atlasSources: atlas.sources.length, notInSourcesCsv: atlas.sources.filter(source => !known.has(source.id)).map(source => source.id) }, null, 2))
}

async function migrateBucket() {
  await loadProjectEnvFiles()
  const from = arg("from") ?? "binderdex-card-images"
  const to = arg("to") ?? "holofolder-assets"
  const apply = process.argv.includes("--apply")
  const concurrency = Number(arg("concurrency") ?? 8)
  const [accountId, accessKeyId, secretAccessKey] = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].map(name => process.env[name]?.trim() ?? "")
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !accessKeyId || !secretAccessKey) throw new Error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (a token that reads the source and writes the destination)")
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto", retries: 3 })
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`

  async function list(bucket: string, prefix: string) {
    const objects: ListedObject[] = []
    let token: string | null = null
    do {
      const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" })
      if (token) query.set("continuation-token", token)
      const response = await client.fetch(`${endpoint}/${bucket}?${query}`)
      if (!response.ok) throw new Error(`LIST ${bucket}: HTTP ${response.status} ${await response.text()}`)
      const page = parseListedObjects(await response.text())
      objects.push(...page.objects)
      token = page.nextContinuationToken
    } while (token)
    return objects
  }

  const destinationPrefix = `${CARD_IMAGE_BLOB_PREFIX}/`
  const source = await list(from, `${LEGACY_CARD_IMAGE_BLOB_PREFIX}/`)
  let destination = await list(to, destinationPrefix)
  let plan = planBucketCopy(source, destination)
  console.log(JSON.stringify({ from, to, sourceObjects: source.length, destinationObjects: destination.length, toCopy: plan.copy.length, toCopyBytes: plan.copy.reduce((sum, item) => sum + item.size, 0), alreadyThere: plan.matching, mismatched: plan.mismatched.length, apply }, null, 2))
  if (!apply) {
    if (plan.copy.length || plan.mismatched.length) process.exitCode = 1
    return
  }

  let next = 0
  let copied = 0
  const failures: string[] = []
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.copy.length) }, async () => {
    while (next < plan.copy.length) {
      const item = plan.copy[next++]
      // Server-side CopyObject: no download, one Class A operation; metadata and Cache-Control are copied.
      const response = await client.fetch(`${endpoint}/${to}/${item.to}`, { method: "PUT", headers: { "x-amz-copy-source": `/${from}/${item.from}` } })
      if (response.ok) copied++
      else failures.push(`${item.from}: HTTP ${response.status}`)
      if ((copied + failures.length) % 2000 === 0) console.log(`copied ${copied}, failed ${failures.length} of ${plan.copy.length}`)
    }
  }))
  if (failures.length) console.error(failures.slice(0, 20).join("\n"))

  destination = await list(to, destinationPrefix)
  plan = planBucketCopy(source, destination)
  // Record every copied object for the developer API, so the new bucket's inventory is complete before the switch.
  const keys = destination.map(object => object.key)
  const db = new Client({ connectionString: getMirrorDatabaseUrl() })
  await db.connect()
  try {
    for (let i = 0; i < keys.length; i += 1000) {
      await db.query(
        `insert into public.card_image_inventory (bucket, object_key, observed_at)
         select $1, key, now() from unnest($2::text[]) as key
         on conflict (bucket, object_key) do update set observed_at = excluded.observed_at`,
        [to, keys.slice(i, i + 1000)],
      )
    }
  } finally {
    await db.end()
  }
  console.log(JSON.stringify({ copied, failed: failures.length, destinationObjects: destination.length, inventoryRows: keys.length, stillMissing: plan.copy.length, mismatched: plan.mismatched.length }, null, 2))
  if (failures.length || plan.copy.length || plan.mismatched.length) process.exitCode = 1
}

const commands: Record<string, () => Promise<void>> = { plan, verify, atlas: refreshAtlas, "migrate-bucket": migrateBucket }
const command = commands[process.argv[2] ?? ""]
if (!command) {
  console.error(`Usage: bun run card-assets <${Object.keys(commands).join("|")}> [options]. See card-assets/AGENTS.md.`)
  process.exitCode = 2
} else {
  command().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
