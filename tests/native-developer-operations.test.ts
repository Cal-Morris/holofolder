import { z } from 'zod'
import { storageCommandErrorSchema, storageRejectionSchema } from '@/lib/developer-api/storage'
import { STORAGE_REJECTION_CODES } from '@/lib/collection/storage-command-rejection'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { DEVELOPER_OPERATIONS, matchRestOperation } from '@/lib/developer-api/operations'
import spec from '@/public/openapi.json'
import { formatEndpointMarkdown } from '@/lib/docs-markdown'

const command = { operationId: 'synthetic-native-operation', inventoryRevision: 0, collectionVersion: 0,
  layoutRevision: 0, collectionId: '00830000-0000-4000-8000-000000000011',
  commands: [{ kind: 'create', ids: ['synthetic-slot'], beforeSlotId: null }] }
test('native slot contract is registered once and rejects missing revisions and forged authority', () => {
  const operation = matchRestOperation('POST', '/storage/slots/commands')?.operation
  assert.equal(operation?.name, 'execute_slot_commands')
  assert.deepEqual(operation.permissions, ['collection:write', 'binders:write'])
  assert.equal(operation.schema.safeParse(command).success, true)
  for (const change of [{ inventoryRevision: undefined }, { layoutRevision: -1 }, { ownerId: 'forged' },
    { commands: [{ kind: 'create', ids: ['same', 'same'], beforeSlotId: null }] }, { cursor: 'partial' }]) {
    assert.equal(operation.schema.safeParse({ ...command, ...change }).success, false)
  }
  assert.equal(DEVELOPER_OPERATIONS.find(op => op.name === 'apply_collection_recovery')?.path, '/collection/recovery/apply')
})
test('native registry executes real REST/MCP transports and the trusted bridge with synthetic dependencies', () => {
  execFileSync(process.execPath, [new URL('./fixtures/native-developer-round-trips.ts', import.meta.url).pathname], { stdio: 'pipe' })
})

