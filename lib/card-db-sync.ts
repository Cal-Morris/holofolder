import { preserveCatalogIds } from "./card-catalog"
import { spawn } from "node:child_process"
import { access, mkdir, readFile, readdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Client } from "pg"
import { inferDexIdsFromCardName } from "./card-dex-inference"
import { mapWithConcurrency } from "./card-db-sync-concurrency"
import type { CardImageMirror } from "./card-image-blob"
import {
  mirrorSetImages,
  parseImageLanguages,
  type CardImageBackfillRequest,
  type MirrorableCard,
  type MirrorSetImagesResult,
} from "./card-image-backfill"
import { isSetUpToDateWithListedCards, selectIncrementalSyncTargets, type IncrementalSyncRequest } from "./card-db-sync-targets"
import { pickLocalizedText, pickTcgdexImageFromExternalIds } from "./tcgdex-shared"

type JsonObject = Record<string, unknown>

type MirrorSeriesRow = {
  id: string
  name_json: Record<string, string>
  name_en: string | null
  raw_json: Record<string, unknown>
}

export type MirrorSetRow = {
  id: string
  series_id: string
  name_json: Record<string, string>
  name_en: string | null
  official_card_count: number | null
  release_date: string | null
  raw_json: Record<string, unknown>
}

export type MirrorCardRow = {
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

export type MirrorCardExternalSourceRow = {
  card_id: string
  source: "pokemon_tcg" | "tcgcsv"
  source_card_id: string
  source_set_id: string | null
  raw_json: JsonObject
}

const FIRST_PARTNER_PACK_SOURCE_CARD_IDS = [
  "base1-44",
  "base1-46",
  "base1-63",
  "base1-58",
  "neo1-54",
  "neo1-57",
  "neo1-81",
  "ex1-76",
  "ex1-74",
  "ex1-59",
  "dp1-103",
  "dp1-76",
  "dp1-93",
  "bwp-BW01",
  "bwp-BW02",
  "bwp-BW03",
  "xyp-XY01",
  "xyp-XY02",
  "xyp-XY03",
  "smp-SM01",
  "smp-SM02",
  "smp-SM03",
  "swshp-SWSH001",
  "swshp-SWSH002",
  "swshp-SWSH003",
] as const

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
  variants_detailed?: Array<{ type?: string; size?: string; stamp?: string[]; thirdParty?: Record<string, unknown> }>
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

  const hasGitDir = await pathExists(path.join(/*turbopackIgnore: true*/ repoDir, ".git"))
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

function withoutJumboVariant(
  variants: MirrorCardRow["variants_json"],
): MirrorCardRow["variants_json"] {
  const remainingVariants = { ...variants }
  delete remainingVariants.jumbo
  return Object.values(remainingVariants).some(Boolean) ? remainingVariants : { normal: true }
}

export function buildFirstPartnerPackSupplementRows(cards: MirrorCardRow[], dexLinks: Array<{ card_id: string; dex_id: number }>) {
  const cardsById = new Map(cards.map((card) => [card.id, card] as const))
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
    id: "first-partner-packs",
    series_id: "misc",
    name_json: { en: "First Partner Packs" },
    name_en: "First Partner Packs",
    official_card_count: FIRST_PARTNER_PACK_SOURCE_CARD_IDS.length,
    release_date: "2021-02-26",
    raw_json: {
      id: "first-partner-packs",
      name: { en: "First Partner Packs" },
      serie: { id: "misc", name: { en: "Miscellaneous" } },
      cardCount: { official: FIRST_PARTNER_PACK_SOURCE_CARD_IDS.length },
      releaseDate: "2021-02-26",
      supplementalSources: {
        curated_first_partner_packs: true,
      },
    },
  }
  const firstPartnerCards: MirrorCardRow[] = []
  const firstPartnerDexLinks: Array<{ card_id: string; dex_id: number }> = []

  FIRST_PARTNER_PACK_SOURCE_CARD_IDS.forEach((sourceCardId, index) => {
    const sourceCard = cardsById.get(sourceCardId)
    if (!sourceCard || sourceCard.set_id === set.id) {
      return
    }

    const sourceDexLinks = linksByCardId.get(sourceCard.id) ?? []
    if (sourceDexLinks.length === 0) {
      return
    }

    const firstPartnerCardId = `first-partner-${sourceCard.id}`
    firstPartnerCards.push({
      ...sourceCard,
      id: firstPartnerCardId,
      series_id: set.series_id,
      set_id: set.id,
      local_id: String(index + 1).padStart(3, "0"),
      local_id_sort: index + 1,
      image_languages_json: [],
      variants_json: withoutJumboVariant(sourceCard.variants_json),
      raw_json: {
        sourceCardId: sourceCard.id,
        sourceSetId: sourceCard.set_id,
        sourceLocalId: sourceCard.local_id,
        sourceName: sourceCard.name_json,
        supplementalSources: {
          curated_first_partner_pack: true,
        },
      },
    })

    for (const dexId of sourceDexLinks) {
      firstPartnerDexLinks.push({ card_id: firstPartnerCardId, dex_id: dexId })
    }
  })

  return {
    series,
    set,
    cards: firstPartnerCards,
    dexLinks: firstPartnerDexLinks.sort((a, b) => (a.dex_id - b.dex_id) || a.card_id.localeCompare(b.card_id)),
  }
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

  const detailedVariants = Array.isArray(card.variants) ? card.variants : card.variants_detailed
  if (Array.isArray(detailedVariants)) {
    const variantThirdParty = detailedVariants
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

/** Fallback dex links for Pokémon cards that ship without `dexId` (e.g. 30th Classic Collection reprints). */
function inferPokemonCardDexIds(category: unknown, name: unknown) {
  if (category !== "Pokemon") return []
  const englishName = typeof name === "string"
    ? name
    : name && typeof name === "object"
      ? (name as Record<string, unknown>).en
      : null
  return typeof englishName === "string" ? inferDexIdsFromCardName(englishName) : []
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

async function fetchAssetManifest(logger?: (message: string) => void): Promise<AssetManifest> {
  logWith(logger, "Fetching TCGdex asset manifest")
  const attempts = 3
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch("https://assets.tcgdex.net/datas.json")

    if (response.ok) {
      return (await response.json()) as AssetManifest
    }

    if (attempt >= attempts || response.status < 500) {
      throw new Error(`Failed to fetch TCGdex asset manifest: ${response.status}`)
    }

    logWith(logger, `TCGdex asset manifest returned ${response.status}; retrying (${attempt}/${attempts - 1})`)
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
  }
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

type RestSetSink = {
  seriesById: Map<string, MirrorSeriesRow>
  setsById: Map<string, MirrorSetRow>
  cardsById: Map<string, MirrorCardRow>
  externalSourcesByCardId: Map<string, MirrorCardExternalSourceRow>
  dexLinks: Set<string>
  assetManifest: AssetManifest
  pokemonTcgSetIndex: Map<string, PokemonTcgSet>
  pokemonTcgCardsBySetId: Map<string, Map<string, PokemonTcgCard>>
  matchedPokemonTcgSetIds: Set<string>
  matchedPokemonTcgCardIds: Set<string>
  logger?: (message: string) => void
  /** Parallel TCGdex card requests per set. */
  concurrency?: number
}


/** Add one live TCGdex REST set (series, set, cards, dex links, PokemonTCG matches) to the sink. Returns the number of cards added. */
async function appendRestSetRows(restSet: RestSetDetail & { id: string }, seriesId: string, sink: RestSetSink) {
  const {
    seriesById,
    setsById,
    cardsById,
    externalSourcesByCardId,
    dexLinks,
    assetManifest,
    pokemonTcgSetIndex,
    pokemonTcgCardsBySetId,
    matchedPokemonTcgSetIds,
    matchedPokemonTcgCardIds,
    logger,
  } = sink
  const pendingCardIds = (restSet.cards ?? [])
    .map((card) => card.id)
    .filter((cardId): cardId is string => Boolean(cardId) && !cardsById.has(cardId as string))
  const fetchedCards = await mapWithConcurrency(pendingCardIds, sink.concurrency ?? 6, (cardId) => fetchRestCard(cardId, logger))
  const prefetchedCards = new Map(pendingCardIds.map((cardId, index) => [cardId, fetchedCards[index]] as const))

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

    const restCard = prefetchedCards.get(cardId) ?? null
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
    if (linkedDexIds.size === 0) {
      for (const dexId of inferPokemonCardDexIds(restCard.category, restCard.name)) linkedDexIds.add(dexId)
    }

    for (const dexId of linkedDexIds) {
      if (Number.isInteger(dexId) && dexId > 0) {
        dexLinks.add(`${cardId}:${dexId}`)
      }
    }

    restSetCardCount += 1
  }

  if (restSetCardCount > 0) {
    logWith(logger, `Added ${restSetCardCount} cards from live TCGdex REST set ${restSet.id}`)
  }

  return restSetCardCount
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
    const imported = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(filePath).href)) as { default: TCGCard }
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
    if (linkedDexIds.size === 0) {
      for (const dexId of inferPokemonCardDexIds(card.category, card.name)) linkedDexIds.add(dexId)
    }

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

    restSupplementCardCount += await appendRestSetRows(restSet as RestSetDetail & { id: string }, seriesId, {
      seriesById,
      setsById,
      cardsById,
      externalSourcesByCardId,
      dexLinks,
      assetManifest,
      pokemonTcgSetIndex,
      pokemonTcgCardsBySetId,
      matchedPokemonTcgSetIds,
      matchedPokemonTcgCardIds,
      logger,
    })
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
  const firstPartnerSupplement = buildFirstPartnerPackSupplementRows([...cardsById.values()], dexLinkRows)

  if (firstPartnerSupplement.cards.length > 0) {
    seriesById.set(firstPartnerSupplement.series.id, firstPartnerSupplement.series)
    setsById.set(firstPartnerSupplement.set.id, firstPartnerSupplement.set)

    for (const card of firstPartnerSupplement.cards) {
      cardsById.set(card.id, card)
    }

    for (const link of firstPartnerSupplement.dexLinks) {
      dexLinks.add(`${link.card_id}:${link.dex_id}`)
    }

    logWith(logger, `Added ${firstPartnerSupplement.cards.length} curated First Partner Pack cards`)
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
    await upsertRestSetPayload(client, payload, logger)
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

export interface IncrementalCardDbSyncOptions {
  request: IncrementalSyncRequest
  logger?: (message: string) => void
  /** Stop starting new sets once this many ms have elapsed (keeps the call inside Vercel's maxDuration). */
  timeBudgetMs?: number
  concurrency?: number
  /** When set, each synced set's English high/low images are copied into Vercel Blob after its rows are written. */
  imageMirror?: CardImageMirror | null
}

export interface IncrementalCardDbSyncResult {
  mode: IncrementalSyncRequest["mode"]
  dryRun: boolean
  targetSetIds: string[]
  syncedSets: Array<{
    id: string
    name: string | null
    cardCount: number
    dexLinkCount: number
    externalSourceCount: number
    images?: MirrorSetImagesResult
  }>
  skippedSetIds: string[]
  /** `missing` mode only: candidates whose listed cards are already all mirrored (TCGdex total overstates them). */
  upToDateSetIds: string[]
  remainingSetIds: string[]
  durationMs: number
}

async function fetchRestSetSummariesNewestFirst(logger?: (message: string) => void) {
  const sets = await fetchJson<RestSetSummary[]>(
    `${TCGDEX_REST_BASE_URL}/sets?sort:field=releaseDate&sort:order=DESC`,
    logger,
  )
  return Array.isArray(sets) ? sets : []
}

async function fetchExcludedSeriesSetIds(logger?: (message: string) => void) {
  const excluded = new Set<string>()
  for (const seriesId of EXCLUDED_SERIES_IDS) {
    const series = await fetchJson<{ sets?: Array<{ id?: string }> }>(
      `${TCGDEX_REST_BASE_URL}/series/${encodeURIComponent(seriesId)}`,
      logger,
    )
    for (const set of series?.sets ?? []) {
      if (set.id) excluded.add(set.id)
    }
  }
  return excluded
}

export async function upsertRestSetPayload(
  client: Client,
  payload: {
    series: MirrorSeriesRow[]
    sets: MirrorSetRow[]
    cards: MirrorCardRow[]
    externalSources: MirrorCardExternalSourceRow[]
    dexLinks: Array<{ card_id: string; dex_id: number }>
  },
  logger?: (message: string) => void,
  manageTransaction = true,
) {
  if (manageTransaction) await client.query("BEGIN")
  try {
    await insertJsonBatch(
      client,
      "series",
      payload.series,
      `
        INSERT INTO public.tcg_series (id, name_json, name_en, raw_json)
        SELECT id, name_json, name_en, raw_json
        FROM jsonb_to_recordset($1::jsonb) AS row(id text, name_json jsonb, name_en text, raw_json jsonb)
        ON CONFLICT (id) DO UPDATE SET
          name_json = public.tcg_series.name_json || EXCLUDED.name_json,
          name_en = COALESCE(public.tcg_series.name_en, EXCLUDED.name_en)
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
          id text, series_id text, name_json jsonb, name_en text, official_card_count integer, release_date date, raw_json jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          series_id = EXCLUDED.series_id,
          name_json = EXCLUDED.name_json,
          name_en = EXCLUDED.name_en,
          official_card_count = EXCLUDED.official_card_count,
          release_date = EXCLUDED.release_date,
          raw_json = EXCLUDED.raw_json
      `,
      logger,
      250,
    )

    const existing = await client.query<{ id: string; set_id: string; local_id: string }>(
      "select id, set_id, local_id from public.tcg_cards where set_id = ANY($1::text[])",
      [[...new Set(payload.cards.map(card => card.set_id))]],
    )
    payload = { ...payload, ...preserveCatalogIds(payload, existing.rows) }

    await insertJsonBatch(
      client,
      "cards",
      payload.cards,
      `
        INSERT INTO public.tcg_cards (
          id, series_id, set_id, local_id, local_id_sort, name_json, name_en, category, rarity, hp, illustrator,
          types_json, image_languages_json, variants_json, external_ids_json, raw_json
        )
        SELECT
          id, series_id, set_id, local_id, local_id_sort, name_json, name_en, category, rarity, hp, illustrator,
          types_json, image_languages_json, variants_json, external_ids_json, raw_json
        FROM jsonb_to_recordset($1::jsonb) AS row(
          id text, series_id text, set_id text, local_id text, local_id_sort integer, name_json jsonb, name_en text,
          category text, rarity text, hp integer, illustrator text, types_json jsonb, image_languages_json jsonb,
          variants_json jsonb, external_ids_json jsonb, raw_json jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          series_id = EXCLUDED.series_id,
          set_id = EXCLUDED.set_id,
          local_id = EXCLUDED.local_id,
          local_id_sort = EXCLUDED.local_id_sort,
          name_json = EXCLUDED.name_json,
          name_en = EXCLUDED.name_en,
          category = EXCLUDED.category,
          rarity = EXCLUDED.rarity,
          hp = EXCLUDED.hp,
          illustrator = EXCLUDED.illustrator,
          types_json = EXCLUDED.types_json,
          image_languages_json = EXCLUDED.image_languages_json,
          variants_json = EXCLUDED.variants_json,
          external_ids_json = public.tcg_cards.external_ids_json || EXCLUDED.external_ids_json
            || CASE WHEN public.tcg_cards.external_ids_json ? 'catalog' OR EXCLUDED.external_ids_json ? 'catalog'
                 THEN jsonb_build_object('catalog', coalesce(public.tcg_cards.external_ids_json->'catalog', '{}'::jsonb)
                   || coalesce(EXCLUDED.external_ids_json->'catalog', '{}'::jsonb)) ELSE '{}'::jsonb END,
          raw_json = public.tcg_cards.raw_json || EXCLUDED.raw_json
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
        FROM jsonb_to_recordset($1::jsonb) AS row(card_id text, source text, source_card_id text, source_set_id text, raw_json jsonb)
        ON CONFLICT (card_id, source) DO UPDATE SET
          source_card_id = EXCLUDED.source_card_id,
          source_set_id = EXCLUDED.source_set_id,
          raw_json = EXCLUDED.raw_json
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
        FROM jsonb_to_recordset($1::jsonb) AS row(card_id text, dex_id integer)
        ON CONFLICT DO NOTHING
      `,
      logger,
      1000,
    )

    if (manageTransaction) await client.query("COMMIT")
  } catch (error) {
    if (manageTransaction) await client.query("ROLLBACK")
    throw error
  }
}

/**
 * Serverless-friendly sync: pulls individual sets from the live TCGdex REST API and upserts them,
 * without cloning the cards-database repo or truncating the mirror. Safe to call repeatedly;
 * returns `remainingSetIds` when the per-call set/time budget runs out.
 */
export async function runIncrementalCardDbSync(options: IncrementalCardDbSyncOptions): Promise<IncrementalCardDbSyncResult> {
  const startedAt = Date.now()
  const { request, logger } = options
  const timeBudgetMs = options.timeBudgetMs ?? Number.POSITIVE_INFINITY
  const excludedSetIds = await fetchExcludedSeriesSetIds(logger)

  const needsDb = !request.dryRun || request.mode === "missing"
  const client = needsDb ? new Client({ connectionString: getMirrorDatabaseUrl() }) : null
  let locked = false

  if (client) {
    await client.connect()
  }

  try {
    if (client && !request.dryRun) {
      const lockResult = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [CARD_DB_SYNC_LOCK_KEY])
      locked = Boolean(lockResult.rows[0]?.locked)
      if (!locked) {
        throw new Error("A card database sync is already running")
      }
    }

    let mirrorCounts = new Map<string, number>()
    let mirrorSetIds = new Set<string>()
    if (request.mode === "missing" && client) {
      const [countResult, setResult] = await Promise.all([
        client.query<{ set_id: string; card_count: string }>(
          "select set_id, count(*)::text as card_count from public.tcg_cards group by set_id",
        ),
        client.query<{ id: string }>("select id from public.tcg_sets"),
      ])
      mirrorCounts = new Map(countResult.rows.map((row) => [row.set_id, Number(row.card_count)]))
      mirrorSetIds = new Set(setResult.rows.map((row) => row.id))
    }

    const restSets = request.mode === "sets" ? [] : await fetchRestSetSummariesNewestFirst(logger)
    const targetSetIds = selectIncrementalSyncTargets(request, restSets, excludedSetIds, mirrorCounts)
    logWith(logger, `Incremental sync (${request.mode}) targets: ${targetSetIds.join(", ") || "none"}`)

    const [assetManifest, pokemonTcgSets] = targetSetIds.length > 0
      ? await Promise.all([fetchAssetManifest(logger), fetchPokemonTcgSets(logger)])
      : [{} as AssetManifest, [] as PokemonTcgSet[]]
    const pokemonTcgSetIndex = buildPokemonTcgSetIndex(pokemonTcgSets)

    const syncedSets: IncrementalCardDbSyncResult["syncedSets"] = []
    const skippedSetIds: string[] = []
    const upToDateSetIds: string[] = []
    const remainingSetIds: string[] = []

    for (const setId of targetSetIds) {
      if (syncedSets.length + skippedSetIds.length >= request.maxSets || Date.now() - startedAt > timeBudgetMs) {
        remainingSetIds.push(setId)
        continue
      }

      const restSet = await fetchRestSetDetail(setId, logger)
      const seriesId = restSet?.serie?.id
      if (!restSet?.id || !seriesId || EXCLUDED_SERIES_IDS.has(seriesId)) {
        logWith(logger, `Skipping ${setId}: not found or excluded series`)
        skippedSetIds.push(setId)
        continue
      }

      if (
        request.mode === "missing" &&
        isSetUpToDateWithListedCards(restSet.cards?.length ?? 0, mirrorCounts.get(setId) ?? 0, mirrorSetIds.has(setId))
      ) {
        upToDateSetIds.push(setId)
        continue
      }

      const sink: RestSetSink = {
        seriesById: new Map(),
        setsById: new Map(),
        cardsById: new Map(),
        externalSourcesByCardId: new Map(),
        dexLinks: new Set(),
        assetManifest,
        pokemonTcgSetIndex,
        pokemonTcgCardsBySetId: new Map(),
        matchedPokemonTcgSetIds: new Set(),
        matchedPokemonTcgCardIds: new Set(),
        logger,
        concurrency: options.concurrency ?? 8,
      }
      const cardCount = await appendRestSetRows(restSet as RestSetDetail & { id: string }, seriesId, sink)
      const dexLinks = [...sink.dexLinks].map((key) => {
        const separator = key.lastIndexOf(":")
        return { card_id: key.slice(0, separator), dex_id: Number(key.slice(separator + 1)) }
      })
      const payload = {
        series: [...sink.seriesById.values()],
        sets: [...sink.setsById.values()],
        cards: [...sink.cardsById.values()],
        externalSources: [...sink.externalSourcesByCardId.values()],
        dexLinks,
      }

      if (client && !request.dryRun) {
        await upsertRestSetPayload(client, payload, logger)
      }

      let images: MirrorSetImagesResult | undefined
      if (options.imageMirror && !request.dryRun) {
        try {
          images = await mirrorSetImages(
            options.imageMirror,
            restSet.id,
            payload.cards.map((card) => ({
              seriesId: card.series_id,
              setId: card.set_id,
              localId: card.local_id,
              imageLanguages: parseImageLanguages(card.image_languages_json),
              tcgdexImageUrl: pickTcgdexImageFromExternalIds(card.external_ids_json),
            })),
            { languages: ["en"], qualities: ["high", "low"], deadline: startedAt + timeBudgetMs },
          )
          logWith(logger, `Images ${restSet.id}: ${images.uploaded} uploaded, ${images.alreadyMirrored} already in Blob, ${images.failed} failed`)
        } catch (error) {
          logWith(logger, `Image mirroring failed for ${restSet.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      syncedSets.push({
        id: restSet.id,
        name: restSet.name ?? null,
        cardCount,
        dexLinkCount: dexLinks.length,
        externalSourceCount: payload.externalSources.length,
        ...(images ? { images } : {}),
      })
      logWith(logger, `${request.dryRun ? "Parsed" : "Upserted"} ${cardCount} cards for ${restSet.id}`)
    }

    return {
      mode: request.mode,
      dryRun: request.dryRun,
      targetSetIds,
      syncedSets,
      skippedSetIds,
      upToDateSetIds,
      remainingSetIds,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    if (client) {
      if (locked) {
        try {
          await client.query("select pg_advisory_unlock($1)", [CARD_DB_SYNC_LOCK_KEY])
        } catch {
          // Ignore unlock failures.
        }
      }
      await client.end()
    }
  }
}

export { mapWithConcurrency }


export interface CardImageBackfillResult {
  sets: MirrorSetImagesResult[]
  /** Pass as `?cursor=` to continue; null when every selected set is complete. */
  nextCursor: string | null
  done: boolean
  durationMs: number
}

/**
 * Copies TCGdex card images for mirrored sets into Vercel Blob, set by set (ordered by set id), resumable via cursor.
 * Re-running is cheap: existing blobs are skipped with one `list` call per set and language.
 */
export async function runCardImageBackfill(options: {
  request: CardImageBackfillRequest
  mirror: CardImageMirror
  timeBudgetMs?: number
  logger?: (message: string) => void
}): Promise<CardImageBackfillResult> {
  const startedAt = Date.now()
  const deadline = startedAt + (options.timeBudgetMs ?? Number.POSITIVE_INFINITY)
  const { request, mirror, logger } = options
  const client = new Client({ connectionString: getMirrorDatabaseUrl() })
  await client.connect()

  try {
    const setResult = request.setIds.length > 0
      ? await client.query<{ id: string }>("select id from public.tcg_sets where id = any($1::text[]) order by id", [request.setIds])
      : await client.query<{ id: string }>(
          "select id from public.tcg_sets where ($1::text is null or id >= $1) order by id",
          [request.cursor],
        )
    const setIds = setResult.rows.map((row) => row.id)
    const sets: MirrorSetImagesResult[] = []
    let uploads = 0
    let nextCursor: string | null = null

    for (const setId of setIds) {
      if (sets.length >= request.maxSets || Date.now() > deadline || uploads >= request.maxUploads) {
        nextCursor = setId
        break
      }

      const cardResult = await client.query<{
        series_id: string
        set_id: string
        local_id: string
        image_languages_json: unknown
        tcgdex_image: string | null
      }>(
        "select series_id, set_id, local_id, image_languages_json, external_ids_json->'tcgdex'->>'image' as tcgdex_image from public.tcg_cards where set_id = $1",
        [setId],
      )
      const cards: MirrorableCard[] = cardResult.rows.map((row) => ({
        seriesId: row.series_id,
        setId: row.set_id,
        localId: row.local_id,
        imageLanguages: parseImageLanguages(row.image_languages_json),
        tcgdexImageUrl: row.tcgdex_image,
      }))
      const result = await mirrorSetImages(mirror, setId, cards, {
        languages: request.languages,
        qualities: request.qualities,
        deadline,
        maxUploads: request.maxUploads - uploads,
      })
      uploads += result.uploaded + result.failed
      sets.push(result)
      logWith(logger, `Images ${setId}: ${result.uploaded} uploaded, ${result.alreadyMirrored} already in Blob, ${result.failed} failed`)

      if (!result.complete) {
        // Resume this set next time (already-copied images are skipped).
        nextCursor = setId
        break
      }
    }

    return { sets, nextCursor, done: nextCursor === null, durationMs: Date.now() - startedAt }
  } finally {
    await client.end()
  }
}
