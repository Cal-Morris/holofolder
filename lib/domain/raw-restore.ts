import { parseInventoryCommand } from '@/lib/domain/inventory-commands'
import { backupContentKey } from '@/lib/binder-backup-v2'
import { isBinderId } from '@/lib/binders/model'
import { isContractRecord, isSlotContractId, isSlotRevision, normalizeBinderSnapshot } from '@/lib/domain/binder-slots'
import type { BackupArrangementCommand } from '@/lib/domain/backup-import-command'

export const RAW_RESTORE_LIMITS = { bytes: 1048576, slots: 256, items: 512, work: 1024 } as const
export interface RawRestorePlanningScope {
  actorUserId: string
  ownerUserId: string
  source: 'app' | 'rest' | 'mcp'
  credentialId: string | null
  authSessionId: string | null
  partnershipId: string | null
  partnerUserId: string | null
}
/** All scope fields are preconditions, never authority. The gateway reauthenticates their source. */
export interface RawRestoreCommand {
  version: 1
  operationId: string
  inventoryRevision: number
  planning: RawRestorePlanningScope
  collection: { collectionId: string; version: number; layoutRevision: number }
  configuration: { name: string; kind: 'binder' | 'slab' | 'custom'; defaultPresentation: 'binder' | 'slabs' | 'list'; location: string | null; rows: number; cols: number }
  slots: { before: { id: string; version: number; inventoryItemId: string | null; itemVersion: number | null; placementVersion: number | null }; after: BackupArrangementCommand['slots'][number] }[]
  items: { itemId: string; itemVersion: number; placement: { collectionId: string; slot: RawRestoreCommand['slots'][number]['before'] } | null }[]
  releaseItemIds: string[]
}
const invalid = (): never => { throw new Error('Invalid or unsupported raw content restore') }
export function parseRawRestoreCommand(value: unknown): RawRestoreCommand {
  if (new TextEncoder().encode(JSON.stringify(value) ?? '').length > RAW_RESTORE_LIMITS.bytes
    || !isContractRecord(value, ['version', 'operationId', 'inventoryRevision', 'planning', 'collection', 'configuration', 'slots', 'items', 'releaseItemIds'])
    || Object.keys(value).length !== 9 || value.version !== 1 || !isSlotContractId(value.operationId) || value.operationId.length < 8 || value.operationId.length > 100
    || !isSlotRevision(value.inventoryRevision) || !isContractRecord(value.planning, ['actorUserId', 'ownerUserId', 'source', 'credentialId', 'authSessionId', 'partnerUserId', 'partnershipId'])
    || Object.keys(value.planning).length !== 7 || !isBinderId(value.planning.actorUserId) || !isBinderId(value.planning.ownerUserId)
    || !['app', 'rest', 'mcp'].includes(value.planning.source as string)
    || !(value.planning.partnerUserId === null || isBinderId(value.planning.partnerUserId) && value.planning.partnerUserId !== value.planning.ownerUserId)
    || !(value.planning.partnerUserId === null ? value.planning.partnershipId === null : isBinderId(value.planning.partnershipId))
    || (value.planning.source === 'app' ? !isSlotContractId(value.planning.authSessionId) || value.planning.credentialId !== null
      : value.planning.authSessionId !== null || !isSlotContractId(value.planning.credentialId))
    || !isContractRecord(value.collection, ['collectionId', 'version', 'layoutRevision']) || Object.keys(value.collection).length !== 3
    || !isBinderId(value.collection.collectionId) || !isSlotRevision(value.collection.version) || !isSlotRevision(value.collection.layoutRevision)
    || !isContractRecord(value.configuration, ['name', 'kind', 'defaultPresentation', 'location', 'rows', 'cols']) || Object.keys(value.configuration).length !== 6
    || typeof value.configuration.name !== 'string' || !value.configuration.name.trim() || value.configuration.name.length > 40
    || !['binder', 'slab', 'custom'].includes(value.configuration.kind as string) || !['binder', 'slabs', 'list'].includes(value.configuration.defaultPresentation as string)
    || !(value.configuration.location === null || typeof value.configuration.location === 'string' && value.configuration.location.length <= 200)
    || ![value.configuration.rows, value.configuration.cols].every(v => isSlotRevision(v) && v >= 1 && v <= 8)
    || !Array.isArray(value.slots) || !value.slots.length || value.slots.length > RAW_RESTORE_LIMITS.slots
    || !Array.isArray(value.items) || value.items.length > RAW_RESTORE_LIMITS.items
    || value.slots.length * 2 + value.items.length > RAW_RESTORE_LIMITS.work
    || !Array.isArray(value.releaseItemIds) || !value.releaseItemIds.every(isSlotContractId) || new Set(value.releaseItemIds).size !== value.releaseItemIds.length) return invalid()
  const collection = value.collection
  const refs = new Map<string, RawRestoreCommand['items'][number]>()
  // Reuse canonical item/slot-ref checks, including version/null pairing and byte bounds.
  for (const ref of value.items) {
    const parsed = parseInventoryCommand({ operationId: value.operationId, inventoryRevision: value.inventoryRevision, collections: [collection], commands: [{ kind: 'unassign', item: ref }] })
    const item = (parsed.commands[0] as { item: RawRestoreCommand['items'][number] }).item
    if (refs.has(item.itemId) || item.placement && item.placement.collectionId !== collection.collectionId) return invalid()
    refs.set(item.itemId, item)
  }
  let work = value.slots.length * 2 + value.items.length
  const beforeIds = new Set<string>(), desired = new Set<string>(), required = new Set<string>()
  for (const pair of value.slots) {
    if (!isContractRecord(pair, ['before', 'after']) || Object.keys(pair).length !== 2
      || !isContractRecord(pair.after, ['id', 'target', 'status', 'wantedCards', 'inventoryItemId', 'presetOrigin'])
      || pair.after.presetOrigin !== null || !isContractRecord(pair.before, ['id', 'version', 'inventoryItemId', 'itemVersion', 'placementVersion'])
      || pair.before.id !== pair.after.id || !isSlotContractId(pair.before.id) || beforeIds.has(pair.before.id)) return invalid()
    const parsed = parseInventoryCommand({ operationId: value.operationId, inventoryRevision: value.inventoryRevision, collections: [collection], commands: [{ kind: 'removeSlots', slots: [{ collectionId: collection.collectionId, slot: pair.before }] }] })
    if (parsed.commands[0].kind !== 'removeSlots') return invalid()
    beforeIds.add(pair.before.id)
    if (pair.before.inventoryItemId !== null) {
      const ref = refs.get(pair.before.inventoryItemId as string)
      if (!ref || backupContentKey(ref.placement) !== backupContentKey({ collectionId: collection.collectionId, slot: pair.before })) return invalid()
      required.add(ref.itemId)
    }
    if (pair.after.inventoryItemId !== null) {
      const id = pair.after.inventoryItemId as string
      if (!refs.has(id) || desired.has(id)) return invalid()
      desired.add(id); required.add(id)
    }
  }
  if (required.size !== refs.size || [...refs.values()].some(r => r.placement && !beforeIds.has(r.placement.slot.id))) return invalid()
  const releases = [...refs.values()].filter(r => r.placement && !desired.has(r.itemId)).map(r => r.itemId).sort()
  if (backupContentKey(releases) !== backupContentKey([...value.releaseItemIds].sort())) return invalid()
  const binder = normalizeBinderSnapshot({ ownerUserId: 'validation', collectionId: collection.collectionId, layoutRevision: collection.layoutRevision,
    presetManifest: null, slots: value.slots.map(p => ({ ...p.after, ownerUserId: 'validation', collectionId: collection.collectionId, version: 0 })) })
  if (!binder || binder.slots.some(s => s.wantedCards.length > 100)) return invalid()
  work += binder.slots.reduce((n, s) => n + s.wantedCards.length, 0)
  if (work > RAW_RESTORE_LIMITS.work) return invalid()
  for (const slot of binder.slots) for (const want of slot.wantedCards) if (want.card_image) {
    const url = new URL(want.card_image)
    if (url.protocol !== 'https:' || !['assets.tcgdex.net', 'assets.holofolder.com'].includes(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return invalid()
  }
  return structuredClone(value) as unknown as RawRestoreCommand
}

export const RAW_RESTORE_REJECTION_CODES = ['inventory_revision_conflict', 'raw_restore_collection_conflict', 'raw_restore_content_conflict'] as const
export interface RawRestoreRejection { outcome: 'rejected'; operationId: string; code: typeof RAW_RESTORE_REJECTION_CODES[number]; inventoryRevision: number }
/** Only a trusted original-request RPC result can supply proof; shape alone is not authentication. */
export function isRawRestoreRejection(value: unknown, operationId: string): value is RawRestoreRejection {
  return isContractRecord(value, ['outcome', 'operationId', 'code', 'inventoryRevision']) && Object.keys(value).length === 4
    && value.outcome === 'rejected' && value.operationId === operationId && typeof value.code === 'string'
    && RAW_RESTORE_REJECTION_CODES.includes(value.code as RawRestoreRejection['code']) && isSlotRevision(value.inventoryRevision)
}

export interface RawRestoreReceipt {
  changed: true; inventoryRevision: number; collectionId: string; collectionVersion: number; layoutRevision: number
  slotIds: string[]; releasedItemIds: string[]
}
/** Shared strict safe receipt shape. Original-command binding is an additional consumer check. */
export function isRawRestoreReceipt(value: unknown): value is RawRestoreReceipt {
  const fields = ['changed', 'inventoryRevision', 'collectionId', 'collectionVersion', 'layoutRevision', 'slotIds', 'releasedItemIds']
  const ids = (v: unknown, limit: number) => Array.isArray(v) && v.length <= limit && v.every(isSlotContractId) && new Set(v).size === v.length
  return isContractRecord(value, fields) && Object.keys(value).length === fields.length && value.changed === true
    && isSlotRevision(value.inventoryRevision) && isBinderId(value.collectionId) && isSlotRevision(value.collectionVersion) && isSlotRevision(value.layoutRevision)
    && ids(value.slotIds, RAW_RESTORE_LIMITS.slots) && ids(value.releasedItemIds, RAW_RESTORE_LIMITS.items)
}
