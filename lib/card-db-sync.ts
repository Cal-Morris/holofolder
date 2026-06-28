import { spawn } from "node:child_process"
import { access, mkdir, readFile, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Client } from "pg"

type SupportedLanguage = "en" | "ja"
type JsonObject = Record<string, unknown>

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
  variants_json: Partial<Record<"normal" | "reverse" | "holo" | "firstEdition" | "wPromo" | "jumbo", boolean>>
  external_ids_json: JsonObject
  raw_json: JsonObject
}

type MirrorCardExternalSourceRow = {
  card_id: string
  source: "pokemon_tcg"
  source_card_id: string
  source_set_id: string | null
  raw_json: JsonObject
}

type MirrorDexLinkRow = {
  card_id: string
  dex_id: number
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
    total?: number
  }
  releaseDate?: string | Record<string, string>
}

type TCGCard = {
  id?: string
  localId?: string
  set: TCGSet
  name?: Record<string, string> | string
  image?: string
  category?: string
  rarity?: string
  hp?: number | string
  illustrator?: string
  types?: string[]
  thirdParty?: Record<string, unknown>
  variants?:
    | Array<{
        type?: string
        size?: string
        stamp?: string[]
        thirdParty?: Record<string, unknown>
      }>
    | {
        normal?: boolean
        reverse?: boolean
        holo?: boolean
        firstEdition?: boolean
        wPromo?: boolean
        jumbo?: boolean
      }
  dexId?: number[]
}

type PokemonTcgSet = {
  id: string
  name?: string
  series?: string
  printedTotal?: number
  total?: number
  releaseDate?: string
  images?: {
    symbol?: string
    logo?: string
  }
  legalities?: JsonObject
  ptcgoCode?: string
  updatedAt?: string
}

type PokemonTcgCard = {
  id: string
  name?: string
  supertype?: string
  hp?: string
  types?: string[]
  nationalPokedexNumbers?: number[]
  number?: string
  artist?: string
  rarity?: string
  images?: {
    small?: string
    large?: string
  }
}

type RestSetSummary = {
  id?: string
  name?: string
  serie?: {
    id?: string
    name?: string
  }
  cardCount?: {
    total?: number
  }
}

type RestSetDetail = RestSetSummary & {
  releaseDate?: string
  cardCount?: {
    official?: number
    total?: number
  }
  cards?: Array<{
    id?: string
    localId?: string
    name?: string
  }>
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
  externalSourceCount: number
  pokemonTcgSetCount: number
  pokemonTcgCardCount: number
}

interface CardDbSyncOptions {
  logger?: (message: string) => void
  projectRoot?: string
  dryRun?: boolean
}

const REPO_URL = "https://github.com/tcgdex/cards-database"
const POKEMON_TCG_DATA_BASE_URL = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"
const TCGDEX_REST_BASE_URL = "https://api.tcgdex.net/v2/en"
const DEFAULT_BATCH_SIZE = 500
const CARD_DB_SYNC_LOCK_KEY = 10250418
const EXCLUDED_SERIES_IDS = new Set(["tcgp"])

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
      jumbo: cardVariants.some((variant) => variant?.size === "jumbo"),
    }
  }

  return {
    normal: Boolean(cardVariants.normal),
    reverse: Boolean(cardVariants.reverse),
    holo: Boolean(cardVariants.holo),
    firstEdition: Boolean(cardVariants.firstEdition),
    wPromo: Boolean(cardVariants.wPromo),
    jumbo: Boolean(cardVariants.jumbo),
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

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
    : []
}

function normalizeJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}

function normalizeSetDate(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.replaceAll("/", "-")
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function normalizeSetMatchText(value: string | null | undefined) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

function buildSetMatchKey(name: string | null | undefined, releaseDate: string | null | undefined, printedTotal: number | null | undefined) {
  const normalizedName = normalizeSetMatchText(name)
  const normalizedDate = normalizeSetDate(releaseDate)

  if (!normalizedName || !normalizedDate || typeof printedTotal !== "number") {
    return null
  }

  return `${normalizedName}:${normalizedDate}:${printedTotal}`
}

function normalizeCardNumber(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+$/.test(trimmed)) {
    return String(Number.parseInt(trimmed, 10))
  }

  return trimmed.toLowerCase()
}

