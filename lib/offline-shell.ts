// Boot data for the offline app shell (/app-shell): everything comes from this device, nothing from the network.
import type { CollectedPokemon } from "@/lib/domain/cards"
import { LOCAL_COLLECTION_SNAPSHOT_KEY } from "@/lib/collection/offline-queue"
import { normalizeCollectionItems } from "@/lib/collection/normalize"
import { getDefaultBinderSettings, normalizeBinderSettings, type BinderSettings, type StoredBinderSettings } from "@/lib/settings"

export const APP_SHELL_PATH = "/app-shell"

export interface OfflineShellState {
  collection: CollectedPokemon[]
  collectionOwnerUserId: string | null
  settings: BinderSettings
  darkMode: boolean
}

type StorageLike = Pick<Storage, "getItem">

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readThemeCookie(cookie: string) {
  const match = cookie.match(/(?:^|;\s*)binderdex_theme=(dark|light)/)
  return match ? match[1] === "dark" : null
}

/**
 * Builds BinderApp's initial props from the local collection snapshot, stored settings and theme cookie.
 */
export function readOfflineShellState(storage: StorageLike, cookie: string, userId: string | null): OfflineShellState {
  const snapshot = readJson(storage, LOCAL_COLLECTION_SNAPSHOT_KEY) as { ownerUserId?: unknown; collection?: unknown } | null
  const snapshotOwner = typeof snapshot?.ownerUserId === "string" ? snapshot.ownerUserId : null
  // Same rule useCollection applies offline: the device's last saved collection is used even when its owner
  // differs from the signed-in user, because in partner mode the binder belongs to the partner.
  const snapshotUsable = Boolean(snapshot && Array.isArray(snapshot.collection))
  const collection = snapshotUsable ? normalizeCollectionItems(snapshot!.collection as Partial<CollectedPokemon>[]) : []
  // In partner mode the collection owner differs from the signed-in user; the snapshot remembers it.
  const collectionOwnerUserId = userId ? (snapshotUsable && snapshotOwner ? snapshotOwner : userId) : null

  const settingsKeys = userId
    ? [`pokemon_binder_settings:${collectionOwnerUserId}`, `pokemon_binder_settings:${userId}`, "pokemon_binder_settings", "pokemon_binder_settings:anon"]
    : ["pokemon_binder_settings:anon", "pokemon_binder_settings"]
  const defaults = getDefaultBinderSettings()
  let settings = defaults
  for (const key of settingsKeys) {
    const stored = readJson(storage, key)
    if (stored && typeof stored === "object") {
      settings = normalizeBinderSettings(stored as StoredBinderSettings, defaults)
      break
    }
  }

  const darkMode = readThemeCookie(cookie) ?? settings.darkMode
  return { collection, collectionOwnerUserId, settings, darkMode }
}
