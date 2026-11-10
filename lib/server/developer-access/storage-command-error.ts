import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import { storageCommandErrorSchema } from '@/lib/developer-api/storage'
import type { StorageCommandRejection } from '@/lib/collection/storage-command-rejection'

/** Created only from the trusted executor's validated, original-ID-bound ledger result. */
export class StorageCommandRejectedError extends DeveloperAccessError {
  readonly rejection: StorageCommandRejection
  constructor(rejection: StorageCommandRejection) {
    super('storage_command_rejected', 'The original storage command was rejected. Refresh current storage before explicit reconciliation.', 409)
    this.rejection = storageCommandErrorSchema.shape.error.shape.rejection.parse(rejection)
  }
}
