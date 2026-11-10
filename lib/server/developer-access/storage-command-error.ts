import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import { rawRestoreErrorSchema, creationErrorSchema, importErrorSchema, recoveryErrorSchema, storageCommandErrorSchema } from '@/lib/developer-api/storage'
import type { StorageCommandRejection } from '@/lib/collection/storage-command-rejection'

/** Created only from the trusted executor's validated, original-ID-bound ledger result. */
export class StorageCommandRejectedError extends DeveloperAccessError {
  readonly rejection: StorageCommandRejection
  constructor(rejection: StorageCommandRejection) {
    super('storage_command_rejected', 'The original storage command was rejected. Refresh current storage before explicit reconciliation.', 409)
    this.rejection = storageCommandErrorSchema.shape.error.shape.rejection.parse(rejection)
  }
}

export class StorageRecoveryRejectedError extends DeveloperAccessError {
  readonly rejection: import('@/lib/collection/recovery-rejection').RecoveryRejection
  constructor(rejection: import('@/lib/collection/recovery-rejection').RecoveryRejection) {
    super('storage_recovery_rejected', 'The original recovery did not commit. Read current storage before explicitly discarding or reviewing a new recovery.', 409)
    this.rejection = recoveryErrorSchema.shape.error.shape.rejection.parse(rejection)
  }
}

export class StorageCreationRejectedError extends DeveloperAccessError {
  readonly rejection: import('@/lib/collection/creation-import-rejection').CreationRejection
  constructor(rejection: import('@/lib/collection/creation-import-rejection').CreationRejection) {
    super('storage_creation_rejected', 'The original creation did not commit. Read current storage before explicit reconciliation.', 409)
    this.rejection = creationErrorSchema.shape.error.shape.rejection.parse(rejection)
  }
}
export class StorageImportRejectedError extends DeveloperAccessError {
  readonly rejection: import('@/lib/collection/creation-import-rejection').ImportRejection
  constructor(rejection: import('@/lib/collection/creation-import-rejection').ImportRejection) {
    super('storage_import_rejected', 'The original import did not commit. Read current storage before explicit reconciliation.', 409)
    this.rejection = importErrorSchema.shape.error.shape.rejection.parse(rejection)
  }
}

export class StorageRestoreRejectedError extends DeveloperAccessError {
  readonly rejection: import('@/lib/domain/raw-restore').RawRestoreRejection
  constructor(rejection: import('@/lib/domain/raw-restore').RawRestoreRejection) {
    super('storage_restore_rejected', 'The original restore did not commit. Read current storage before explicit reconciliation.', 409)
    this.rejection = rawRestoreErrorSchema.shape.error.shape.rejection.parse(rejection)
  }
}
