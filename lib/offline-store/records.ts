// What Holo Folder keeps in IndexedDB for offline use. Every record is a plain, versionless JSON value
// under a fixed key; readers validate what they get back.
import type { TCGSetSlotsResponse } from '@/lib/tcg-set-slots';
import type { OfflineKeyValueStore } from '@/lib/offline-store/kv';
import {
  isIllustratorCardsResponse,
  isIllustratorDirectory,
  type IllustratorCardsResponse,
  type IllustratorSummary,
} from '@/lib/illustrators';

const SET_QUERY_PREFIX = 'sets:query:';
export const MAX_STORED_SET_QUERIES = 40;

/** Set-coverage lookups the user made (`/app/api/tcg-set-slots` responses), keyed by their query string. */
interface StoredSetQuery {
  savedAt: string;
  payload: TCGSetSlotsResponse;
}

function isSetSlotsResponse(value: unknown): value is TCGSetSlotsResponse {
  const payload = value as Partial<TCGSetSlotsResponse> | null;
  return Boolean(payload) && Array.isArray(payload!.sets) && Array.isArray(payload!.slots);
}

export async function saveSetQuery(
  store: OfflineKeyValueStore,
  queryString: string,
  payload: TCGSetSlotsResponse,
  now = new Date(),
) {
  if (!isSetSlotsResponse(payload)) return;
  await store.set(`${SET_QUERY_PREFIX}${queryString}`, {
    savedAt: now.toISOString(),
    payload,
  } satisfies StoredSetQuery);

  // Keep the most recent lookups only.
  const keys = await store.keys(SET_QUERY_PREFIX);
  if (keys.length <= MAX_STORED_SET_QUERIES) return;
  const dated = await Promise.all(
    keys.map(async (key) => ({ key, savedAt: (await store.get<StoredSetQuery>(key))?.savedAt ?? '' })),
  );
  dated.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  await Promise.all(dated.slice(0, dated.length - MAX_STORED_SET_QUERIES).map(({ key }) => store.delete(key)));
}

export async function loadSetQuery(
  store: OfflineKeyValueStore,
  queryString: string,
): Promise<TCGSetSlotsResponse | null> {
  const value = await store.get<StoredSetQuery>(`${SET_QUERY_PREFIX}${queryString}`);
  return value && isSetSlotsResponse(value.payload) ? value.payload : null;
}

// Illustrator browsing: the directory (for search) and the most recently opened illustrator card lists.
export const ILLUSTRATOR_DIRECTORY_RECORD_KEY = 'illustrators:directory';
const ILLUSTRATOR_CARDS_PREFIX = 'illustrators:cards:';
export const MAX_STORED_ILLUSTRATORS = 40;

function illustratorCardsKey(name: string, language: string) {
  return `${ILLUSTRATOR_CARDS_PREFIX}${language}:${name.toLowerCase()}`;
}

export async function saveIllustratorDirectory(
  store: OfflineKeyValueStore,
  directory: IllustratorSummary[],
  now = new Date(),
) {
  if (!isIllustratorDirectory(directory)) return;
  await store.set(ILLUSTRATOR_DIRECTORY_RECORD_KEY, { savedAt: now.toISOString(), directory });
}

export async function loadIllustratorDirectory(store: OfflineKeyValueStore): Promise<IllustratorSummary[] | null> {
  const value = await store.get<{ directory?: unknown }>(ILLUSTRATOR_DIRECTORY_RECORD_KEY);
  return value && isIllustratorDirectory(value.directory) ? value.directory : null;
}

export async function saveIllustratorCards(
  store: OfflineKeyValueStore,
  language: string,
  payload: IllustratorCardsResponse,
  now = new Date(),
) {
  if (!isIllustratorCardsResponse(payload)) return;
  await store.set(illustratorCardsKey(payload.illustrator, language), { savedAt: now.toISOString(), payload });

  const keys = await store.keys(ILLUSTRATOR_CARDS_PREFIX);
  if (keys.length <= MAX_STORED_ILLUSTRATORS) return;
  const dated = await Promise.all(
    keys.map(async (key) => ({ key, savedAt: (await store.get<{ savedAt?: string }>(key))?.savedAt ?? '' })),
  );
  dated.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  await Promise.all(dated.slice(0, dated.length - MAX_STORED_ILLUSTRATORS).map(({ key }) => store.delete(key)));
}

export async function loadIllustratorCards(
  store: OfflineKeyValueStore,
  name: string,
  language: string,
): Promise<IllustratorCardsResponse | null> {
  const value = await store.get<{ payload?: unknown }>(illustratorCardsKey(name, language));
  return value && isIllustratorCardsResponse(value.payload) ? value.payload : null;
}