function normalizeTcgDexImageUrl(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return null
  }

  if (/\.(?:png|jpe?g|webp)$/i.test(value)) {
    return value
  }

  return `${value.replace(/\/$/, "")}/high.webp`
}

function buildExternalIds(card: TCGCard, pokemonTcgCard?: PokemonTcgCard, pokemonTcgSetId?: string | null): JsonObject {
  const externalIds: JsonObject = {}
  const cardThirdParty = normalizeJsonObject(card.thirdParty)
  const tcgdexImage = normalizeTcgDexImageUrl(card.image)

  if (Object.keys(cardThirdParty).length > 0 || tcgdexImage) {
    externalIds.tcgdex = {
      ...(tcgdexImage ? { image: tcgdexImage } : {}),
      ...(Object.keys(cardThirdParty).length > 0 ? { thirdParty: cardThirdParty } : {}),
    }
  }

  if (Array.isArray(card.variants)) {
    const variantThirdParty = card.variants
      .map((variant) => normalizeJsonObject(variant?.thirdParty))
      .filter((thirdParty) => Object.keys(thirdParty).length > 0)

    if (variantThirdParty.length > 0) {
      externalIds.tcgdex = {
        ...(normalizeJsonObject(externalIds.tcgdex)),
        variantThirdParty,
      }
    }
  }

  if (pokemonTcgCard) {
    externalIds.pokemon_tcg = {
      cardId: pokemonTcgCard.id,
      setId: pokemonTcgSetId || null,
      imageSmall: pokemonTcgCard.images?.small || null,
      imageLarge: pokemonTcgCard.images?.large || null,
    }
  }

  return externalIds
}

