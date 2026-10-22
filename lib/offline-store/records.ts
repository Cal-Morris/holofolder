// What BinderDex keeps in IndexedDB for offline use. Every record is a plain, versionless JSON value
// under a fixed key; readers validate what they get back.
import type { CollectedPokemon, WantedCard } from "@/lib/domain/cards"
import { normalizeCollectionItems } from "@/lib/collection/normalize"
import type { TCGSetSlotsResponse } from "@/lib/tcg-set-slots"
import type { OfflineKeyValueStore } from "@/lib/offline-store/kv"
import {
  isIllustratorCardsResponse,
  isIllustratorDirectory,
  type IllustratorCardsResponse,
  type IllustratorSummary,
} from "@/lib/illustrators"

export const COLLECTION_RECORD_KEY = "collection"
export const PRICES_RECORD_KEY = "prices"
export const MIGRATION_RECORD_KEY = "meta:migrated-from-local-storage"
const SET_QUERY_PREFIX = "sets:query:"
export const MAX_STORED_SET_QUERIES = 40

/** The saved collection plus the edits not yet synced. The wantlist is derived from the same rows. */
export interface CollectionRecord {
  ownerUserId: string | null
  /** The binder the collection is of; null for the single-binder layout. */
  binderId?: string | null
  savedAt: string
  collection: CollectedPokemon[]
  pendingOperations: unknown[]
}

export interface WantlistEntry {
  pokemonId: number
  pokemonName: string
  card: WantedCard | null
}

/** Wishlisted Pokémon and every wanted printing, as the Wanted view lists them. */
export function selectWantlist(collection: CollectedPokemon[]): WantlistEntry[] {
  const entries: WantlistEntry[] = []
  for (const item of collection) {
    if (item.wanted_cards.length > 0) {
      for (const card of item.wanted_cards) entries.push({ pokemonId: item.pokemon_id, pokemonName: item.pokemon_name, card })
    } else if (item.status === "wishlisted") {
      entries.push({ pokemonId: item.pokemon_id, pokemonName: item.pokemon_name, card: null })
    }
  }
  return entries
}

export async function saveCollectionRecord(store: OfflineKeyValueStore, record: CollectionRecord) {
  await store.set(COLLECTION_RECORD_KEY, record)
}

export async function loadCollectionRecord(store: OfflineKeyValueStore): Promise<CollectionRecord | null> {
  const value = await store.get<Partial<CollectionRecord>>(COLLECTION_RECORD_KEY)
  if (!value || !Array.isArray(value.collection)) return null
  return {
    ownerUserId: typeof value.ownerUserId === "string" ? value.ownerUserId : null,
    binderId: typeof value.binderId === "string" ? value.binderId : null,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date(0).toISOString(),
    collection: normalizeCollectionItems(value.collection),
    pendingOperations: Array.isArray(value.pendingOperations) ? value.pendingOperations : [],
  }
}

/** Last-known price for a card, copied from the price cache the app already keeps (read-only). */
export interface LastKnownPrice {
  cardId: string
  language: string | null
  marketGbpAmount: number | null
  gbpAmount: number | null
  source: string | null
  updatedAt: string | null
}

export interface PricesRecord {
  savedAt: string
  prices: Record<string, LastKnownPrice>
}

const finiteOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)
const stringOrNull = (value: unknown) => (typeof value === "string" ? value : null)

/** Pick the last-known price fields out of the existing client price cache JSON. Invalid entries are skipped. */
export function extractLastKnownPrices(rawPriceCache: string | null): Record<string, LastKnownPrice> {
  if (!rawPriceCache) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(rawPriceCache)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

  const prices: Record<string, LastKnownPrice> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue
    const entry = value as Record<string, unknown>
    if (typeof entry.cardId !== "string") continue
    const marketGbpAmount = finiteOrNull(entry.marketGbpAmount)
    const gbpAmount = finiteOrNull(entry.gbpAmount)
    if (marketGbpAmount === null && gbpAmount === null) continue
    prices[key] = {
      cardId: entry.cardId,
      language: stringOrNull(entry.language),
      marketGbpAmount,
      gbpAmount,
      source: stringOrNull(entry.source),
      updatedAt: stringOrNull(entry.updatedAt),
    }
  }
  return prices
}

/** Merge newly seen prices into the stored ones, so a card that dropped out of the client cache keeps its last price. */
export async function saveLastKnownPrices(store: OfflineKeyValueStore, prices: Record<string, LastKnownPrice>, now = new Date()) {
  if (Object.keys(prices).length === 0) return
  const existing = await loadLastKnownPrices(store)
  await store.set(PRICES_RECORD_KEY, { savedAt: now.toISOString(), prices: { ...existing, ...prices } } satisfies PricesRecord)
}

export async function loadLastKnownPrices(store: OfflineKeyValueStore): Promise<Record<string, LastKnownPrice>> {
  const value = await store.get<Partial<PricesRecord>>(PRICES_RECORD_KEY)
  return value && value.prices && typeof value.prices === "object" ? value.prices : {}
}

/** Set-coverage lookups the user made (`/api/tcg-set-slots` responses), keyed by their query string. */
interface StoredSetQuery {
  savedAt: string
  payload: TCGSetSlotsResponse
}

