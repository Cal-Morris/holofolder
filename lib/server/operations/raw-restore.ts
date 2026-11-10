import { resolveCollectionMembership } from '@/lib/server/collection-owner'
import 'server-only'
import { backupContentKey } from '@/lib/binder-backup-v2'
import { planRawContentRestore, type RawContentRestorePlan } from '@/lib/raw-restore-plan'
import { readOwnerInventoryState } from '@/lib/server/inventory-read'
import { requireDeveloperSettingsUser } from '@/lib/server/developer-access/first-party'
import { requireExpectedAppearanceOwner } from '@/lib/server/binder-appearance'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import { executeAppStorageRequest } from './storage-execution'

/** Internal first confirmation only. Evidence is read through authenticated RLS, never file/DTO/cache.
 * The selected collection/slot IDs are explicit current-state choices, not historical provenance.
 */
export async function prepareAppRawContentRestore(request: Request, input: Pick<Parameters<typeof planRawContentRestore>[0], 'text' | 'choices' | 'operationId' | 'savedEntryRemaining'>) {
  const { client } = await requireDeveloperSettingsUser(request, true)
  const read = await readOwnerInventoryState(client)
  requireExpectedAppearanceOwner(request, read.snapshot.ownerUserId)
  if (request.headers.get('X-Binder-Auth-Session') !== read.authSessionId) throw new DeveloperAccessError('storage_session_changed', 'Review restore in the current session.', 403)
  const membership = await resolveCollectionMembership(client, read.actorUserId)
  if (membership.ownerUserId !== read.snapshot.ownerUserId || (membership.memberIds.find(id => id !== read.snapshot.ownerUserId) ?? null) !== read.partnerUserId) {
    throw new DeveloperAccessError('storage_conflict', 'Collection membership changed. Review restore again.', 409)
  }
  const scope = { actorUserId: read.actorUserId, ownerUserId: read.snapshot.ownerUserId, source: 'app' as const, credentialId: null,
    authSessionId: read.authSessionId, partnershipId: membership.partnershipId, partnerUserId: read.partnerUserId }
  return planRawContentRestore({ ...input, current: read.snapshot, layouts: read.navigation.layouts, evidence: scope, currentScope: scope })
}

/** Retained original request delivery. Do not reconstruct after unknown outcomes, accepted/rejected
 * replay must reach SQL before mutable reads. A receipt is historical, never an offline read ACK.
 */
export function deliverAppRawContentRestore(request: Request, plan: RawContentRestorePlan) {
  requireExpectedAppearanceOwner(request, plan.scope.ownerUserId)
  return executeAppStorageRequest(new Request(request, { method: 'POST', body: JSON.stringify(plan.request) }), 'backup.restore.raw')
}
export async function confirmAppRawContentRestore(request: Request, plan: RawContentRestorePlan) {
  const { client } = await requireDeveloperSettingsUser(request, true)
  const read = await readOwnerInventoryState(client)
  const membership = await resolveCollectionMembership(client, read.actorUserId)
  if (membership.partnershipId !== plan.scope.partnershipId || backupContentKey(read.snapshot) !== plan.precondition || read.actorUserId !== plan.scope.actorUserId || read.authSessionId !== plan.scope.authSessionId
    || read.snapshot.ownerUserId !== plan.scope.ownerUserId || read.partnerUserId !== plan.scope.partnerUserId) {
    throw new DeveloperAccessError('storage_conflict', 'Restore preview changed. Review the complete current collection again.', 409)
  }
  return deliverAppRawContentRestore(request, plan)
}
