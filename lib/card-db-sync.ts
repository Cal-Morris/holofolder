import { spawn } from "node:child_process"
import { access, mkdir, readFile, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Client } from "pg"

type SupportedLanguage = "en" | "ja"

type MirrorSeriesRow = {
  id: string
  name_json: Record<string, string>
  name_en: string | null
  raw_json: Record<string, unknown>
}

type MirrorSetRow = {
  id: string
  series_id: string
  name_json: Record<string, string>
  name_en: string | null
  official_card_count: number | null
  release_date: string | null
  raw_json: Record<string, unknown>
}

type MirrorCardRow = {
  id: string
  series_id: string
  set_id: string
  local_id: string
  local_id_sort: number | null
  name_json: Record<string, string>
  name_en: string | null
  category: string | null
  rarity: string | null
  hp: number | null
  illustrator: string | null
  types_json: string[]
  image_languages_json: string[]
  variants_json: Partial<Record<"normal" | "reverse" | "holo" | "firstEdition" | "wPromo", boolean>>
  raw_json: Record<string, unknown>
}

type TCGSeries = {
  id: string
  name: Record<string, string>
}

type TCGSet = {
  id: string
  name: Record<string, string>
  serie: TCGSeries
  cardCount?: {
    official?: number
  }
  releaseDate?: string | Record<string, string>
}

type TCGCard = {
  set: TCGSet
  name?: Record<string, string> | string
  category?: string
  rarity?: string
  hp?: number | string
  illustrator?: string
  types?: string[]
  variants?:
    | Array<{
        type?: string
        stamp?: string[]
      }>
    | {
        normal?: boolean
        reverse?: boolean
        holo?: boolean
        firstEdition?: boolean
        wPromo?: boolean
      }
  dexId?: number[]
}

interface AssetManifestNode {
  [key: string]: AssetManifestNode | string
}

type AssetManifest = Record<string, AssetManifestNode>

export interface CardDbSyncResult {
  repoCommit: string
  seriesCount: number
  setCount: number
  cardCount: number
  dexLinkCount: number
}

interface CardDbSyncOptions {
  logger?: (message: string) => void
  projectRoot?: string
}

const REPO_URL = "https://github.com/tcgdex/cards-database"
const DEFAULT_BATCH_SIZE = 500
const CARD_DB_SYNC_LOCK_KEY = 10250418

function getProjectRoot(projectRoot?: string) {
  return projectRoot || process.cwd()
}

function getRepoDir(projectRoot?: string) {
  const configuredRepoDir = process.env.BINDERDEX_TCG_REPO_DIR
  if (configuredRepoDir) {
    return configuredRepoDir
  }

  return path.join(os.homedir(), ".cache", "binderdex", "tcgdex-cards-database")
}

function getDataDir(projectRoot?: string) {
  return path.join(getRepoDir(projectRoot), "data")
}

function getSchemaSqlPath(projectRoot?: string) {
  return path.join(getProjectRoot(projectRoot), "scripts", "004_create_tcg_mirror_tables.sql")
}

function logWith(logger: ((message: string) => void) | undefined, message: string) {
  if (logger) {
    logger(message)
    return
  }

  console.log(`[sync-card-db] ${message}`)
}