function isSetSlotsResponse(value: unknown): value is TCGSetSlotsResponse {
  const payload = value as Partial<TCGSetSlotsResponse> | null
  return Boolean(payload) && Array.isArray(payload!.sets) && Array.isArray(payload!.slots)
}

export async function saveSetQuery(store: OfflineKeyValueStore, queryString: string, payload: TCGSetSlotsResponse, now = new Date()) {
  if (!isSetSlotsResponse(payload)) return
  await store.set(`${SET_QUERY_PREFIX}${queryString}`, { savedAt: now.toISOString(), payload } satisfies StoredSetQuery)

  // Keep the most recent lookups only.
  const keys = await store.keys(SET_QUERY_PREFIX)
  if (keys.length <= MAX_STORED_SET_QUERIES) return
  const dated = await Promise.all(keys.map(async (key) => ({ key, savedAt: (await store.get<StoredSetQuery>(key))?.savedAt ?? "" })))
  dated.sort((a, b) => a.savedAt.localeCompare(b.savedAt))
  for (const { key } of dated.slice(0, dated.length - MAX_STORED_SET_QUERIES)) {
    await store.delete(key)
  }
}

export async function loadSetQuery(store: OfflineKeyValueStore, queryString: string): Promise<TCGSetSlotsResponse | null> {
  const value = await store.get<StoredSetQuery>(`${SET_QUERY_PREFIX}${queryString}`)
  return value && isSetSlotsResponse(value.payload) ? value.payload : null
}

/**
 * One-time copy of the localStorage collection snapshot and pending edits into IndexedDB. Skipped when
 * IndexedDB already has a collection (it is then kept in sync by the app) or when it already ran.
 */
export async function migrateLocalStorageToOfflineStore(
  storage: Pick<Storage, "getItem">,
  store: OfflineKeyValueStore,
  keys: { snapshot: string; pendingOperations: string },
  now = new Date(),
) {
  if (await store.get(MIGRATION_RECORD_KEY)) return "already-migrated" as const

  let result: "migrated" | "nothing-to-migrate" | "kept-existing" = "nothing-to-migrate"
  if (await store.get(COLLECTION_RECORD_KEY)) {
    result = "kept-existing"
  } else {
    const snapshot = safeParse(storage.getItem(keys.snapshot)) as Partial<CollectionRecord> | null
    if (snapshot && Array.isArray(snapshot.collection)) {
      const pending = safeParse(storage.getItem(keys.pendingOperations))
      await saveCollectionRecord(store, {
        ownerUserId: typeof snapshot.ownerUserId === "string" ? snapshot.ownerUserId : null,
        savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : now.toISOString(),
        collection: normalizeCollectionItems(snapshot.collection),
        pendingOperations: Array.isArray(pending) ? pending : [],
      })
      result = "migrated"
    }
  }

  await store.set(MIGRATION_RECORD_KEY, { at: now.toISOString(), result })
  return result
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Illustrator browsing: the directory (for search) and the most recently opened illustrator card lists.
export const ILLUSTRATOR_DIRECTORY_RECORD_KEY = "illustrators:directory"
const ILLUSTRATOR_CARDS_PREFIX = "illustrators:cards:"
export const MAX_STORED_ILLUSTRATORS = 40

function illustratorCardsKey(name: string, language: string) {
  return `${ILLUSTRATOR_CARDS_PREFIX}${language}:${name.toLowerCase()}`
}

export async function saveIllustratorDirectory(store: OfflineKeyValueStore, directory: IllustratorSummary[], now = new Date()) {
  if (!isIllustratorDirectory(directory)) return
  await store.set(ILLUSTRATOR_DIRECTORY_RECORD_KEY, { savedAt: now.toISOString(), directory })
}

export async function loadIllustratorDirectory(store: OfflineKeyValueStore): Promise<IllustratorSummary[] | null> {
  const value = await store.get<{ directory?: unknown }>(ILLUSTRATOR_DIRECTORY_RECORD_KEY)
  return value && isIllustratorDirectory(value.directory) ? value.directory : null
}

export async function saveIllustratorCards(store: OfflineKeyValueStore, language: string, payload: IllustratorCardsResponse, now = new Date()) {
  if (!isIllustratorCardsResponse(payload)) return
  await store.set(illustratorCardsKey(payload.illustrator, language), { savedAt: now.toISOString(), payload })

  const keys = await store.keys(ILLUSTRATOR_CARDS_PREFIX)
  if (keys.length <= MAX_STORED_ILLUSTRATORS) return
  const dated = await Promise.all(keys.map(async (key) => ({ key, savedAt: (await store.get<{ savedAt?: string }>(key))?.savedAt ?? "" })))
  dated.sort((a, b) => a.savedAt.localeCompare(b.savedAt))
  for (const { key } of dated.slice(0, dated.length - MAX_STORED_ILLUSTRATORS)) {
    await store.delete(key)
  }
}

export async function loadIllustratorCards(store: OfflineKeyValueStore, name: string, language: string): Promise<IllustratorCardsResponse | null> {
  const value = await store.get<{ payload?: unknown }>(illustratorCardsKey(name, language))
  return value && isIllustratorCardsResponse(value.payload) ? value.payload : null
}
