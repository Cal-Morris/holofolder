import type { OperationContext } from '@/lib/developer-api/types'
import { DeveloperAccessError, requirePermissions } from '@/lib/developer-api/permissions'
import { NATIVE_DEVELOPER_OPERATIONS } from '@/lib/developer-api/storage'
import { requireNativeDeveloperAdmission } from './native-developer-admission'
import { executeDeveloperStorageOperation } from './storage-execution'
import type { StorageOperation } from './storage-contract'

const storageOperations: Readonly<Record<string, StorageOperation>> = {
  import_storage_arrangement: 'backup.arrangement',
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
  return executeDeveloperStorageOperation(context, storageOperations[name], parsed.data)
}
