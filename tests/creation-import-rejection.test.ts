import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CREATION_REJECTION_CODES, IMPORT_REJECTION_CODES, isCreationRejection, isImportRejection } from '@/lib/collection/creation-import-rejection'
import { creationErrorSchema, importErrorSchema } from '@/lib/developer-api/storage'
import { storageExecutionError } from '@/lib/server/operations/storage-contract'

test('093 proof is strict, original-ID and family bound, never error classification', () => {
  for (const [guard, codes, schema, message, code] of [
    [isCreationRejection, CREATION_REJECTION_CODES, creationErrorSchema, 'The original creation did not commit. Read current storage before explicit reconciliation.', 'storage_creation_rejected'],
    [isImportRejection, IMPORT_REJECTION_CODES, importErrorSchema, 'The original import did not commit. Read current storage before explicit reconciliation.', 'storage_import_rejected'],
  ] as const) for (const reason of codes) {
    const proof = { outcome: 'rejected', operationId: 'synthetic-original', code: reason, inventoryRevision: 0 }
    assert.ok(guard(proof, proof.operationId))
    assert.ok(schema.safeParse({ error: { code, message, requestId: 'synthetic', rejection: proof } }).success)
    for (const invalid of [null, [], { ...proof, operationId: 'synthetic-other' }, { ...proof, code: '40001' }, { ...proof, code: 'arbitrary' },
      { ...proof, inventoryRevision: -1 }, { ...proof, inventoryRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...proof, inventoryRevision: '0' },
      { ...proof, evidence: {} }, { ...proof, ownerUserId: 'private' }, { ...proof, outcome: 'accepted' }]) assert.equal(guard(invalid, proof.operationId), false)
    for (const sqlstate of ['40001', '23505', '57014', 'HF931', 'HF402']) {
      const error = storageExecutionError({ code: sqlstate, message: reason })
      assert.equal('rejection' in error, false)
    }
  }
  assert.equal(isCreationRejection({ outcome: 'rejected', operationId: 'synthetic-original', code: 'import_copy_conflict', inventoryRevision: 0 }, 'synthetic-original'), false)
  assert.equal(isImportRejection({ outcome: 'rejected', operationId: 'synthetic-original', code: 'creation_identity_conflict', inventoryRevision: 0 }, 'synthetic-original'), false)
})
