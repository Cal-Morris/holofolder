import 'server-only'
import type { BackupImportPreview } from '@/lib/binder-backup-preview'
import { assertBackupPreviewCurrent } from '@/lib/binder-backup-preview'
import type { InventorySnapshot } from '@/lib/domain/inventory'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import { requireExpectedAppearanceOwner } from '@/lib/server/binder-appearance'
import { executeAppStorageRequest } from './storage-execution'

/** Internal consumer only. No public admission or offline ACK. Retain preview unchanged after unknown outcome.
 * current is a fresh complete trusted server snapshot, never a deserialized backup or client cache.
 * SQL rechecks membership, allowance and every relevant revision at the actual transaction boundary.
 */
export async function applyAppBackupImportPreview(request: Request, preview: BackupImportPreview, current: InventorySnapshot) {
  requireExpectedAppearanceOwner(request, preview.proposed.ownerUserId)
  if (current.ownerUserId !== preview.proposed.ownerUserId) throw new DeveloperAccessError('storage_access_denied', 'The original import recipient changed.', 403)
  if (preview.execution.kind === 'blocked') throw new DeveloperAccessError('import_unsupported', 'This restore mode cannot be applied atomically.', 409)
  // Exact delivery retries must reach SQL's permanent ledger before checking stale snapshot evidence.
  // New confirmations use confirmAppBackupImportPreview below; retry callers retain the accepted request.
  if (preview.execution.kind === 'noop') {
    assertBackupPreviewCurrent(preview, current)
    throw new DeveloperAccessError('import_noop', 'No changes to apply.', 409)
  }
  const input = preview.execution.request
  const retained = new Request(request, { body: JSON.stringify(input), method: 'POST' })
  return executeAppStorageRequest(retained, preview.execution.kind === 'arrangement-command' ? 'backup.arrangement' : 'inventory')
}

export async function confirmAppBackupImportPreview(request: Request, preview: BackupImportPreview, current: InventorySnapshot) {
  assertBackupPreviewCurrent(preview, current)
  return applyAppBackupImportPreview(request, preview, current)
}