export async function loadProjectEnvFiles(projectRoot?: string) {
  const root = getProjectRoot(projectRoot)
  const envFiles = [path.join(root, ".env"), path.join(root, ".env.local")]

  for (const filePath of envFiles) {
    try {
      const contents = await readFile(filePath, "utf8")
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue

        const separatorIndex = trimmed.indexOf("=")
        if (separatorIndex === -1) continue

        const key = trimmed.slice(0, separatorIndex).trim()
        const rawValue = trimmed.slice(separatorIndex + 1).trim()
        const unquotedValue = rawValue.replace(/^['"]|['"]$/g, "")

        if (!process.env[key]) {
          process.env[key] = unquotedValue
        }
      }
    } catch {
      continue
    }
  }
}

function ensureEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

export function withNoVerifySslMode(connectionString: string) {
  const separator = connectionString.includes("?") ? "&" : "?"
  if (connectionString.includes("sslmode=")) {
    return connectionString.replace(/sslmode=([^&]+)/, "sslmode=no-verify")
  }
  return `${connectionString}${separator}sslmode=no-verify`
}

export function getMirrorDatabaseUrl() {
  return withNoVerifySslMode(process.env.POSTGRES_URL_NON_POOLING || ensureEnv("DATABASE_URL"))
}

async function runCommand(command: string, args: string[], cwd: string | undefined, logger?: (message: string) => void) {
  logWith(logger, `$ ${command} ${args.join(" ")}`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function pathExists(target: string) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function ensureCardsDatabaseRepo(projectRoot: string, logger?: (message: string) => void) {
  const repoDir = getRepoDir(projectRoot)
  await mkdir(path.dirname(repoDir), { recursive: true })

  const hasGitDir = await pathExists(path.join(repoDir, ".git"))
  if (!hasGitDir) {
    logWith(logger, `Cloning ${REPO_URL} into ${repoDir}`)
    await runCommand("git", ["clone", "--depth=1", REPO_URL, repoDir], undefined, logger)
    return repoDir
  }

  logWith(logger, `Pulling latest cards-database changes in ${repoDir}`)
  await runCommand("git", ["pull", "--ff-only"], repoDir, logger)
  return repoDir
}

async function getRepoCommitSha(repoDir: string) {
  let output = ""

  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    })

    child.stdout.on("data", (chunk) => {
      output += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`git rev-parse exited with code ${code}`))
    })
  })

  return output.trim()
}

async function findCardFiles(rootDir: string): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue
      }

      const relativePath = path.relative(rootDir, fullPath)
      const segments = relativePath.split(path.sep)
      if (segments.length === 3) {
        files.push(fullPath)
      }
    }
  }

  await walk(rootDir)
  files.sort((a, b) => a.localeCompare(b))
  return files
}

function pickLocalizedText(
  value: string | Record<string, string> | undefined,
  language: SupportedLanguage = "en",
) {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value !== "object") return null

  const directMatch = value[language]
  if (typeof directMatch === "string" && directMatch.length > 0) {
    return directMatch
  }

  const preferredFallbacks = ["en", "ja", "fr", "de", "es", "it", "pt-br", "ko"]
  for (const fallback of preferredFallbacks) {
    const candidate = value[fallback]
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  for (const candidate of Object.values(value)) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  return null
}

function normalizeLocalizedMap(value: string | Record<string, string> | undefined) {
  if (!value) return {}
  if (typeof value === "string") {
    return { en: value }
  }
  return value
}

function normalizeVariants(cardVariants: TCGCard["variants"]) {
  if (!cardVariants) {
    return {}
  }

  if (Array.isArray(cardVariants)) {
    return {
      normal: cardVariants.some((variant) => variant?.type === "normal"),
      reverse: cardVariants.some((variant) => variant?.type === "reverse"),
      holo: cardVariants.some((variant) => variant?.type === "holo"),
      firstEdition: cardVariants.some((variant) => variant?.stamp?.includes("1st-edition")),
      wPromo: cardVariants.some((variant) => variant?.stamp?.includes("w-Promo")),
    }
  }

  return {
    normal: Boolean(cardVariants.normal),
    reverse: Boolean(cardVariants.reverse),
    holo: Boolean(cardVariants.holo),
    firstEdition: Boolean(cardVariants.firstEdition),
    wPromo: Boolean(cardVariants.wPromo),
  }
}

function normalizeInteger(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10)
  }

  return null
}

