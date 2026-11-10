import { readReviewedRawRestoreCommand } from '@/lib/collection/raw-restore-delivery'
import { appPath } from '@/lib/app-path'
import { backupContentKey, freezeBackupPlan, parseBinderBackupV2 } from '@/lib/binder-backup-v2'
import { blankPreset } from '@/lib/binder-creation-draft'
import { readNativeBackup, type NativeBackupBinding } from '@/lib/native-backup'
import { RAW_RESTORE_LIMITS, type RawRestoreCommand } from '@/lib/domain/raw-restore'
import { sameInventoryReadScope } from '@/lib/collection/inventory-read-transport'
import { isContractRecord } from '@/lib/domain/binder-slots'
import type { SlotOfflineIntent } from '@/lib/collection/slot-optimistic'
import type { CompleteInventorySnapshot } from '@/lib/collection/slot-snapshot'

export interface NativeRawRestoreBinding {
  plan: (input: { text: string; choices: RawRestoreChoices; operationId: string }, active: () => boolean) => Promise<RawRestoreCommand>
  retain: (command: RawRestoreCommand, base: CompleteInventorySnapshot, active: () => boolean) => Promise<unknown>
}
export interface RawRestoreChoices { collectionId: string; slotIds: string[]; releaseItemIds: string[]; restoreContent: true }
/** Local eligibility and consequences only. It cannot authorize a restore or supply planning evidence. */
export async function inspectRawRestore(binding: NativeBackupBinding, text: string, collectionId: string, active: () => boolean) {
  const { read, snapshot, assertCurrent } = await readNativeBackup(binding, active)
  const backup = parseBinderBackupV2(text), source = backup.binders[0], binder = snapshot.binders.find(b => b.collectionId === collectionId)
  const config = snapshot.collections.find(c => c.id === collectionId), original = backup.collections[0]
  const fail = (): never => { throw new Error('Only one matching raw collection with the same ordered slots, configuration and grid can be reviewed.') }
  if (backup.scope !== 'collection' || backup.collections.length !== 1 || backup.binders.length !== 1 || backup.appearance.length
    || !binder || !config || original.id !== collectionId || source.collectionId !== collectionId
    || binder.slots.length > RAW_RESTORE_LIMITS.slots || backup.items.length > RAW_RESTORE_LIMITS.items
    || backupContentKey(source.slots.map(s => s.id)) !== backupContentKey(binder.slots.map(s => s.id))
    || backupContentKey(source.presetManifest) !== backupContentKey(binder.presetManifest)
    || binder.presetManifest !== null && backupContentKey(binder.presetManifest) !== backupContentKey(blankPreset())
    || [...source.slots, ...binder.slots].some(s => s.legacySource != null || s.presetOrigin !== null)
    || backup.items.some(i => i.grading !== null || i.legacySource != null)) return fail()
  const { version: _v, ...before } = original, { version: _cv, ownerUserId: _o, ...now } = config
  if (backupContentKey(before) !== backupContentKey(now)
    || !backup.layouts || backupContentKey(backup.layouts.map(({ layoutRevision: _r, ...l }) => l)) !== backupContentKey(read.layouts.filter(l => l.collectionId === collectionId).map(({ layoutRevision: _r, ...l }) => l))) return fail()
  const desiredIds = new Set(backup.placements.map(p => p.inventoryItemId))
  const involved = new Set([...desiredIds, ...snapshot.placements.filter(p => p.collectionId === collectionId).map(p => p.inventoryItemId)])
  for (const id of involved) {
    const item = snapshot.items.find(i => i.id === id), fromFile = backup.items.find(i => i.id === id), placement = snapshot.placements.find(p => p.inventoryItemId === id)
    if (!item || item.grading !== null || item.legacySource != null || placement && placement.collectionId !== collectionId
      || fromFile && (backupContentKey(fromFile.identity) !== backupContentKey(item.identity) || fromFile.acquiredAt !== item.acquiredAt)) return fail()
  }
  assertCurrent()
  return { base: snapshot, choices: { collectionId, slotIds: binder.slots.map(s => s.id), restoreContent: true as const,
    releaseItemIds: [...involved].filter(id => snapshot.placements.some(p => p.inventoryItemId === id) && !desiredIds.has(id)).sort() },
    slots: binder.slots.map((slot, n) => ({ before: slot, after: source.slots[n] })),
    placements: [...involved].map(itemId => ({ itemId, from: snapshot.placements.find(p => p.inventoryItemId === itemId)?.slotId ?? null,
      to: backup.placements.find(p => p.inventoryItemId === itemId)?.slotId ?? null })) }
}
export async function requestNativeRawRestorePlan(binding: NativeBackupBinding, input: { text: string; choices: RawRestoreChoices; operationId: string }, active: () => boolean, localHarness = false) {
  await binding.assertReady()
  const valid = () => active() && sameInventoryReadScope(binding.currentScope(), binding.scope)
  if (!valid()) throw new Error('Restore session changed.')
  const deliveryId = crypto.randomUUID()
  const response = await fetch(appPath(localHarness ? '/e2e-harness/storage/raw-restore' : '/api/raw-content-restore'), {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/json', 'X-Binder-Owner': binding.scope.ownerUserId, 'X-Binder-Actor': binding.scope.actorUserId,
      'X-Binder-Auth-Session': binding.scope.authSessionId, 'X-Storage-Operation': input.operationId, 'X-Storage-Delivery': deliveryId },
    body: JSON.stringify({ action: 'plan', ...input }),
  })
  const value: unknown = await response.json(), cache = response.headers.get('cache-control')?.split(/\s*,\s*/)
  if (!valid() || response.redirected || response.status !== 200 || response.headers.get('X-Storage-Delivery') !== deliveryId
    || response.headers.get('X-Storage-Family') !== 'backup.restore.raw' || response.headers.get('X-Storage-Operation') !== input.operationId || !cache?.includes('private') || !cache.includes('no-store')
    || !response.headers.get('content-type')?.startsWith('application/json') || !isContractRecord(value, ['version', 'operationId', 'request'])
    || Object.keys(value).length !== 3 || value.version !== 1 || value.operationId !== input.operationId) throw new Error('Restore review unavailable. Nothing has been queued or restored.')
  const command = readReviewedRawRestoreCommand(value.request)
  if (command.operationId !== input.operationId || command.collection.collectionId !== input.choices.collectionId
    || command.planning.actorUserId !== binding.scope.actorUserId || command.planning.ownerUserId !== binding.scope.ownerUserId
    || command.planning.authSessionId !== binding.scope.authSessionId || command.planning.source !== 'app'
    || backupContentKey(command.slots.map(s => s.after.id)) !== backupContentKey(input.choices.slotIds)
    || backupContentKey(command.releaseItemIds) !== backupContentKey(input.choices.releaseItemIds)) throw new Error('Restore review changed. Nothing has been queued.')
  await binding.assertReady()
  if (!valid()) throw new Error('Restore session changed.')
  return freezeBackupPlan(command)
}
export function rawRestoreIntent(command: RawRestoreCommand, deviceId: string): Extract<SlotOfflineIntent, { kind: 'raw-restore' }> {
  return { kind: 'raw-restore', request: command, context: { source: 'app', clientId: deviceId,
    operationId: command.operationId, batchId: command.operationId, clientOccurredAt: null } }
}
