import { timingSafeEqual } from "node:crypto"

/**
 * Pure helpers for the incremental card DB sync (`/api/admin/sync-card-db`).
 * Kept free of database / network imports so they can be unit tested directly.
 */

export type IncrementalSyncMode = "sets" | "recent" | "missing"

export interface IncrementalSyncRequest {
  mode: IncrementalSyncMode
  setIds: string[]
  recent: number
  maxSets: number
  dryRun: boolean
}

export interface IncrementalSyncSetSummary {
  id?: string
  cardCount?: {
    total?: number
    official?: number
  }
}

export const DEFAULT_RECENT_SET_COUNT = 3
export const MAX_RECENT_SET_COUNT = 20
export const DEFAULT_MAX_SETS_PER_CALL = 4
export const MAX_SETS_PER_CALL = 12

const SET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/

function parseBoundedInteger(value: string | null, fallback: number, max: number) {
  if (value == null || value.trim() === "") return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function isTruthyParam(value: string | null) {
  return value != null && ["1", "true", "yes", ""].includes(value.trim().toLowerCase())
}

export class InvalidSyncRequestError extends Error {}

/**
 * Parses `?set=me05,30th`, `?recent=2`, `?missing=1` (default), `?maxSets=4`, `?dryRun=1`.
 * Throws InvalidSyncRequestError for malformed set ids.
 */
export function parseIncrementalSyncRequest(searchParams: URLSearchParams): IncrementalSyncRequest {
  const rawSets = searchParams.getAll("set").flatMap((value) => value.split(","))
  const setIds = [...new Set(rawSets.map((value) => value.trim()).filter(Boolean))]
  const invalid = setIds.filter((id) => !SET_ID_PATTERN.test(id))
  if (invalid.length > 0) {
    throw new InvalidSyncRequestError(`Invalid set id(s): ${invalid.join(", ")}`)
  }

  const maxSets = parseBoundedInteger(searchParams.get("maxSets"), DEFAULT_MAX_SETS_PER_CALL, MAX_SETS_PER_CALL)
  const dryRun = searchParams.has("dryRun") && isTruthyParam(searchParams.get("dryRun"))

  if (setIds.length > 0) {
    return { mode: "sets", setIds, recent: 0, maxSets, dryRun }
  }

  if (searchParams.has("recent")) {
    const recent = parseBoundedInteger(searchParams.get("recent"), DEFAULT_RECENT_SET_COUNT, MAX_RECENT_SET_COUNT)
    return { mode: "recent", setIds: [], recent, maxSets, dryRun }
  }

  return { mode: "missing", setIds: [], recent: 0, maxSets, dryRun }
}

const SYNC_SECRET_ENV_NAMES = ["CARD_DB_SYNC_SECRET", "SYNC_SECRET", "CRON_SECRET"] as const

/** Configured secrets that may trigger the admin card DB routes (CARD_DB_SYNC_SECRET, SYNC_SECRET, CRON_SECRET). */
export function getSyncSecrets(env: Record<string, string | undefined>) {
  return SYNC_SECRET_ENV_NAMES.map((name) => env[name]?.trim()).filter((value): value is string => Boolean(value))
}

/** First configured secret, or null when none is set. */
export function getSyncSecret(env: Record<string, string | undefined>) {
  return getSyncSecrets(env)[0] ?? null
}

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Accepts `Authorization: Bearer <secret>` or the legacy `x-card-db-sync-secret: <secret>` header,
 * where <secret> is any of CARD_DB_SYNC_SECRET / SYNC_SECRET / CRON_SECRET. False when none is configured.
 */
export function isAuthorizedSyncRequest(
  authorizationHeader: string | null,
  env: Record<string, string | undefined>,
  legacySecretHeader: string | null = null,
) {
  const secrets = getSyncSecrets(env)
  if (secrets.length === 0) return false

  const authorization = authorizationHeader?.trim() ?? ""
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null
  const candidates = [bearer, legacySecretHeader?.trim() || null].filter((value): value is string => Boolean(value))

  let authorized = false
  for (const secret of secrets) {
    for (const candidate of candidates) {
      if (safeEqual(secret, candidate)) authorized = true
    }
  }
  return authorized
}

/**
 * Picks the TCGdex set ids to sync, in order.
 * `restSetsNewestFirst` is the TCGdex `/sets` list sorted by release date descending.
 * `excludedSetIds` are sets from excluded series (TCG Pocket).
 * `mirrorCardCountsBySetId` are current DB card counts (only used in "missing" mode).
 */
export function selectIncrementalSyncTargets(
  request: Pick<IncrementalSyncRequest, "mode" | "setIds" | "recent">,
  restSetsNewestFirst: IncrementalSyncSetSummary[],
  excludedSetIds: ReadonlySet<string>,
  mirrorCardCountsBySetId: ReadonlyMap<string, number> = new Map(),
) {
  if (request.mode === "sets") {
    return request.setIds.filter((id) => !excludedSetIds.has(id))
  }

  const eligible = restSetsNewestFirst.filter(
    (set): set is IncrementalSyncSetSummary & { id: string } => Boolean(set.id) && !excludedSetIds.has(set.id as string),
  )

  if (request.mode === "recent") {
    return eligible.slice(0, request.recent).map((set) => set.id)
  }

  return eligible
    .filter((set) => {
      const mirrorTotal = mirrorCardCountsBySetId.get(set.id) ?? 0
      const restTotal = typeof set.cardCount?.total === "number" ? set.cardCount.total : null
      return mirrorTotal === 0 || (restTotal != null && restTotal > mirrorTotal)
    })
    .map((set) => set.id)
}
