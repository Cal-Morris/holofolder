import { isBinderSlug } from "@/lib/binders/url"

// Multiple binders: shared types and row mapping (see docs/multiple-binders.md).
// Every binder is a full National Dex binder; slots (pokemon_collection rows) belong to one binder.

export interface Binder {
  id: string
  ownerUserId: string
  name: string
  /** URL and share-link slug (/app/<slug>/binder/<page>); null before migration 106 or on stale device copies. */
  slug?: string | null
  color: string | null
  sortOrder: number
  isDefault: boolean
  /** Page size for this binder; null inherits the account's binder settings. */
  rows: number | null
  cols: number | null
  createdAt: string | null
  updatedAt: string | null
}

/** Cookie holding the binder last opened on this device (read by the server bootstrap). */
export const ACTIVE_BINDER_COOKIE = "binderdex_binder"
/** Cookie holding that binder's pockets per page as "rowsxcols", so the server paints the right skeleton. */
export const BINDER_GRID_COOKIE = "binderdex_grid"
export interface BinderGrid { rows: number; cols: number }
export function parseBinderGrid(value: unknown): BinderGrid | null {
  const match = typeof value === "string" ? /^([1-8])x([1-8])$/.exec(value) : null
  return match ? { rows: Number(match[1]), cols: Number(match[2]) } : null
}
export const BINDER_NAME_MAX_LENGTH = 40
export const DEFAULT_BINDER_NAME = "My binder"
/** Binders are cheap, but a ceiling keeps the switcher and offline storage sane. */
export const MAX_BINDERS_PER_OWNER = 20

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isBinderId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

const intOrNull = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : null)
const stringOrNull = (value: unknown) => (typeof value === "string" ? value : null)

export function binderFromRow(row: Record<string, unknown>): Binder | null {
  if (!isBinderId(row.id) || typeof row.owner_user_id !== "string") return null
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: typeof row.name === "string" && row.name.trim() ? row.name : DEFAULT_BINDER_NAME,
    slug: isBinderSlug(row.slug) ? row.slug : null,
    color: stringOrNull(row.color),
    sortOrder: intOrNull(row.sort_order) ?? 0,
    isDefault: row.is_default === true,
    rows: intOrNull(row.binder_rows),
    cols: intOrNull(row.binder_cols),
    createdAt: stringOrNull(row.created_at),
    updatedAt: stringOrNull(row.updated_at),
  }
}

/** Default first, then sort order, then creation time: the order the switcher shows. */
export function sortBinders(binders: readonly Binder[]) {
  return [...binders].sort((a, b) =>
    a.sortOrder - b.sortOrder
    || (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
    || a.id.localeCompare(b.id),
  )
}

export function bindersFromRows(rows: readonly Record<string, unknown>[] | null | undefined) {
  return sortBinders((rows ?? []).flatMap((row) => {
    const binder = binderFromRow(row)
    return binder ? [binder] : []
  }))
}

/** Trimmed, single-spaced name, or null when it is empty or too long. */
export function normalizeBinderName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.replace(/\s+/g, " ").trim()
  if (!name || name.length > BINDER_NAME_MAX_LENGTH) return null
  return name
}

/**
 * The binder to open: the requested one if the owner has it, else the last opened one, else the default, else
 * the first. Null only when the owner has no binders (migration 039 not applied, or a brand-new account).
 */
export function pickActiveBinder(binders: readonly Binder[], requestedId?: string | null, lastOpenedId?: string | null) {
  return binders.find((binder) => binder.id === requestedId)
    ?? binders.find((binder) => binder.id === lastOpenedId)
    ?? binders.find((binder) => binder.isDefault)
    ?? binders[0]
    ?? null
}
