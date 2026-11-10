import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acknowledgedActivityOperations, operationActivityMatch } from '../lib/acknowledged-activity'
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue'
import type { ActivityEvent } from '../lib/collection-activity'

const scope = { accountId: 'synthetic-actor', ownerUserId: 'synthetic-owner', deviceId: 'synthetic-device', workspaceId: 'holofolder' }
const event = (id: string, operation_id = 'synthetic-op'): ActivityEvent => ({ id, operation_id, recorded_at: '2026-11-10T12:00:00Z', format_version: 1, actor_kind: 'user', source: 'app', action: 'inventory.removeSlots', affected_entities: {}, changes: [] })
test('only separately acknowledged native commands in the original queue scope offer history', () => {
  const receipts = ['acknowledged', 'cancelled', 'superseded'].map((outcome, i) => ({ outcome, operationId: `synthetic-${i}`, intent: { kind: 'inventory', request: { operationId: `synthetic-${i}` } } }))
  const record = { scope, receipts } as SlotOfflineRecord
  assert.deepEqual(acknowledgedActivityOperations(record, scope), ['synthetic-0'])
  for (const key of ['accountId', 'ownerUserId', 'deviceId', 'workspaceId']) assert.deepEqual(acknowledgedActivityOperations(record, { ...scope, [key]: 'changed' }), [])
  assert.deepEqual(acknowledgedActivityOperations(null, scope), [])
  assert.deepEqual(acknowledgedActivityOperations({ ...record, receipts: [{ ...record.receipts[0], operationId: 'wrong' }] }, scope), [])
  assert.deepEqual(acknowledgedActivityOperations({ ...record, receipts: [{ ...record.receipts[0], intent: { kind: 'creation' } as never }] }, scope), [])
})
test('an operation link never guesses a missing, mismatched, duplicate or paginated event', () => {
  assert.equal(operationActivityMatch({ data: [], nextCursor: null }, 'synthetic-op'), 'unavailable')
  assert.equal(operationActivityMatch({ data: [event('1')], nextCursor: null }, 'synthetic-op'), 'single')
  assert.equal(operationActivityMatch({ data: [event('1'), event('2')], nextCursor: null }, 'synthetic-op'), 'multiple')
  assert.equal(operationActivityMatch({ data: [event('1')], nextCursor: 'older' }, 'synthetic-op'), 'multiple')
  assert.equal(operationActivityMatch({ data: [event('1')], nextCursor: null }, 'synthetic-op', null, true), 'multiple')
  assert.equal(operationActivityMatch({ data: [event('1', 'other')], nextCursor: null }, 'synthetic-op'), 'unavailable')
  assert.equal(operationActivityMatch({ data: [event('1')], nextCursor: null }, 'synthetic-op', '2'), 'unavailable')
  assert.equal(operationActivityMatch({ data: [event('1')], nextCursor: null }, 'synthetic-op', '1'), 'single')
  assert.equal(operationActivityMatch({ data: [event('1'), event('1')], nextCursor: null }, 'synthetic-op', '1'), 'unavailable')
  assert.equal(operationActivityMatch({ data: [event('1')], nextCursor: 'older' }, 'synthetic-op', '1'), 'unavailable')
})
