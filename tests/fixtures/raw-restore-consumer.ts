import assert from 'node:assert/strict'
import { rawRestoreFixture } from './raw-restore'

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role'
  // @ts-expect-error Isolated Bun mocks, never production authentication or admission.
  const { mock } = await import('bun:test')
  mock.module('server-only', () => ({}))
  const f = await rawRestoreFixture(), scope = f.input.evidence
  let session = scope.authSessionId, current = f.input.current, unknown = true, terminal = false, errorCode: string | null = null
  const client = { auth: { getClaims: async () => ({ data: { claims: { sub: scope.actorUserId, role: 'authenticated', session_id: session } } }) } }
  mock.module('../../lib/server/developer-access/first-party', () => ({ requireDeveloperSettingsUser: async () => ({ user: { id: scope.actorUserId }, client }) }))
  mock.module('../../lib/server/inventory-read', () => ({ readOwnerInventoryState: async () => ({ snapshot: current, actorUserId: scope.actorUserId,
    authSessionId: session, partnerUserId: scope.partnerUserId, navigation: { layouts: f.input.layouts } }) }))
  mock.module('../../lib/server/collection-owner', () => ({ resolveCollectionOwnerUserId: async () => scope.ownerUserId, resolveCollectionMembership: async () => ({ ownerUserId: scope.ownerUserId,
    memberIds: [scope.ownerUserId, scope.actorUserId], partnershipId: scope.partnershipId }) }))
  const calls: unknown[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    assert.equal(url.hostname, 'synthetic.supabase.test'); assert.ok(url.pathname.endsWith('/storage_execute_v1'))
    const body = JSON.parse(String(init?.body)), header = JSON.parse(new Headers(init?.headers).get('x-holo-audit-context')!)
    assert.equal(body.operation, 'backup.restore.raw'); assert.equal(body.owner_id, scope.ownerUserId)
    assert.equal(header.actor.userId, scope.actorUserId); assert.equal(header.source, 'app'); assert.equal(header.operationId, f.input.operationId)
    calls.push(body)
    if (unknown) throw new DOMException('Synthetic lost COMMIT reply', 'AbortError')
    if (errorCode) return Response.json({ code: errorCode, message: 'synthetic private SQL' }, { status: 400 })
    if (terminal) return Response.json({ outcome: 'rejected', operationId: f.input.operationId, inventoryRevision: 10, code: 'inventory_revision_conflict' })
    return Response.json({ changed: true, inventoryRevision: 9, collectionId: f.input.choices.collectionId, collectionVersion: 3, layoutRevision: 3,
      slotIds: f.input.choices.slotIds, releasedItemIds: ['copy-b'], certificate: 'synthetic-private' })
  }
  const { prepareAppRawContentRestore, confirmAppRawContentRestore, deliverAppRawContentRestore } = await import('../../lib/server/operations/raw-restore')
  const request = (authSession = scope.authSessionId!) => new Request('https://holofolder.com/app/api/internal-not-admitted', {
    method: 'POST', headers: { Origin: 'https://holofolder.com', 'X-Binder-Owner': scope.ownerUserId, 'X-Binder-Auth-Session': authSession } })
  const plan = await prepareAppRawContentRestore(request(), f.input)
  const originalRows = f.input.layouts[0].rows
  f.input.layouts[0].rows = 4
  await assert.rejects(confirmAppRawContentRestore(request(), plan), /preview changed/)
  assert.equal(calls.length, 0, 'grid-only change must refuse before initial delivery')
  f.input.layouts[0].rows = originalRows
  await assert.rejects(confirmAppRawContentRestore(request(), plan))
  assert.equal(calls.length, 1)
  current = await f.brand({ ...f.snapshot, inventoryRevision: 10 })
  await assert.rejects(confirmAppRawContentRestore(request(), plan))
  unknown = false
  const receipt = await deliverAppRawContentRestore(request(), plan)
  assert.equal('certificate' in receipt, false); assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1], 'unknown retry forwards the original intent before mutable reconstruction')
  session = 'changed-session'
  await assert.rejects(deliverAppRawContentRestore(request(), plan)); assert.equal(calls.length, 2)
  session = scope.authSessionId
  terminal = true
  const proof = await deliverAppRawContentRestore(request(), plan)
  assert.equal(proof.outcome, 'rejected'); assert.equal(proof.operationId, plan.request.operationId)
  for (const code of ['40001', '57014', '23514', 'XX000']) {
    errorCode = code
    await assert.rejects(deliverAppRawContentRestore(request(), plan), (e: unknown) => !!e && typeof e === 'object' && !('rejection' in e))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