async function fetchJson<T>(url: string, logger?: (message: string) => void): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "binderdex-card-db-sync",
      },
    })

    if (!response.ok) {
      logWith(logger, `Skipping ${url}: HTTP ${response.status}`)
      return null
    }

    return await response.json() as T
  } catch (error) {
    logWith(logger, `Skipping ${url}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function fetchPokemonTcgSets(logger?: (message: string) => void) {
  const sets = await fetchJson<PokemonTcgSet[]>(`${POKEMON_TCG_DATA_BASE_URL}/sets/en.json`, logger)
  return Array.isArray(sets) ? sets : []
}

function buildPokemonTcgSetIndex(sets: PokemonTcgSet[]) {
  const index = new Map<string, PokemonTcgSet>()

  for (const set of sets) {
    const key = buildSetMatchKey(set.name, set.releaseDate, set.printedTotal)
    if (key && !index.has(key)) {
      index.set(key, set)
    }
  }

  return index
}

async function fetchPokemonTcgCardsBySet(setId: string, logger?: (message: string) => void) {
  const cards = await fetchJson<PokemonTcgCard[]>(
    `${POKEMON_TCG_DATA_BASE_URL}/cards/en/${encodeURIComponent(setId)}.json`,
    logger,
  )

  if (!Array.isArray(cards)) {
    return new Map<string, PokemonTcgCard>()
  }

  const cardsByNumber = new Map<string, PokemonTcgCard>()
  for (const card of cards) {
    const normalizedNumber = normalizeCardNumber(card.number)
    if (normalizedNumber && !cardsByNumber.has(normalizedNumber)) {
      cardsByNumber.set(normalizedNumber, card)
    }
  }

  return cardsByNumber
}

async function fetchRestSetSummaries(logger?: (message: string) => void) {
  const sets = await fetchJson<RestSetSummary[]>(`${TCGDEX_REST_BASE_URL}/sets`, logger)
  return Array.isArray(sets) ? sets : []
}

async function fetchRestSetDetail(setId: string, logger?: (message: string) => void) {
  return fetchJson<RestSetDetail>(`${TCGDEX_REST_BASE_URL}/sets/${encodeURIComponent(setId)}`, logger)
}

async function fetchRestCard(cardId: string, logger?: (message: string) => void) {
  return fetchJson<TCGCard>(`${TCGDEX_REST_BASE_URL}/cards/${encodeURIComponent(cardId)}`, logger)
}

export function selectRestSetsForSupplement(restSets: RestSetSummary[], mirrorCardCountsBySetId: Map<string, number>) {
  return restSets.filter((set) => {
    if (!set.id) {
      return false
    }

    if (set.serie?.id && EXCLUDED_SERIES_IDS.has(set.serie.id)) {
      return false
    }

    const restTotal = typeof set.cardCount?.total === "number" ? set.cardCount.total : null
    const mirrorTotal = mirrorCardCountsBySetId.get(set.id) ?? 0

    return mirrorTotal === 0 || (restTotal != null && restTotal > mirrorTotal)
  })
}

function countCardsBySetId(cardsById: Map<string, MirrorCardRow>) {
  const counts = new Map<string, number>()

  for (const card of cardsById.values()) {
    counts.set(card.set_id, (counts.get(card.set_id) ?? 0) + 1)
  }

  return counts
}

function appendJumboName(value: Record<string, string>) {
  const result: Record<string, string> = {}
  for (const [language, name] of Object.entries(value)) {
    result[language] = /\bjumbo\b/i.test(name) ? name : `${name} Jumbo`
  }
  return result
}

function getJumboVariantPayload(rawJson: JsonObject) {
  const variants = Array.isArray(rawJson.variants) ? rawJson.variants : []
  const jumboVariants = variants.filter((variant) => (
    variant
    && typeof variant === "object"
    && !Array.isArray(variant)
    && (variant as Record<string, unknown>).size === "jumbo"
  ))

  return jumboVariants.length > 0 ? jumboVariants : null
}

export function buildJumboVariantSupplementRows(cards: MirrorCardRow[], dexLinks: MirrorDexLinkRow[]) {
  const linksByCardId = new Map<string, number[]>()
  for (const link of dexLinks) {
    const links = linksByCardId.get(link.card_id) ?? []
    links.push(link.dex_id)
    linksByCardId.set(link.card_id, links)
  }

  const series: MirrorSeriesRow = {
    id: "misc",
    name_json: { en: "Miscellaneous" },
    name_en: "Miscellaneous",
    raw_json: { id: "misc", name: { en: "Miscellaneous" } },
  }
  const set: MirrorSetRow = {
    id: "jumbo",
    series_id: "misc",
    name_json: { en: "Jumbo cards", fr: "Cartes Jumbo" },
    name_en: "Jumbo cards",
    official_card_count: 160,
    release_date: "2000-02-01",
    raw_json: {
      id: "jumbo",
      name: { en: "Jumbo cards", fr: "Cartes Jumbo" },
      serie: { id: "misc", name: { en: "Miscellaneous" } },
      cardCount: { official: 160 },
      releaseDate: "2000-02-01",
      supplementalSources: {
        tcgdex_jumbo_variants: true,
      },
    },
  }
  const jumboCards: MirrorCardRow[] = []
  const jumboDexLinks: MirrorDexLinkRow[] = []

  for (const card of cards) {
    if (card.set_id === "jumbo" || !card.variants_json.jumbo) {
      continue
    }

    const sourceDexLinks = linksByCardId.get(card.id) ?? []
    if (sourceDexLinks.length === 0) {
      continue
    }

    const syntheticCardId = `jumbo-${card.id}`
    const jumboVariants = getJumboVariantPayload(card.raw_json)
    jumboCards.push({
      ...card,
      id: syntheticCardId,
      series_id: "misc",
      set_id: "jumbo",
      local_id: card.id,
      local_id_sort: card.local_id_sort,
      name_json: appendJumboName(card.name_json),
      name_en: card.name_en ? (/\bjumbo\b/i.test(card.name_en) ? card.name_en : `${card.name_en} Jumbo`) : null,
      variants_json: { jumbo: true },
      raw_json: {
        sourceCardId: card.id,
        sourceSetId: card.set_id,
        sourceLocalId: card.local_id,
        sourceName: card.name_json,
        ...(jumboVariants ? { variants: jumboVariants } : {}),
        supplementalSources: {
          tcgdex_jumbo_variant: true,
        },
      },
    })

    for (const dexId of sourceDexLinks) {
      jumboDexLinks.push({ card_id: syntheticCardId, dex_id: dexId })
    }
  }

  return {
    series,
    set,
    cards: jumboCards.sort((a, b) => a.id.localeCompare(b.id)),
    dexLinks: jumboDexLinks.sort((a, b) => (a.dex_id - b.dex_id) || a.card_id.localeCompare(b.card_id)),
  }
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
  const externalSourcesByCardId = new Map<string, MirrorCardExternalSourceRow>()
  const dexLinks = new Set<string>()
  const assetManifest = await fetchAssetManifest(logger)
  const pokemonTcgSets = await fetchPokemonTcgSets(logger)
  const pokemonTcgSetIndex = buildPokemonTcgSetIndex(pokemonTcgSets)
  const pokemonTcgCardsBySetId = new Map<string, Map<string, PokemonTcgCard>>()
  const matchedPokemonTcgSetIds = new Set<string>()
  const matchedPokemonTcgCardIds = new Set<string>()

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

    if (EXCLUDED_SERIES_IDS.has(series.id)) {
      continue
    }

    seriesById.set(series.id, {
      id: series.id,
      name_json: normalizeLocalizedMap(series.name),
      name_en: pickLocalizedText(series.name, "en"),
      raw_json: series as unknown as Record<string, unknown>,
    })

    const releaseDate = normalizeReleaseDate(set.releaseDate)
    const officialCardCount = typeof set.cardCount?.official === "number" ? set.cardCount.official : null
    const setNameEn = pickLocalizedText(set.name, "en")
    const pokemonTcgSetKey = buildSetMatchKey(setNameEn, releaseDate, officialCardCount)
    const pokemonTcgSet = pokemonTcgSetKey ? pokemonTcgSetIndex.get(pokemonTcgSetKey) : undefined

    setsById.set(set.id, {
      id: set.id,
      series_id: series.id,
      name_json: normalizeLocalizedMap(set.name),
      name_en: setNameEn,
      official_card_count: officialCardCount,
      release_date: releaseDate,
      raw_json: pokemonTcgSet
        ? {
            ...(set as unknown as JsonObject),
            supplementalSources: {
              pokemon_tcg: pokemonTcgSet,
            },
          }
        : set as unknown as JsonObject,
    })

    const cardId = `${set.id}-${localId}`
    let pokemonTcgCard: PokemonTcgCard | undefined

    if (pokemonTcgSet?.id) {
      matchedPokemonTcgSetIds.add(pokemonTcgSet.id)
      let pokemonTcgCards = pokemonTcgCardsBySetId.get(pokemonTcgSet.id)

      if (!pokemonTcgCards) {
        pokemonTcgCards = await fetchPokemonTcgCardsBySet(pokemonTcgSet.id, logger)
        pokemonTcgCardsBySetId.set(pokemonTcgSet.id, pokemonTcgCards)
      }

      const normalizedLocalId = normalizeCardNumber(localId)
      pokemonTcgCard = normalizedLocalId ? pokemonTcgCards.get(normalizedLocalId) : undefined

      if (pokemonTcgCard?.id) {
        matchedPokemonTcgCardIds.add(pokemonTcgCard.id)
        externalSourcesByCardId.set(cardId, {
          card_id: cardId,
          source: "pokemon_tcg",
          source_card_id: pokemonTcgCard.id,
          source_set_id: pokemonTcgSet.id,
          raw_json: pokemonTcgCard as unknown as JsonObject,
        })
      }
    }

    const types = Array.isArray(card.types) ? card.types.filter((value): value is string => typeof value === "string") : []

    cardsById.set(cardId, {
      id: cardId,
      series_id: series.id,
      set_id: set.id,
      local_id: localId,
      local_id_sort: normalizeLocalIdSort(localId),
      name_json: normalizeLocalizedMap(card.name),
      name_en: pickLocalizedText(card.name, "en") || pokemonTcgCard?.name || null,
      category: typeof card.category === "string" ? card.category : pokemonTcgCard?.supertype || null,
      rarity: typeof card.rarity === "string" ? card.rarity : pokemonTcgCard?.rarity || null,
      hp: normalizeInteger(card.hp) ?? normalizeInteger(pokemonTcgCard?.hp),
      illustrator: typeof card.illustrator === "string" ? card.illustrator : pokemonTcgCard?.artist || null,
      types_json: types.length > 0 ? types : normalizeStringArray(pokemonTcgCard?.types),
      image_languages_json: getImageLanguages(assetManifest, series.id, set.id, localId),
      variants_json: normalizeVariants(card.variants),
      external_ids_json: buildExternalIds(card, pokemonTcgCard, pokemonTcgSet?.id),
      raw_json: pokemonTcgCard
        ? {
            ...(card as unknown as JsonObject),
            supplementalSources: {
              pokemon_tcg: pokemonTcgCard,
            },
          }
        : card as unknown as JsonObject,
    })

    const linkedDexIds = new Set([
      ...(Array.isArray(card.dexId) ? card.dexId : []),
      ...(Array.isArray(pokemonTcgCard?.nationalPokedexNumbers) ? pokemonTcgCard.nationalPokedexNumbers : []),
    ])

    for (const dexId of linkedDexIds) {
      if (Number.isInteger(dexId) && dexId > 0) {
        dexLinks.add(`${cardId}:${dexId}`)
      }
    }

    if ((index + 1) % 250 === 0 || index === cardFiles.length - 1) {
      logWith(logger, `Parsed ${index + 1}/${cardFiles.length} card files`)
    }
  }

  const restSetCandidates = selectRestSetsForSupplement(
    await fetchRestSetSummaries(logger),
    countCardsBySetId(cardsById),
  )

  if (restSetCandidates.length > 0) {
    logWith(logger, `Supplementing ${restSetCandidates.length} sets from live TCGdex REST data: ${restSetCandidates.map((set) => set.id).filter(Boolean).join(", ")}`)
  }

  let restSupplementCardCount = 0
  for (const setCandidate of restSetCandidates) {
    if (!setCandidate.id) {
      continue
    }

    const restSet = await fetchRestSetDetail(setCandidate.id, logger)
    const seriesId = restSet?.serie?.id

    if (!restSet?.id || !seriesId || EXCLUDED_SERIES_IDS.has(seriesId)) {
      continue
    }

    let restSetCardCount = 0

    const seriesName = restSet.serie?.name || seriesId
    const setName = restSet.name || restSet.id
    const series: TCGSeries = {
      id: seriesId,
      name: { en: seriesName },
    }
    const set: TCGSet = {
      id: restSet.id,
      name: { en: setName },
      serie: series,
      cardCount: {
        official: typeof restSet.cardCount?.official === "number" ? restSet.cardCount.official : undefined,
        total: typeof restSet.cardCount?.total === "number" ? restSet.cardCount.total : undefined,
      },
      releaseDate: restSet.releaseDate,
    }
    const releaseDate = normalizeReleaseDate(set.releaseDate)
    const officialCardCount = typeof set.cardCount?.official === "number" ? set.cardCount.official : null
    const pokemonTcgSetKey = buildSetMatchKey(setName, releaseDate, officialCardCount)
    const pokemonTcgSet = pokemonTcgSetKey ? pokemonTcgSetIndex.get(pokemonTcgSetKey) : undefined

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
      name_en: setName,
      official_card_count: officialCardCount,
      release_date: releaseDate,
      raw_json: pokemonTcgSet
        ? {
            ...(restSet as unknown as JsonObject),
            supplementalSources: {
              tcgdex_rest: restSet,
              pokemon_tcg: pokemonTcgSet,
            },
          }
        : {
            ...(restSet as unknown as JsonObject),
            supplementalSources: {
              tcgdex_rest: restSet,
            },
          },
    })

    let pokemonTcgCards: Map<string, PokemonTcgCard> | undefined
    if (pokemonTcgSet?.id) {
      matchedPokemonTcgSetIds.add(pokemonTcgSet.id)
      pokemonTcgCards = pokemonTcgCardsBySetId.get(pokemonTcgSet.id)

      if (!pokemonTcgCards) {
        pokemonTcgCards = await fetchPokemonTcgCardsBySet(pokemonTcgSet.id, logger)
        pokemonTcgCardsBySetId.set(pokemonTcgSet.id, pokemonTcgCards)
      }
    }

    for (const briefCard of restSet.cards ?? []) {
      const cardId = briefCard.id
      if (!cardId || cardsById.has(cardId)) {
        continue
      }

      const restCard = await fetchRestCard(cardId, logger)
      const localId = restCard?.localId || briefCard.localId || cardId.slice(`${set.id}-`.length)
      if (!restCard || !localId) {
        continue
      }

      const pokemonTcgCard = pokemonTcgCards?.get(normalizeCardNumber(localId) ?? "")
      if (pokemonTcgCard?.id && pokemonTcgSet?.id) {
        matchedPokemonTcgCardIds.add(pokemonTcgCard.id)
        externalSourcesByCardId.set(cardId, {
          card_id: cardId,
          source: "pokemon_tcg",
          source_card_id: pokemonTcgCard.id,
          source_set_id: pokemonTcgSet.id,
          raw_json: pokemonTcgCard as unknown as JsonObject,
        })
      }

      const restCardForRow: TCGCard = {
        ...restCard,
        id: cardId,
        localId,
        set,
      }
      const types = Array.isArray(restCard.types) ? restCard.types.filter((value): value is string => typeof value === "string") : []

      cardsById.set(cardId, {
        id: cardId,
        series_id: series.id,
        set_id: set.id,
        local_id: localId,
        local_id_sort: normalizeLocalIdSort(localId),
        name_json: normalizeLocalizedMap(restCard.name ?? briefCard.name),
        name_en: pickLocalizedText(restCard.name ?? briefCard.name, "en") || pokemonTcgCard?.name || null,
        category: typeof restCard.category === "string" ? restCard.category : pokemonTcgCard?.supertype || null,
        rarity: typeof restCard.rarity === "string" ? restCard.rarity : pokemonTcgCard?.rarity || null,
        hp: normalizeInteger(restCard.hp) ?? normalizeInteger(pokemonTcgCard?.hp),
        illustrator: typeof restCard.illustrator === "string" ? restCard.illustrator : pokemonTcgCard?.artist || null,
        types_json: types.length > 0 ? types : normalizeStringArray(pokemonTcgCard?.types),
        image_languages_json: getImageLanguages(assetManifest, series.id, set.id, localId),
        variants_json: normalizeVariants(restCard.variants),
        external_ids_json: buildExternalIds(restCardForRow, pokemonTcgCard, pokemonTcgSet?.id),
        raw_json: pokemonTcgCard
          ? {
              ...(restCard as unknown as JsonObject),
              supplementalSources: {
                tcgdex_rest: restCard,
                pokemon_tcg: pokemonTcgCard,
              },
            }
          : {
              ...(restCard as unknown as JsonObject),
              supplementalSources: {
                tcgdex_rest: restCard,
              },
            },
      })

      const linkedDexIds = new Set([
        ...(Array.isArray(restCard.dexId) ? restCard.dexId : []),
        ...(Array.isArray(pokemonTcgCard?.nationalPokedexNumbers) ? pokemonTcgCard.nationalPokedexNumbers : []),
      ])

      for (const dexId of linkedDexIds) {
        if (Number.isInteger(dexId) && dexId > 0) {
          dexLinks.add(`${cardId}:${dexId}`)
        }
      }

      restSupplementCardCount += 1
      restSetCardCount += 1
    }

    if (restSetCardCount > 0) {
      logWith(logger, `Added ${restSetCardCount} cards from live TCGdex REST set ${restSet.id}`)
    }
  }

  if (restSupplementCardCount > 0) {
    logWith(logger, `Added ${restSupplementCardCount} cards from live TCGdex REST data`)
  }

  const dexLinkRows = [...dexLinks]
    .map((key) => {
      const [cardId, dexId] = key.split(":")
      return {
        card_id: cardId,
        dex_id: Number.parseInt(dexId, 10),
      }
    })
    .sort((a, b) => (a.dex_id - b.dex_id) || a.card_id.localeCompare(b.card_id))
  const jumboSupplement = buildJumboVariantSupplementRows([...cardsById.values()], dexLinkRows)

  if (jumboSupplement.cards.length > 0) {
    seriesById.set(jumboSupplement.series.id, jumboSupplement.series)
    setsById.set(jumboSupplement.set.id, jumboSupplement.set)

    for (const card of jumboSupplement.cards) {
      if (!cardsById.has(card.id)) {
        cardsById.set(card.id, card)
      }
    }

    for (const link of jumboSupplement.dexLinks) {
      dexLinks.add(`${link.card_id}:${link.dex_id}`)
    }

    logWith(logger, `Added ${jumboSupplement.cards.length} synthetic cards from TCGdex jumbo variants`)
  }

  return {
    series: [...seriesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sets: [...setsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    cards: [...cardsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    externalSources: [...externalSourcesByCardId.values()].sort((a, b) => a.card_id.localeCompare(b.card_id)),
    dexLinks: [...dexLinks]
      .map((key) => {
        const [cardId, dexId] = key.split(":")
        return {
          card_id: cardId,
          dex_id: Number.parseInt(dexId, 10),
        }
      })
      .sort((a, b) => (a.dex_id - b.dex_id) || a.card_id.localeCompare(b.card_id)),
    pokemonTcgSetCount: matchedPokemonTcgSetIds.size,
    pokemonTcgCardCount: matchedPokemonTcgCardIds.size,
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
    `Seeding ${payload.series.length} series, ${payload.sets.length} sets, ${payload.cards.length} cards, ${payload.externalSources.length} external source links, ${payload.dexLinks.length} dex links`,
  )

  await client.query("BEGIN")

  try {
    await client.query(
      "TRUNCATE TABLE public.tcg_card_dex_ids, public.tcg_card_external_sources, public.tcg_cards, public.tcg_sets, public.tcg_series RESTART IDENTITY CASCADE",
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
          external_ids_json,
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
          external_ids_json,
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
          external_ids_json jsonb,
          raw_json jsonb
        )
      `,
      logger,
      400,
    )

    await insertJsonBatch(
      client,
      "external sources",
      payload.externalSources,
      `
        INSERT INTO public.tcg_card_external_sources (card_id, source, source_card_id, source_set_id, raw_json)
        SELECT card_id, source, source_card_id, source_set_id, raw_json
        FROM jsonb_to_recordset($1::jsonb) AS row(
          card_id text,
          source text,
          source_card_id text,
          source_set_id text,
          raw_json jsonb
        )
      `,
      logger,
      1000,
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
  const repoDir = await ensureCardsDatabaseRepo(projectRoot, logger)
  const repoCommit = await getRepoCommitSha(repoDir)
  logWith(logger, `Using cards-database commit ${repoCommit}`)

  const payload = await buildMirrorPayload(projectRoot, logger)
  const result = {
    repoCommit,
    seriesCount: payload.series.length,
    setCount: payload.sets.length,
    cardCount: payload.cards.length,
    dexLinkCount: payload.dexLinks.length,
    externalSourceCount: payload.externalSources.length,
    pokemonTcgSetCount: payload.pokemonTcgSetCount,
    pokemonTcgCardCount: payload.pokemonTcgCardCount,
  }

  if (options.dryRun) {
    logWith(
      logger,
      `Dry run complete. Parsed ${result.seriesCount} series, ${result.setCount} sets, ${result.cardCount} cards, ${result.externalSourceCount} external source links, and ${result.dexLinkCount} dex links from ${repoCommit}. PokemonTCG matched ${result.pokemonTcgSetCount} sets and ${result.pokemonTcgCardCount} cards. No database writes were made.`,
    )
    return result
  }

  const connectionString = getMirrorDatabaseUrl()
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

  logWith(
    logger,
    `Done. Seeded ${result.seriesCount} series, ${result.setCount} sets, ${result.cardCount} cards, ${result.externalSourceCount} external source links, and ${result.dexLinkCount} dex links from ${repoCommit}. PokemonTCG matched ${result.pokemonTcgSetCount} sets and ${result.pokemonTcgCardCount} cards.`,
  )

  return result
}
