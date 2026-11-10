import { isCardLanguage } from "@/lib/domain/cards"
import { isBinderGridSize } from "@/lib/binder-layout"
import type { InventoryCatalogEvidence, InventoryLayoutEvidence } from "@/lib/domain/inventory-browse"
import { isContractRecord, isSlotContractId, isSlotRevision } from "@/lib/domain/binder-slots"
import { normalizeInventorySnapshot, type InventorySnapshot } from "@/lib/domain/inventory"

/** Private first-party wire contract. Counts are independent server HEAD/count fences. */
export interface InventoryReadEvidence {
  inventoryRevision: number
  items: number
  placements: number
  collections: number
  binders: number
  slots: number
  storage: { collectionId: string; collectionVersion: number; layoutRevision: number; slotCount: number }[]
}
export interface InventoryReadScope {
  actorUserId: string
  ownerUserId: string
  /** Verified JWT session_id, separate from the device lifecycle epoch. */
  authSessionId: string
  /** Rotate on signout, account/owner/membership change and unlink/relink. Never persist. */
  sessionId: string
}
export interface InventoryNavigationEvidence { catalog: InventoryCatalogEvidence[]; layouts: InventoryLayoutEvidence[] }
export interface InventoryReadEnvelope {
  version: 2
  partnerUserId?: string | null
  /** Known only from the same complete private owner read. */
  defaultCollectionId?: string
  navigation: InventoryNavigationEvidence
  requestId: string
  scope: InventoryReadScope
  evidence: InventoryReadEvidence
  snapshot: InventorySnapshot
}
export function isInventoryReadScope(value: unknown): value is InventoryReadScope {
  return isContractRecord(value, ["actorUserId", "ownerUserId", "authSessionId", "sessionId"])
    && [value.actorUserId, value.ownerUserId, value.authSessionId, value.sessionId].every(isSlotContractId)
}
export function sameInventoryReadScope(a: InventoryReadScope | null, b: InventoryReadScope) {
  return !!a && a.actorUserId === b.actorUserId && a.ownerUserId === b.ownerUserId
    && a.authSessionId === b.authSessionId && a.sessionId === b.sessionId
}

/** Only call on this invocation's authenticated same-origin no-store HTTP response.
 * Shape validation alone does not authenticate arbitrary JSON or localStorage. */
export function parseInventoryReadEnvelope(value: unknown, requestId: string, scope: InventoryReadScope): InventoryReadEnvelope | undefined {
  if (!isContractRecord(value, ["version", "requestId", "scope", "evidence", "snapshot", "navigation", "partnerUserId", "defaultCollectionId"])
    || value.version !== 2 || value.requestId !== requestId || !isInventoryReadScope(value.scope)
    || !sameInventoryReadScope(value.scope, scope)) return undefined
  if (value.partnerUserId === null && scope.actorUserId !== scope.ownerUserId) return undefined
  if ("partnerUserId" in value && value.partnerUserId !== null && (!isSlotContractId(value.partnerUserId)
    || value.partnerUserId === scope.ownerUserId || scope.actorUserId !== scope.ownerUserId && value.partnerUserId !== scope.actorUserId)) return undefined
  const snapshot = normalizeInventorySnapshot(value.snapshot), e = value.evidence
  if (!snapshot || snapshot.ownerUserId !== scope.ownerUserId
    || !isContractRecord(e, ["inventoryRevision", "items", "placements", "collections", "binders", "slots", "storage"])
    || ![e.inventoryRevision, e.items, e.placements, e.collections, e.binders, e.slots].every(isSlotRevision)
    || e.inventoryRevision !== snapshot.inventoryRevision
    || e.items !== snapshot.items.length || e.placements !== snapshot.placements.length
    || e.collections !== snapshot.collections.length || e.binders !== snapshot.binders.length
    || !Array.isArray(e.storage) || e.storage.length !== snapshot.binders.length) return undefined
  const storage: InventoryReadEvidence["storage"] = []
  for (const raw of e.storage) {
    if (!isContractRecord(raw, ["collectionId", "collectionVersion", "layoutRevision", "slotCount"])
      || !isSlotContractId(raw.collectionId) || !isSlotRevision(raw.collectionVersion)
      || !isSlotRevision(raw.layoutRevision) || !isSlotRevision(raw.slotCount)
      || storage.some(s => s.collectionId === raw.collectionId)) return undefined
    const collection = snapshot.collections.find(c => c.id === raw.collectionId)
    const binder = snapshot.binders.find(b => b.collectionId === raw.collectionId)
    if (!collection || !binder || collection.version !== raw.collectionVersion
      || binder.layoutRevision !== raw.layoutRevision || binder.slots.length !== raw.slotCount) return undefined
    storage.push({ collectionId: raw.collectionId, collectionVersion: raw.collectionVersion, layoutRevision: raw.layoutRevision, slotCount: raw.slotCount })
  }
  if (storage.reduce((sum, s) => sum + s.slotCount, 0) !== e.slots) return undefined
  if ("defaultCollectionId" in value && (!isSlotContractId(value.defaultCollectionId)
    || !snapshot.collections.some(c => c.id === value.defaultCollectionId))) return undefined
  const navigation = parseNavigationEvidence(value.navigation, snapshot)
  if (!navigation) return undefined
  return { version: 2, requestId, scope: { ...scope }, snapshot, navigation,
    ...(typeof value.defaultCollectionId === "string" ? { defaultCollectionId: value.defaultCollectionId } : {}), ...(value.partnerUserId === null || isSlotContractId(value.partnerUserId) ? { partnerUserId: value.partnerUserId } : {}),
    evidence: { inventoryRevision: e.inventoryRevision as number, items: e.items as number, placements: e.placements as number,
      collections: e.collections as number, binders: e.binders as number, slots: e.slots as number, storage } }
}

