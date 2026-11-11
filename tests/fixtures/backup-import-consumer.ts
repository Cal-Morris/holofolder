import assert from 'node:assert/strict'
import { arrangementFixture } from './backup-arrangement'
import { previewBinderBackupImport } from '../../lib/binder-backup-preview'

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role'
  // @ts-expect-error Bun mocks stay in this isolated subprocess.
  const { mock } = await import('bun:test')
  mock.module('server-only', () => ({}))
  const actor = '00880000-0000-4000-8000-000000000002', owner = '00880000-0000-4000-8000-000000000001'
  let signedIn = true, unknown = true
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => ({ auth: {
    getClaims: async () => ({ data: { claims: { sub: actor, role: 'authenticated', session_id: 'synthetic-import-session' } } }), getUser: async () => ({ data: { user: signedIn ? { id: actor } : null } }),
  }, rpc: () => ({ abortSignal: async () => signedIn // Synthetic inventory_read_scope_v2: live session, then the shared owner.
    ? { data: { actor, owner, session_id: 'synthetic-import-session', partner_paused: false }, error: null }
    : { data: null, error: { code: '42501', message: 'inventory_sign_in_required' } } }) }) }))
  const options = arrangementFixture()
  options.current.ownerUserId = owner
  options.current.collections.forEach(c => { c.ownerUserId = owner })
  options.current.binders.forEach(b => { b.ownerUserId = owner; b.slots.forEach(s => { s.ownerUserId = owner }) })
  options.current.items.forEach(i => { i.ownerUserId = owner })
  const preview = previewBinderBackupImport(options)
  assert.equal(preview.execution.kind, 'arrangement-command')
  if (preview.execution.kind !== 'arrangement-command') assert.fail()
  const calls: unknown[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    assert.equal(url.hostname, 'synthetic.supabase.test')
    if (url.pathname.endsWith('/partnerships')) return Response.json({ owner_user_id: owner, user1_id: owner, user2_id: actor })
    if (url.pathname.endsWith('/billing_partner_allowed')) return Response.json(true)
    assert.ok(url.pathname.endsWith('/storage_execute_v1'))
    const body = JSON.parse(String(init?.body)), header = JSON.parse(new Headers(init?.headers).get('x-holo-audit-context')!)
    assert.equal(body.owner_id, owner); assert.equal(body.operation, 'backup.arrangement')
    assert.deepEqual(body.request, preview.execution.kind === 'arrangement-command' ? preview.execution.request : null)
    assert.deepEqual(header.actor, { kind: 'user', userId: actor }); assert.equal(header.source, 'app')
    assert.equal(header.operationId, preview.operationId); assert.ok(init?.signal instanceof AbortSignal)
    calls.push(body)
    if (unknown) throw new DOMException('Synthetic lost outcome', 'AbortError')
    return Response.json({ inventoryRevision: 9, collectionId: options.destinationCollectionId, collectionVersion: 3, layoutRevision: 4, changed: true,
      slotIds: preview.proposed.binders[0].slots.map(s => s.id), addedItemIds: preview.proposed.items.map(i => i.id), removedEmptySlotIds: [], certificate: 'private' })
  }
  const { confirmAppBackupImportPreview, applyAppBackupImportPreview } = await import('../../lib/server/operations/backup-import')
  const request = (expected = owner) => new Request('https://holofolder.com/app/api/internal-not-admitted', { method: 'POST', headers: { Origin: 'https://holofolder.com', 'X-Binder-Owner': expected, 'X-Binder-Auth-Session': 'synthetic-import-session' } })
  const unbound = request(); unbound.headers.delete('X-Binder-Auth-Session')
  await assert.rejects(confirmAppBackupImportPreview(unbound, preview, options.current))
  assert.equal(calls.length, 0, 'missing session must not execute an import')
  await assert.rejects(confirmAppBackupImportPreview(request(), preview, options.current))
  assert.equal(calls.length, 1)
  unknown = false
  const changed = structuredClone(options.current); changed.inventoryRevision++
  await assert.rejects(confirmAppBackupImportPreview(request(), preview, changed), /stale/)
  const result = await applyAppBackupImportPreview(request(), preview, changed)
  assert.equal('certificate' in result, false); assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1], 'unknown-outcome retry retains original IDs, operation and preconditions')
  await assert.rejects(applyAppBackupImportPreview(request(), preview, { ...changed, ownerUserId: actor })); assert.equal(calls.length, 2)
  signedIn = false
  await assert.rejects(applyAppBackupImportPreview(request(), preview, changed)); assert.equal(calls.length, 2)
  signedIn = true
  await assert.rejects(applyAppBackupImportPreview(request(actor), preview, changed)); assert.equal(calls.length, 2)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
