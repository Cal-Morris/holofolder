import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rawRestoreFixture } from './fixtures/raw-restore'
import { inspectRawRestore } from '@/lib/native-raw-restore'
import { planRawContentRestore } from '@/lib/raw-restore-plan'
import { isRawRestoreReceipt } from '@/lib/domain/raw-restore'
import { readRawRestoreDelivery, rawRestoreDigest } from '@/lib/collection/raw-restore-delivery'
import type { NativeBackupBinding } from '@/lib/native-backup'
import { emptyGradingRecord } from '@/lib/grading/draft'

async function setup() {
  const f = await rawRestoreFixture(true), scope = { actorUserId: f.input.evidence.actorUserId, ownerUserId: f.input.evidence.ownerUserId,
    authSessionId: f.input.evidence.authSessionId!, sessionId: 'synthetic-local-epoch' }
  const binding: NativeBackupBinding = { scope, currentScope: () => scope, available: true, revisionKey: 'synthetic', assertReady: async () => {},
    readCurrent: async () => ({ scope: { accountUserId: scope.actorUserId, ownerUserId: scope.ownerUserId, sessionId: scope.sessionId },
      evidence: { kind: 'complete', snapshot: await f.brand(f.snapshot) }, partnerUserId: f.input.evidence.partnerUserId, catalog: [], layouts: f.input.layouts }) }
  return { ...f, binding, scope }
}
test('local raw review lists exact before/after and releases, without networking or writes', async () => {
  const f = await setup(), original = JSON.stringify(f.snapshot)
  const review = await inspectRawRestore(f.binding, f.input.text, f.input.choices.collectionId, () => true)
  assert.deepEqual(review.choices.releaseItemIds, ['copy-b'])
  assert.deepEqual(review.placements, [{ itemId: 'copy-a', from: 'slot-b', to: 'slot-a' }, { itemId: 'copy-b', from: 'slot-a', to: null }])
  assert.equal(review.slots[0].before.inventoryItemId, 'copy-b'); assert.equal(review.slots[0].after.inventoryItemId, 'copy-a')
  assert.equal(JSON.stringify(f.snapshot), original)
})
test('unsupported files and stale scope cannot enter raw review', async () => {
  const f = await setup(), b = JSON.parse(f.input.text)
  for (const patch of [
    { scope: 'all-inventory' }, { layouts: [{ ...b.layouts[0], cols: 4 }] },
    { collections: [{ ...b.collections[0], name: 'Changed config' }] },
    { items: b.items.map((i: object) => ({ ...i, grading: emptyGradingRecord() })) },
    { binders: b.binders.map((v: { slots: object[] }) => ({ ...v, slots: v.slots.slice().reverse() })) },
    { binders: b.binders.map((v: object) => ({ ...v, presetManifest: null })) },
  ]) await assert.rejects(inspectRawRestore(f.binding, JSON.stringify({ ...b, ...patch }), f.input.choices.collectionId, () => true))
  await assert.rejects(inspectRawRestore(f.binding, f.input.text, f.input.choices.collectionId, () => false))
})
test('strict raw delivery binds original family/delivery/recipient/command/receipt and dedicated error', async () => {
  const f = await setup(), command = planRawContentRestore(f.input).request, delivery = 'synthetic-delivery'
  const receipt = { changed: true as const, inventoryRevision: 9, collectionId: command.collection.collectionId, collectionVersion: 3,
    layoutRevision: 3, slotIds: ['slot-a', 'slot-b'], releasedItemIds: ['copy-b'] }
  const headers = { 'cache-control': 'private, no-store', 'content-type': 'application/json', 'X-Storage-Delivery': delivery,
    'X-Storage-Family': 'backup.restore.raw', 'X-Storage-Operation': command.operationId, 'X-Request-Id': 'synthetic-request' }
  const body = { version: 1, operationId: command.operationId, receipt }
  const response = (extra = {}, status = 200) => new Response(null, { status, headers: { ...headers, ...extra } })
  assert.equal(isRawRestoreReceipt(receipt), true)
  assert.equal(isRawRestoreReceipt({ ...receipt, certificate: 'synthetic-secret' }), false)
  const proof = await readRawRestoreDelivery(response(), body, command, f.scope, delivery)
  assert.ok(proof?.receipt); assert.equal(proof.commandDigest, await rawRestoreDigest(command))
  assert.equal('sessionId' in proof.scope, false, 'device lifecycle epoch is never persisted')
  for (const extra of [{ 'X-Storage-Family': 'inventory' }, { 'X-Storage-Delivery': 'another-delivery' }, { 'X-Storage-Operation': 'another-operation' },
    { 'cache-control': 'public, max-age=3600' }, { 'content-type': 'text/html' }]) {
    assert.equal(await readRawRestoreDelivery(response(extra), body, command, f.scope, delivery), null)
  }
  for (const bad of [{ ...body, extra: true }, { ...body, operationId: 'another-operation' }, { ...body, receipt: { ...receipt, slotIds: ['slot-b', 'slot-a'] } },
    { ...body, receipt: { ...receipt, releasedItemIds: [] } }, { ...body, receipt: { ...receipt, inventoryRevision: 8 } },
    { ...body, receipt: { ...receipt, layoutRevision: 4 } }]) assert.equal(await readRawRestoreDelivery(response(), bad, command, f.scope, delivery), null)
  assert.equal(await readRawRestoreDelivery(response(), body, command, { ...f.scope, authSessionId: 'changed-session' }, delivery), null)
  const error = { error: { code: 'storage_restore_rejected', message: 'synthetic', requestId: 'synthetic-request',
    rejection: { outcome: 'rejected', operationId: command.operationId, code: 'raw_restore_content_conflict', inventoryRevision: 9 } } }
  assert.ok((await readRawRestoreDelivery(response({}, 409), error, command, f.scope, delivery))?.rejection)
  assert.equal(await readRawRestoreDelivery(response({}, 503), error, command, f.scope, delivery), null)
  assert.equal(await readRawRestoreDelivery(response({}, 409), { ...error, receipt }, command, f.scope, delivery), null)
})
