// Delta collection sync: after one full fetch, refreshes ask only for rows whose updated_at moved past the
// newest one already seen (migration 035), plus the server's row count to catch deletes.
// Pure helpers; the queries live in lib/collection/load.ts.

type CollectionRow = Record<string, unknown>

/**
 * Re-read rows a little older than the cursor. updated_at is the writing transaction's start time, so a slow
 * write can commit with a timestamp behind rows already seen. Re-reading a row is harmless.
 */
export const COLLECTION_DELTA_OVERLAP_MS = 60_000

export interface CollectionSyncBaseline {
  ownerUserId: string
  /** The binder the rows belong to; null for the single-binder layout (before migration 039). */
  binderId: string | null
  /** Server rows by pokemon_id, as last read (no local pending edits). */
  rows: Map<number, CollectionRow>
  /** Newest updated_at seen, or null when delta sync can't be used (rows without updated_at, or none). */
  cursor: string | null
}

function rowPokemonId(row: CollectionRow) {
  const pokemonId = Number(row.pokemon_id)
  return Number.isInteger(pokemonId) ? pokemonId : null
}

function rowUpdatedAt(row: CollectionRow) {
  return typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at)) ? row.updated_at : null
}

function newestUpdatedAt(rows: Iterable<CollectionRow>) {
  let newest: string | null = null
  let newestTime = -Infinity
  for (const row of rows) {
    const updatedAt = rowUpdatedAt(row)
    if (!updatedAt) return null
    const time = Date.parse(updatedAt)
    if (time > newestTime) {
      newest = updatedAt
      newestTime = time
    }
  }
  return newest
}

export function createCollectionBaseline(
  ownerUserId: string,
  rows: readonly CollectionRow[],
  binderId: string | null = null,
): CollectionSyncBaseline {
  const byPokemonId = new Map<number, CollectionRow>()
  let complete = true
  for (const row of rows) {
    const pokemonId = rowPokemonId(row)
    if (pokemonId === null) {
      complete = false
      continue
    }
    byPokemonId.set(pokemonId, row)
  }

  return { ownerUserId, binderId, rows: byPokemonId, cursor: complete ? newestUpdatedAt(byPokemonId.values()) : null }
}

/** Lower bound for the next delta query, or null when the baseline can't do a delta. */
export function collectionDeltaSince(baseline: CollectionSyncBaseline | null, ownerUserId: string, binderId: string | null = null) {
  if (!baseline || baseline.ownerUserId !== ownerUserId || baseline.binderId !== binderId || !baseline.cursor) return null
  return new Date(Date.parse(baseline.cursor) - COLLECTION_DELTA_OVERLAP_MS).toISOString()
}

/**
 * Applies changed rows to the baseline. Returns null when the result can't be trusted and a full fetch is
 * needed: the merged set always contains every server row, so a count above the server's means rows were
 * deleted (or a row is malformed).
 */
export function mergeCollectionDelta(
  baseline: CollectionSyncBaseline,
  changedRows: readonly CollectionRow[],
  serverCount: number,
): CollectionSyncBaseline | null {
  const rows = new Map(baseline.rows)
  for (const row of changedRows) {
    const pokemonId = rowPokemonId(row)
    if (pokemonId === null || !rowUpdatedAt(row)) return null
    rows.set(pokemonId, row)
  }
  if (rows.size !== serverCount) return null

  const changedCursor = newestUpdatedAt(changedRows)
  const cursor = changedCursor && baseline.cursor && Date.parse(changedCursor) > Date.parse(baseline.cursor)
    ? changedCursor
    : baseline.cursor

  return { ownerUserId: baseline.ownerUserId, binderId: baseline.binderId, rows, cursor }
}

/** Baseline rows in pokemon_id order, the same order a full fetch returns. */
export function collectionBaselineRows(baseline: CollectionSyncBaseline) {
  return [...baseline.rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row)
}