test('native recovery versions, replacement scope and immutable creation IDs are strict', () => {
  const schema = (name: string) => DEVELOPER_OPERATIONS.find(op => op.name === name)!.schema
  const collectionId = command.collectionId
  const replacement = { eventId: '12', restoreUnassignedItemIds: [], planVersion: 2, replacementDefaultCollectionId: collectionId,
    inventoryRevision: 1, collections: [{ collectionId, version: 0, layoutRevision: 0 }] }
  assert.equal(schema('preview_storage_recovery_v2').safeParse(replacement).success, true)
  assert.equal(schema('preview_storage_recovery').safeParse(replacement).success, false)
  for (const change of [{ planVersion: 1 }, { collections: [] }, { restoreUnassignedItemIds: ['synthetic-copy'] },
    { replacementDefaultCollectionId: '00830000-0000-4000-8000-000000000012' }, { inventoryRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(schema('preview_storage_recovery_v2').safeParse({ ...replacement, ...change }).success, false)
  }
  const creation = { version: 1, operationId: 'synthetic-creation-ids', inventoryRevision: 0, collectionId, name: 'Synthetic', kind: 'binder',
    defaultPresentation: 'binder', location: null, grid: null,
    manifest: { source: { id: 'synthetic-source', version: '1' }, name: 'Synthetic', entries: [{ id: 'entry', target: null }] }, slotIds: ['synthetic-slot'] }
  assert.equal(schema('create_storage_collection').safeParse(creation).success, true)
  for (const change of [{ slotIds: [] }, { version: 2 }, { ownerUserId: collectionId }, { name: ' needs normalization ' }, { defaultPresentation: 'slabs' }]) {
    assert.equal(schema('create_storage_collection').safeParse({ ...creation, ...change }).success, false)
  }
  // Reads have their own authenticated adapter; no legacy read alias is substituted.
  for (const path of ['/storage/inventory', '/storage/slots']) assert.equal(matchRestOperation('GET', path), null)
  assert.equal(matchRestOperation('GET', '/storage/collections')?.operation.admission, undefined)
})

test('generated native references and agent Markdown preserve admission, scopes and actual receipt schemas', () => {
  const paths = spec.paths as Record<string, Record<string, { 'x-admission'?: string; responses: Record<string, { description: string; content?: unknown }> }>>
  for (const op of DEVELOPER_OPERATIONS.filter(op => op.responseSchema)) {
    const documented = paths[op.path][op.method.toLowerCase()]
    assert.equal(documented['x-admission'], undefined)
    assert.doesNotMatch(documented.responses['503'].description, /native_operations_staged/)
    assert.equal(documented.responses['200'].description, 'Success')
    assert.ok(documented.responses['200'].content)
    assert.ok(documented.responses['403'].content)
    assert.equal(op.idempotent, true)
    const markdown = formatEndpointMarkdown({ title: op.name, url: '/docs/reference/collection/' + op.name.replaceAll('_', '-'), method: op.method, path: op.path, operation: documented })
    assert.doesNotMatch(markdown, /"x-admission": "staged"/)
    assert.doesNotMatch(markdown, /native_operations_staged/)
  }
})

test('real MCP SDK enforces accepted output schemas and preserves typed tool errors', () => {
  execFileSync(process.execPath, [new URL('./fixtures/native-output-schema.ts', import.meta.url).pathname], { stdio: 'pipe' })
})

test('terminal errors are strict, bounded and declared only on command and native recovery apply operations', () => {
  const proof = { outcome: 'rejected', operationId: command.operationId, code: 'slot_revision_conflict', inventoryRevision: 12 }
  for (const code of STORAGE_REJECTION_CODES) assert.equal(storageRejectionSchema.safeParse({ ...proof, code }).success, true)
  for (const change of [{ operationId: '' }, { code: 'unknown' }, { inventoryRevision: -1 }, { inventoryRevision: 1.5 },
    { inventoryRevision: Number.MAX_SAFE_INTEGER + 1 }, { payload: command }, { outcome: 'accepted' }]) {
    assert.equal(storageRejectionSchema.safeParse({ ...proof, ...change }).success, false)
  }
  const value = { error: { code: 'storage_command_rejected', message: 'The original storage command was rejected. Refresh current storage before explicit reconciliation.', requestId: 'synthetic', rejection: proof } }
  assert.equal(storageCommandErrorSchema.safeParse(value).success, true)
  assert.equal(storageCommandErrorSchema.safeParse({ ...value, private: true }).success, false)
  for (const op of DEVELOPER_OPERATIONS) {
    const terminal = ['execute_slot_commands', 'execute_inventory_commands', 'apply_storage_recovery', 'apply_storage_recovery_v2', 'create_storage_collection', 'import_storage_arrangement', 'restore_raw_collection_content'].includes(op.name)
    assert.equal(Boolean(op.errorSchemas?.[409]), terminal)
    if (!terminal) continue
    const documented = spec.paths[op.path as keyof typeof spec.paths] as unknown as Record<string, { responses: Record<string, { content: { 'application/json': { schema: unknown } } }> }>
    assert.deepEqual(documented.post.responses['409'].content['application/json'].schema, z.toJSONSchema(op.errorSchemas![409]!))
    const markdown = formatEndpointMarkdown({ title: op.name, url: '/docs/reference/collection/' + op.name.replaceAll('_', '-'), method: op.method, path: op.path, operation: documented.post })
    assert.match(markdown, op.name.startsWith('apply_storage_recovery') ? /storage_recovery_rejected/ : op.name === 'create_storage_collection' ? /storage_creation_rejected/ : op.name === 'restore_raw_collection_content' ? /storage_restore_rejected/ : op.name === 'import_storage_arrangement' ? /storage_import_rejected/ : /storage_command_rejected/)
    assert.match(markdown, /holofolder.com\/errorSchemas/)
    assert.match(markdown, /inventoryRevision/)
  }
})
