import { addRecentCard, parseRecentCards, type RecentCard } from "./recent-cards"
import { addRecentQuickSearch } from "./quick-mode"

export const EMPTY_HISTORY_GENERATION = "00000000-0000-0000-0000-000000000000"
export type HistoryKind = "card" | "search"
export interface HistoryScope { accountId: string; ownerId: string; binderId: string }
export interface HistorySnapshot {
  generations: Record<HistoryKind, string>
  cards: RecentCard[]
  searches: string[]
}
export interface HistoryAction {
  id: string
  seq: number
  kind: HistoryKind
  generation: string
  op: "add" | "clear"
  value?: RecentCard | string
}
export interface HistoryStore extends HistorySnapshot {
  clientId: string
  sequence: number
  pending: HistoryAction[]
}
export const emptyHistory = (): HistorySnapshot => ({ generations: { card: EMPTY_HISTORY_GENERATION, search: EMPTY_HISTORY_GENERATION }, cards: [], searches: [] })
export const historyStorageKey = (scope: HistoryScope) => `binderdex:history:v1:${scope.accountId}:${scope.ownerId}:${scope.binderId}`
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)

/** Keep only bounded display metadata; never accept timestamps or arbitrary fields as server authority. */
export function normalizeHistoryCard(value: unknown): RecentCard | null {
  const [card] = parseRecentCards(JSON.stringify([value]))
  if (!card || !card.name.trim() || card.id.length > 200 || card.name.length > 200 || card.setName.length > 200 || card.number.length > 40
    || card.pokemonName.length > 100 || card.dexId > 10000 || (card.image?.length ?? 0) > 2000) return null
  return {
    id: card.id, name: card.name, number: card.number, setName: card.setName,
    dexId: card.dexId, pokemonName: card.pokemonName, viewedAt: card.viewedAt.slice(0, 40),
    ...(card.image && /^https:\/\//.test(card.image) ? { image: card.image } : {}),
    ...(card.language ? { language: card.language.slice(0, 16) } : {}),
    ...(card.localId ? { localId: card.localId.slice(0, 40) } : {}),
    ...(card.setId ? { setId: card.setId.slice(0, 100) } : {}),
    ...(card.officialCardCount ? { officialCardCount: card.officialCardCount } : {}),
    ...(card.rarity ? { rarity: card.rarity.slice(0, 100) } : {}),
    ...(card.variants ? { variants: card.variants } : {}),
    ...(card.finish ? { finish: card.finish } : {}),
    ...(card.canonicalId ? { canonicalId: card.canonicalId } : {}),
    ...(card.aliasIds ? { aliasIds: card.aliasIds.slice(0, 20) } : {}),
  }
}
export function normalizeHistorySearch(value: unknown): string | null {
  if (typeof value !== "string") return null
  return addRecentQuickSearch([], value)[0] ?? null
}
export function parseHistorySnapshot(value: unknown): HistorySnapshot | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const generations = raw.generations as Record<string, unknown> | undefined
  if (!uuid(generations?.card) || !uuid(generations?.search) || !Array.isArray(raw.cards) || !Array.isArray(raw.searches)) return null
  return {
    generations: { card: generations.card, search: generations.search },
    cards: raw.cards.map(normalizeHistoryCard).filter((card): card is RecentCard => card !== null).slice(0, 20),
    searches: raw.searches.map(normalizeHistorySearch).filter((query): query is string => query !== null).slice(0, 8),
  }
}
export function parseHistoryStore(raw: string | null): HistoryStore | null {
  try {
    const value = JSON.parse(raw ?? "null")
    const snapshot = parseHistorySnapshot(value)
    if (!snapshot || !uuid(value.clientId) || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.pending)) return null
    const pending: HistoryAction[] = value.pending.flatMap((entry: HistoryAction) => {
      if (!entry || !uuid(entry.id) || !uuid(entry.generation) || !Number.isSafeInteger(entry.seq) || entry.seq < 1 || entry.seq > value.sequence
        || !["card", "search"].includes(entry.kind) || !["add", "clear"].includes(entry.op)) return []
      const normalized = entry.kind === "card" ? normalizeHistoryCard(entry.value) : normalizeHistorySearch(entry.value)
      return entry.op === "clear" ? [{ ...entry, value: undefined }] : normalized ? [{ ...entry, value: normalized }] : []
    })
    return { ...snapshot, clientId: value.clientId, sequence: value.sequence, pending }
  } catch { return null }
}

export function applyHistoryAction(snapshot: HistorySnapshot, action: HistoryAction): HistorySnapshot {
  if (snapshot.generations[action.kind] !== action.generation) return snapshot
  if (action.op === "clear") return {
    ...snapshot, generations: { ...snapshot.generations, [action.kind]: action.id },
    ...(action.kind === "card" ? { cards: [] } : { searches: [] }),
  }
  if (action.kind === "card") {
    const card = normalizeHistoryCard(action.value)
    return card ? { ...snapshot, cards: addRecentCard(snapshot.cards, card) } : snapshot
  }
  const query = normalizeHistorySearch(action.value)
  return query ? { ...snapshot, searches: addRecentQuickSearch(snapshot.searches, query) } : snapshot
}
export function queueHistoryAction(store: HistoryStore, kind: HistoryKind, op: "add" | "clear", value?: RecentCard | string): HistoryStore {
  const action: HistoryAction = { id: crypto.randomUUID(), seq: store.sequence + 1, generation: store.generations[kind], kind, op, value }
  // Keep clears in order; a clear is a generation boundary, not a replacement list.
  const pending = [...store.pending, action]
  return { ...store, ...applyHistoryAction(store, action), sequence: action.seq, pending }
}

export interface HistoryRemote { sync(clientId: string, actions: HistoryAction[]): Promise<HistorySnapshot> }
export interface HistoryStorage { read(): HistoryStore; write(value: HistoryStore): void }
/** One atomic server transaction, then replay only newer local actions. Stale generations never reappear. */
export async function syncBinderHistory(storage: HistoryStorage, remote: HistoryRemote) {
  const before = storage.read()
  const sent = before.pending.slice(0, 100)
  const snapshot = await remote.sync(before.clientId, sent)
  const current = storage.read()
  const sentIds = new Set(sent.map(action => action.id))
  const pending = current.pending.filter(action => !sentIds.has(action.id))
  const visible = pending.reduce(applyHistoryAction, snapshot)
  storage.write({ ...current, ...visible, pending })
  return pending.length
}
