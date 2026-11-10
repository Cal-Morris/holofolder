import type { OperationContext } from '@/lib/developer-api/types'
import { DeveloperAccessError, requirePermissions } from '@/lib/developer-api/permissions'
import { NATIVE_DEVELOPER_OPERATIONS, nativeCommandIntent } from '@/lib/developer-api/storage'
import { requireNativeDeveloperAdmission } from './native-developer-admission'
import { executeDeveloperStorageOperation } from './storage-execution'
import type { StorageOperation } from './storage-contract'

const storageOperations: Readonly<Record<string, StorageOperation>> = {
  execute_slot_commands: 'slots', execute_inventory_commands: 'inventory', create_storage_collection: 'collection.create',
  preview_storage_recovery: 'recovery.preview', apply_storage_recovery: 'recovery.apply',
  preview_storage_recovery_v2: 'recovery.preview.v2', apply_storage_recovery_v2: 'recovery.apply.v2',
}

/** Called only with the authenticated dispatcher context, never with HTTP/queue authority. */
export async function executeNativeDeveloperOperation(context: OperationContext, name: string, input: unknown) {
  const operation = NATIVE_DEVELOPER_OPERATIONS.find(op => op.name === name)
  if (!operation) throw new DeveloperAccessError('not_found', 'Native operation not found.', 404)
  requirePermissions(context.principal.permissions, operation.permissions)
  const parsed = operation.schema.safeParse(input)
  if (!parsed.success) throw new DeveloperAccessError('invalid_input', 'Invalid or oversized native storage request.', 400)
  requireNativeDeveloperAdmission()
  if ('expectedOwnerUserId' in parsed.data && parsed.data.expectedOwnerUserId !== undefined
    && parsed.data.expectedOwnerUserId !== context.ownerUserId) {
    throw new DeveloperAccessError('storage_owner_changed', 'The original collection owner is no longer the current scope. Keep the original operation for reconciliation.', 409)
  }
  const intent = name === 'execute_slot_commands' || name === 'execute_inventory_commands'
    ? nativeCommandIntent(parsed.data) : parsed.data
  return executeDeveloperStorageOperation(context, storageOperations[name], intent)
}
