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
  const client = { auth: { getClaims: async () => ({ data: { claims: { sub: scope.actorUserId, role: 'authenticated', session_id: session } } }) },
    // Synthetic inventory_read_scope_v2 for the live session.
    rpc: () => ({ abortSignal: async () => ({ data: { actor: scope.actorUserId, owner: scope.ownerUserId, session_id: session, partner_paused: false }, error: null }) }) }
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => client }))
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
    if (terminal) return Response.json({ version: 2, outcome: 'rejected', operationId: f.input.operationId, inventoryRevision: 10, code: 'inventory_revision_conflict' })
    return Response.json({ version: 2, changed: true, inventoryRevision: 9, collectionId: f.input.choices.collectionId, collectionVersion: 3, layoutRevision: 3,
      slotIds: f.input.choices.slotIds, releasedItemIds: ['copy-b'] })
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
  // The paid/unlimited hint must admit a bounded 1,025-want increase, not impose a separate 1,024 cap.
  mock.module('../../lib/server/billing', () => ({ getBillingAccess: async () => ({ enforced: true, tier: 'paid', savedCardCount: 0, cardLimit: null }) }))
  const { createBinderBackupV2 } = await import('@/lib/binder-backup-v2')
  const large = structuredClone(f.snapshot)
  large.items = []; large.placements = []
  large.binders[0].slots = Array.from({ length: 1025 }, (_, n) => ({ ...large.binders[0].slots[0], id: 'synthetic-paid-' + n, inventoryItemId: null, status: null, wantedCards: [] }))
  current = await f.brand(large)
  const desired = structuredClone(large)
  for (const slot of desired.binders[0].slots) slot.wantedCards = [{ card_id: 'synthetic-raw-trainer', card_name: 'Synthetic paid want', added_at: '2020-01-01', wanted_by: [scope.actorUserId] }]
  const backup = createBinderBackupV2({ snapshot: desired, completeness: 'complete-owner', scope: 'collection', collectionId: f.input.choices.collectionId, layouts: f.input.layouts, partnerUserId: scope.actorUserId })
  const paidPlan = await prepareAppRawContentRestore(request(), { text: JSON.stringify(backup), operationId: 'synthetic-paid-1025-wants',
    choices: { ...f.input.choices, slotIds: large.binders[0].slots.map(s => s.id), releaseItemIds: [] } })
  assert.equal(paidPlan.request.slots.reduce((n, s) => n + s.after.wantedCards.length, 0), 1025)

  // Actual streaming HTTP reader and shared REST/MCP schema enforce command and wrapper bytes.
  const { readDeveloperJson } = await import('@/lib/server/developer-access/request')
  const { RAW_RESTORE_V2_LIMITS: limits, rawRestoreV2JsonbBytes } = await import('@/lib/domain/raw-restore')
  const { rawRestoreSchema } = await import('@/lib/developer-api/storage')
  const boundary = structuredClone(plan.request)
  boundary.slots[1].after.wantedCards = [{ card_id: 'synthetic-raw-trainer', card_name: '', added_at: '2020-01-01' }]
  const extra = limits.bytes - rawRestoreV2JsonbBytes(boundary)
  boundary.slots[1].after.wantedCards[0].card_name = '猫'.repeat(Math.floor(extra / 3)) + 'a'.repeat(extra % 3)
  const body = JSON.stringify(boundary)
  const http = (body: string) => new Request('https://holofolder.com/app/api/internal-not-admitted', { method: 'POST', body })
  assert.deepEqual(rawRestoreSchema.parse(await readDeveloperJson(http(body), limits.bytes)), boundary)
  const whitespace = ' '.repeat(limits.bytes - Buffer.byteLength(body))
  await readDeveloperJson(http(body + whitespace), limits.bytes)
  await assert.rejects(readDeveloperJson(http(body + whitespace + ' '), limits.bytes), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'body_too_large' && !('rejection' in e))
  const wrapper = JSON.stringify({ action: 'plan', text: body, choices: f.input.choices, operationId: boundary.operationId })
  assert.ok(Buffer.byteLength(wrapper) < 12582912)
  await readDeveloperJson(http(wrapper), 12582912)
  await assert.rejects(readDeveloperJson(http(JSON.stringify({ action: 'plan', text: 'x'.repeat(12582912) })), 12582912))
  const { storageExecutionError } = await import('@/lib/server/operations/storage-contract')
  const sizeError = storageExecutionError({ code: '22023', message: 'raw_restore_recovery_envelope_exceeded' })
  assert.equal(sizeError.code, 'invalid_input'); assert.match(sizeError.message, /2.5 MiB/); assert.equal('rejection' in sizeError, false)

}
main().catch(error => { console.error(error); process.exitCode = 1 })
