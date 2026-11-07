// Client-side loading for illustrator browsing: network first, then the on-device copy (IndexedDB), so
// search and previously opened illustrators keep working offline. Successful responses are saved for later.
import type { CardLanguage } from "@/lib/domain/cards"
import { getOfflineStore } from "@/lib/offline-store/kv"
import {
  loadIllustratorCards as loadStoredIllustratorCards,
  loadIllustratorDirectory as loadStoredIllustratorDirectory,
  saveIllustratorCards,
  saveIllustratorDirectory,
} from "@/lib/offline-store/records"
import {
  buildIllustratorDirectory,
  cleanIllustratorName,
  isIllustratorCardsResponse,
  isIllustratorDirectory,
  type IllustratorCardsResponse,
  type IllustratorSummary,
} from "@/lib/illustrators"

export type IllustratorLoadResult<T> = { data: T; source: "network" | "device" } | { data: null; source: "none" }

let directoryPromise: Promise<IllustratorLoadResult<IllustratorSummary[]>> | null = null

async function fetchJson(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return response.json() as Promise<unknown>
}

async function fromDevice<T>(load: (store: NonNullable<ReturnType<typeof getOfflineStore>>) => Promise<T | null>): Promise<IllustratorLoadResult<T>> {
  const store = getOfflineStore()
  if (!store) return { data: null, source: "none" }
  const data = await load(store).catch(() => null)
  return data ? { data, source: "device" } : { data: null, source: "none" }
}

/** The illustrator directory, loaded once per page session (a failed load is retried next time). */
export function loadIllustratorDirectory(): Promise<IllustratorLoadResult<IllustratorSummary[]>> {
  directoryPromise ??= (async (): Promise<IllustratorLoadResult<IllustratorSummary[]>> => {
    try {
      const payload = await fetchJson("/app/api/tcg-illustrators") as { illustrators?: unknown }
      if (!isIllustratorDirectory(payload?.illustrators)) throw new Error("Unexpected illustrator directory")
      const directory = buildIllustratorDirectory(payload.illustrators.map((entry) => ({ name: entry.name, count: entry.cardCount })))
      const store = getOfflineStore()
      if (store) void saveIllustratorDirectory(store, directory).catch(() => undefined)
      return { data: directory, source: "network" }
    } catch {
      return fromDevice((store) => loadStoredIllustratorDirectory(store))
    }
  })().then((result) => {
    if (result.source !== "network") directoryPromise = null
    return result
  })
  return directoryPromise
}

/** Every card by one illustrator; offline, the last copy saved on this device. */
export async function loadIllustratorCards(name: string, language: CardLanguage = "en"): Promise<IllustratorLoadResult<IllustratorCardsResponse>> {
  const illustrator = cleanIllustratorName(name)
  if (!illustrator) return { data: null, source: "none" }
  try {
    const payload = await fetchJson(`/app/api/tcg-illustrators?name=${encodeURIComponent(illustrator)}&language=${encodeURIComponent(language)}`)
    if (!isIllustratorCardsResponse(payload)) throw new Error("Unexpected illustrator cards")
    const store = getOfflineStore()
    if (store) void saveIllustratorCards(store, language, payload).catch(() => undefined)
    return { data: payload, source: "network" }
  } catch {
    return fromDevice((store) => loadStoredIllustratorCards(store, illustrator, language))
  }
}

/** Test helper. */
export function resetIllustratorDirectoryCache() {
  directoryPromise = null
}
