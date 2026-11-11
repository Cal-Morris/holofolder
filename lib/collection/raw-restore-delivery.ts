import { backupContentKey } from '@/lib/binder-backup-v2'
import { isContractRecord, isSlotContractId } from '@/lib/domain/binder-slots'
import { parseRawRestoreCommand, isRawRestoreReceipt as isRawReceiptShape, type RawRestoreReceipt, isRawRestoreRejection, type RawRestoreCommand, type RawRestoreRejection } from '@/lib/domain/raw-restore'
import type { InventoryReadScope } from '@/lib/collection/inventory-read-transport'

export interface RawRestoreProof {
  family: 'backup.restore.raw'; deliveryId: string; operationId: string; commandDigest: string
  scope: Omit<InventoryReadScope, "sessionId">
  receipt: RawRestoreReceipt | null
  rejection: RawRestoreRejection | null
}
const reviewedCommands = new WeakSet<object>()
export const isReviewedRawRestoreCommand = (command: RawRestoreCommand) => reviewedCommands.has(command)
/** Internal authenticated planning response adapter, never used for file/cache parsing. */
export function readReviewedRawRestoreCommand(value: unknown) {
  const command = parseRawRestoreCommand(value)
  reviewedCommands.add(command)
  return command
}
const trustedDeliveries = new WeakSet<object>()
export const isTrustedRawRestoreProof = (value: RawRestoreProof) => trustedDeliveries.has(value)
export async function rawRestoreDigest(command: RawRestoreCommand) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(backupContentKey(command)))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
}
export function isRawRestoreReceipt(value: unknown, command: RawRestoreCommand): value is RawRestoreReceipt {
  return isRawReceiptShape(value) && value.version === command.version && value.inventoryRevision > command.inventoryRevision
    && value.collectionId === command.collection.collectionId && value.collectionVersion > command.collection.version
    && value.layoutRevision === command.collection.layoutRevision + (backupContentKey(command.slotOrder.before) !== backupContentKey(command.slotOrder.after) ? 1 : 0)
    && backupContentKey(value.slotIds) === backupContentKey(command.slotOrder.after)
    && (value.inventoryRevision === command.inventoryRevision + 1 && value.collectionVersion === command.collection.version + 1
      && backupContentKey(value.slotOrder) === backupContentKey(command.slotOrder))
    && backupContentKey(value.releasedItemIds) === backupContentKey(command.releaseItemIds)
}
export function validRawRestoreProof(value: unknown, command: RawRestoreCommand): value is RawRestoreProof {
  if (!isContractRecord(value, ['family', 'deliveryId', 'operationId', 'commandDigest', 'scope', 'receipt', 'rejection']) || Object.keys(value).length !== 7
    || value.family !== 'backup.restore.raw' || value.operationId !== command.operationId || !isSlotContractId(value.deliveryId)
    || typeof value.commandDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.commandDigest)
    || !isContractRecord(value.scope, ['actorUserId', 'ownerUserId', 'authSessionId']) || Object.keys(value.scope).length !== 3
    || value.scope.actorUserId !== command.planning.actorUserId || value.scope.ownerUserId !== command.planning.ownerUserId
    || value.scope.authSessionId !== command.planning.authSessionId) return false
  return value.receipt === null ? isRawRestoreRejection(value.rejection, command.operationId)
    : value.rejection === null && isRawRestoreReceipt(value.receipt, command)
}
/** Called only on the response of the same-origin original-request transport, never on file/cache data. */
export async function readRawRestoreDelivery(response: Response, body: unknown, command: RawRestoreCommand, scope: InventoryReadScope, deliveryId: string) {
  const cache = response.headers.get('cache-control')?.split(/\s*,\s*/)
  if (!cache?.includes('private') || !cache.includes('no-store') || !response.headers.get('content-type')?.startsWith('application/json')
    || response.redirected || response.headers.get('X-Storage-Delivery') !== deliveryId || response.headers.get('X-Storage-Family') !== 'backup.restore.raw'
    || response.headers.get('X-Storage-Operation') !== command.operationId) return null
  let receipt: RawRestoreReceipt | null = null, rejection: RawRestoreRejection | null = null
  if (response.status === 200 && isContractRecord(body, ['version', 'operationId', 'receipt']) && Object.keys(body).length === 3
    && body.version === 1 && body.operationId === command.operationId && isRawRestoreReceipt(body.receipt, command)) receipt = body.receipt
  else if (response.status === 409 && isContractRecord(body, ['error']) && Object.keys(body).length === 1
    && isContractRecord(body.error, ['code', 'message', 'requestId', 'rejection']) && Object.keys(body.error).length === 4
    && body.error.code === 'storage_restore_rejected' && typeof body.error.message === 'string'
    && isSlotContractId(body.error.requestId) && body.error.requestId === response.headers.get('X-Request-Id')
    && isRawRestoreRejection(body.error.rejection, command.operationId)) rejection = body.error.rejection
  if (!receipt && !rejection) return null
  const proof: RawRestoreProof = { family: 'backup.restore.raw', deliveryId, operationId: command.operationId,
    commandDigest: await rawRestoreDigest(command), scope: { actorUserId: scope.actorUserId, ownerUserId: scope.ownerUserId, authSessionId: scope.authSessionId }, receipt, rejection }
  if (!validRawRestoreProof(proof, command)) return null
  trustedDeliveries.add(proof)
  return proof
}