function normalizeLocalIdSort(localId: string) {
  const match = localId.match(/\d+/)
  if (!match) return null

  const parsed = Number.parseInt(match[0], 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeReleaseDate(value: string | Record<string, string> | undefined) {
  const resolved = pickLocalizedText(value, "en")
  if (!resolved) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(resolved) ? resolved : null
}

async function fetchAssetManifest(logger?: (message: string) => void): Promise<AssetManifest> {
  logWith(logger, "Fetching TCGdex asset manifest")
  const response = await fetch("https://assets.tcgdex.net/datas.json")

  if (!response.ok) {
    throw new Error(`Failed to fetch TCGdex asset manifest: ${response.status}`)
  }

  return (await response.json()) as AssetManifest
}

function getImageLanguages(
  assetManifest: AssetManifest,
  seriesId: string,
  setId: string,
  localId: string,
) {
  return Object.entries(assetManifest)
    .filter(([, seriesMap]) => {
      const candidate = seriesMap?.[seriesId]
      if (!candidate || typeof candidate !== "object") {
        return false
      }

      const setMap = candidate[setId]
      if (!setMap || typeof setMap !== "object") {
        return false
      }

      return typeof setMap[localId] === "string"
    })
    .map(([language]) => language)
}

async function buildMirrorPayload(projectRoot: string, logger?: (message: string) => void) {
  const seriesById = new Map<string, MirrorSeriesRow>()
  const setsById = new Map<string, MirrorSetRow>()
  const cardsById = new Map<string, MirrorCardRow>()
  const dexLinks = new Set<string>()
  const assetManifest = await fetchAssetManifest(logger)

  const cardFiles = await findCardFiles(getDataDir(projectRoot))
  logWith(logger, `Found ${cardFiles.length} card files`)

  for (const [index, filePath] of cardFiles.entries()) {
    const imported = (await import(pathToFileURL(filePath).href)) as { default: TCGCard }
    const card = imported.default
    const localId = path.basename(filePath, ".ts")
    const set = card.set
    const series = set?.serie

    if (!set?.id || !series?.id) {
      throw new Error(`Card file is missing set metadata: ${filePath}`)
    }

    seriesById.set(series.id, {
      id: series.id,
      name_json: normalizeLocalizedMap(series.name),
      name_en: pickLocalizedText(series.name, "en"),
      raw_json: series as unknown as Record<string, unknown>,
    })

    setsById.set(set.id, {
      id: set.id,
      series_id: series.id,
      name_json: normalizeLocalizedMap(set.name),
      name_en: pickLocalizedText(set.name, "en"),
      official_card_count: typeof set.cardCount?.official === "number" ? set.cardCount.official : null,
      release_date: normalizeReleaseDate(set.releaseDate),
      raw_json: set as unknown as Record<string, unknown>,
    })

    const cardId = `${set.id}-${localId}`
    cardsById.set(cardId, {
      id: cardId,
      series_id: series.id,
      set_id: set.id,
      local_id: localId,
      local_id_sort: normalizeLocalIdSort(localId),
      name_json: normalizeLocalizedMap(card.name),
      name_en: pickLocalizedText(card.name, "en"),
      category: typeof card.category === "string" ? card.category : null,
      rarity: typeof card.rarity === "string" ? card.rarity : null,
      hp: normalizeInteger(card.hp),
      illustrator: typeof card.illustrator === "string" ? card.illustrator : null,
      types_json: Array.isArray(card.types) ? card.types.filter((value): value is string => typeof value === "string") : [],
      image_languages_json: getImageLanguages(assetManifest, series.id, set.id, localId),
      variants_json: normalizeVariants(card.variants),
      raw_json: card as unknown as Record<string, unknown>,
    })

    for (const dexId of Array.isArray(card.dexId) ? card.dexId : []) {
      if (Number.isInteger(dexId) && dexId > 0) {
        dexLinks.add(`${cardId}:${dexId}`)
      }
    }

    if ((index + 1) % 250 === 0 || index === cardFiles.length - 1) {
      logWith(logger, `Parsed ${index + 1}/${cardFiles.length} card files`)
    }
  }

  return {
    series: [...seriesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sets: [...setsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cards: [...cardsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    dexLinks: [...dexLinks]
      .map((key) => {
        const [cardId, dexId] = key.split(":")
        return {
          card_id: cardId,
          dex_id: Number.parseInt(dexId, 10),
        }
      })
      .sort((a, b) => (a.dex_id - b.dex_id) || a.card_id.localeCompare(b.card_id)),
  }
}

async function applySchema(client: Client, projectRoot: string, logger?: (message: string) => void) {
  const schemaSqlPath = getSchemaSqlPath(projectRoot)
  const schemaSql = await readFile(schemaSqlPath, "utf8")
  logWith(logger, `Applying schema from ${schemaSqlPath}`)
  await client.query(schemaSql)
}

async function insertJsonBatch<T>(
  client: Client,
  label: string,
  rows: T[],
  sql: string,
  logger?: (message: string) => void,
  batchSize = DEFAULT_BATCH_SIZE,
) {
  if (rows.length === 0) {
    logWith(logger, `No ${label} rows to insert`)
    return
  }

  for (let start = 0; start < rows.length; start += batchSize) {
    const end = Math.min(start + batchSize, rows.length)
    const batch = rows.slice(start, end)
    await client.query(sql, [JSON.stringify(batch)])
    logWith(logger, `Inserted ${end}/${rows.length} ${label}`)
  }
}

async function seedMirror(
  client: Client,
  payload: Awaited<ReturnType<typeof buildMirrorPayload>>,
  logger?: (message: string) => void,
) {
  logWith(
    logger,
    `Seeding ${payload.series.length} series, ${payload.sets.length} sets, ${payload.cards.length} cards, ${payload.dexLinks.length} dex links`,
  )

  await client.query("BEGIN")

  try {
    await client.query(
      "TRUNCATE TABLE public.tcg_card_dex_ids, public.tcg_cards, public.tcg_sets, public.tcg_series RESTART IDENTITY CASCADE",
    )

    await insertJsonBatch(
      client,
      "series",
      payload.series,
      `
        INSERT INTO public.tcg_series (id, name_json, name_en, raw_json)
        SELECT id, name_json, name_en, raw_json
        FROM jsonb_to_recordset($1::jsonb) AS row(
          id text,
          name_json jsonb,
          name_en text,
          raw_json jsonb
        )
      `,
      logger,
      200,
    )

    await insertJsonBatch(
      client,
      "sets",
      payload.sets,
      `
        INSERT INTO public.tcg_sets (id, series_id, name_json, name_en, official_card_count, release_date, raw_json)
        SELECT id, series_id, name_json, name_en, official_card_count, release_date, raw_json
        FROM jsonb_to_recordset($1::jsonb) AS row(
          id text,
          series_id text,
          name_json jsonb,
          name_en text,
          official_card_count integer,
          release_date date,
          raw_json jsonb
        )
      `,
      logger,
      250,
    )

    await insertJsonBatch(
      client,
      "cards",
      payload.cards,
      `
        INSERT INTO public.tcg_cards (
          id,
          series_id,
          set_id,
          local_id,
          local_id_sort,
          name_json,
          name_en,
          category,
          rarity,
          hp,
          illustrator,
          types_json,
          image_languages_json,
          variants_json,
          raw_json
        )
        SELECT
          id,
          series_id,
          set_id,
          local_id,
          local_id_sort,
          name_json,
          name_en,
          category,
          rarity,
          hp,
          illustrator,
          types_json,
          image_languages_json,
          variants_json,
          raw_json
        FROM jsonb_to_recordset($1::jsonb) AS row(
          id text,
          series_id text,
          set_id text,
          local_id text,
          local_id_sort integer,
          name_json jsonb,
          name_en text,
          category text,
          rarity text,
          hp integer,
          illustrator text,
          types_json jsonb,
          image_languages_json jsonb,
          variants_json jsonb,
          raw_json jsonb
        )
      `,
      logger,
      400,
    )

    await insertJsonBatch(
      client,
      "dex links",
      payload.dexLinks,
      `
        INSERT INTO public.tcg_card_dex_ids (card_id, dex_id)
        SELECT card_id, dex_id
        FROM jsonb_to_recordset($1::jsonb) AS row(
          card_id text,
          dex_id integer
        )
      `,
      logger,
      1000,
    )

    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

export async function runCardDbSync(options: CardDbSyncOptions = {}): Promise<CardDbSyncResult> {
  const projectRoot = getProjectRoot(options.projectRoot)
  const logger = options.logger
  const connectionString = getMirrorDatabaseUrl()
  const repoDir = await ensureCardsDatabaseRepo(projectRoot, logger)
  const repoCommit = await getRepoCommitSha(repoDir)
  logWith(logger, `Using cards-database commit ${repoCommit}`)

  const payload = await buildMirrorPayload(projectRoot, logger)
  const client = new Client({
    connectionString,
  })

  await client.connect()

  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [CARD_DB_SYNC_LOCK_KEY],
    )
    if (!lockResult.rows[0]?.locked) {
      throw new Error("A card database sync is already running")
    }

    await applySchema(client, projectRoot, logger)
    await seedMirror(client, payload, logger)
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1)", [CARD_DB_SYNC_LOCK_KEY])
    } catch {
      // Ignore unlock failures during shutdown.
    }
    await client.end()
  }

  const result = {
    repoCommit,
    seriesCount: payload.series.length,
    setCount: payload.sets.length,
    cardCount: payload.cards.length,
    dexLinkCount: payload.dexLinks.length,
  }

  logWith(
    logger,
    `Done. Seeded ${result.seriesCount} series, ${result.setCount} sets, ${result.cardCount} cards, and ${result.dexLinkCount} dex links from ${repoCommit}.`,
  )

  return result
}