/** Strict public catalog DTOs and exact snapshot grid revisions, never arbitrary private JSON. */
export function parseNavigationEvidence(value: unknown, snapshot: InventorySnapshot): InventoryNavigationEvidence | undefined {
  if (!isContractRecord(value, ["catalog", "layouts"]) || !Array.isArray(value.catalog) || !Array.isArray(value.layouts)) return undefined
  const layouts: InventoryLayoutEvidence[] = [], catalog: InventoryCatalogEvidence[] = []
  for (const l of value.layouts) {
    if (!isContractRecord(l, ["collectionId", "layoutRevision", "rows", "cols"]) || !isSlotContractId(l.collectionId)
      || !isSlotRevision(l.layoutRevision) || !isBinderGridSize(l.rows) || !isBinderGridSize(l.cols)
      || layouts.some(x => x.collectionId === l.collectionId)
      || !snapshot.binders.some(b => b.collectionId === l.collectionId && b.layoutRevision === l.layoutRevision)) return undefined
    layouts.push({ collectionId: l.collectionId, layoutRevision: l.layoutRevision, rows: l.rows, cols: l.cols })
  }
  for (const e of value.catalog) {
    if (!isContractRecord(e, ["card", "speciesNames", "pokemonIds"]) || !Array.isArray(e.speciesNames) || !e.speciesNames.every(isSlotContractId)
      || "pokemonIds" in e && (!Array.isArray(e.pokemonIds) || !e.pokemonIds.every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0) || new Set(e.pokemonIds).size !== e.pokemonIds.length)) return undefined
    const c = e.card
    if (!isContractRecord(c, ["id", "localId", "name", "set", "language", "canonicalId", "aliasIds", "image"])
      || ![c.id, c.localId, c.name].every(isSlotContractId) || !isContractRecord(c.set, ["id", "name"])
      || !isSlotContractId(c.set.id) || !isSlotContractId(c.set.name)
      || "language" in c && !isCardLanguage(c.language) || "canonicalId" in c && !isSlotContractId(c.canonicalId)
      || "aliasIds" in c && (!Array.isArray(c.aliasIds) || !c.aliasIds.every(isSlotContractId))
      || "image" in c && typeof c.image !== "string") return undefined
    if (catalog.some(x => x.card.id === c.id && x.card.language === c.language)) return undefined
    catalog.push({ card: { id: c.id as string, localId: c.localId as string, name: c.name as string, set: { id: c.set.id, name: c.set.name },
      ...(isCardLanguage(c.language) ? { language: c.language } : {}), ...(typeof c.canonicalId === "string" ? { canonicalId: c.canonicalId } : {}),
      ...(Array.isArray(c.aliasIds) ? { aliasIds: [...c.aliasIds] as string[] } : {}), ...(typeof c.image === "string" ? { image: c.image } : {}) }, speciesNames: [...e.speciesNames], ...(Array.isArray(e.pokemonIds) ? { pokemonIds: [...e.pokemonIds] as number[] } : {}) })
  }
  return { catalog, layouts }
}
