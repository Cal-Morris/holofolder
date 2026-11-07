import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureAcquisition, normalizeAcquisition, normalizePushSubscription, mergeQueuedAcquisition, ownedPrintingKey, readPushMembership, writePushMembership } from '../lib/partner-push'
import type { CollectedPokemon } from '../lib/domain/cards'

// Synthetic accounts, relationships, endpoints and cards. No push service is contacted.
const actorId = '00000000-0000-4000-8000-000000000001'
const recipientId = '00000000-0000-4000-8000-000000000002'
const partnershipId = '00000000-0000-4000-8000-000000000003'
const operationId = '00000000-0000-4000-8000-000000000004'
const membership = { actorId, recipientId, partnershipId, ownerId: actorId }
const card: CollectedPokemon = { id: 'synthetic-slot', pokemon_id: 1, pokemon_name: 'Fixture', card_id: 'synthetic-card', card_name: 'Synthetic card', card_language: 'en', card_finish: 'normal', status: 'collected', wanted_cards: [], collected_at: '2026-11-07' }
const intent = () => captureAcquisition(null, card, { actorId, ownerId: actorId, membership }, operationId)!

test('new owned printings capture notification intent in any mode', () => {
 assert.equal(intent().recipientId, recipientId)
 assert.equal(intent().printingKey, ownedPrintingKey(card))
 assert.deepEqual(captureAcquisition(null, card, { actorId, ownerId: actorId, membership }, operationId), intent())
 assert.equal(captureAcquisition(card, { ...card, status: 'finalized' }, { actorId, ownerId: actorId, membership }, operationId), undefined)
 assert.equal(captureAcquisition(null, { ...card, status: 'wishlisted' }, { actorId, ownerId: actorId, membership }, operationId), undefined)
 assert.equal(captureAcquisition(null, card, { actorId, ownerId: actorId, membership: null }, operationId), undefined)
 assert.equal(captureAcquisition(null, card, { actorId: recipientId, ownerId: actorId, membership }, operationId), undefined)
 assert.ok(captureAcquisition({ ...card, card_id: 'other' }, card, { actorId, ownerId: actorId, membership }, operationId))
})

test('acquiring a wanted printing captures notification intent outside Show mode', () => {
 const wanted = { card_id: card.card_id!, card_name: card.card_name!, added_at: '2026-11-07' }
 const before: CollectedPokemon = { ...card, card_id: undefined, status: 'wishlisted', wanted_cards: [wanted] }
 const context = { actorId, ownerId: actorId, membership }
 const captured = captureAcquisition(before, card, context, operationId)
 assert.deepEqual(captured, intent())
 assert.deepEqual(captureAcquisition({ ...before, status: 'collected', card_id: 'old-printing' }, card, context, operationId), captured)
 assert.equal(captureAcquisition({ ...card, wanted_cards: [wanted] }, card, context, operationId), undefined)
 assert.equal(captureAcquisition(before, before, context, operationId), undefined)
 assert.equal(captureAcquisition(before, card, { ...context, membership: null }, operationId), undefined)
 assert.equal(captureAcquisition(before, card, { ...context, actorId: recipientId }, operationId), undefined)
 assert.equal(captureAcquisition(before, card, { ...context, ownerId: recipientId }, operationId), undefined)
 assert.deepEqual(mergeQueuedAcquisition(before, card, undefined, captured), captured)
 assert.equal(mergeQueuedAcquisition(before, before, undefined, captured), undefined)
})

test('queue compaction preserves intent for metadata edits and drops undone or superseded acquisitions', () => {
 const captured = intent()
 assert.deepEqual(mergeQueuedAcquisition(null, { ...card, pokemon_name: 'Renamed' }, undefined, captured), captured)
 assert.equal(mergeQueuedAcquisition(card, card, undefined, captured), undefined)
 assert.equal(mergeQueuedAcquisition(null, { ...card, card_finish: 'holo' }, undefined, captured), undefined)
 assert.equal(mergeQueuedAcquisition(null, null, undefined, captured), undefined)
 assert.deepEqual(normalizeAcquisition(captured), captured)
 assert.equal(normalizeAcquisition({ ...captured, actorId: 'invalid' }), undefined)
 assert.equal(normalizeAcquisition({ ...captured, recipientId: actorId }), undefined)
})

test('subscription validation accepts standard services and rejects unsafe endpoints and malformed keys', () => {
 const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') }
 for (const endpoint of ['https://fcm.googleapis.com/fcm/send/synthetic', 'https://web.push.apple.com/synthetic', 'https://updates.push.services.mozilla.com/wpush/v2/synthetic']) assert.ok(normalizePushSubscription({ endpoint, keys, label: 'Synthetic device' }))
 for (const endpoint of ['http://fcm.googleapis.com/test', 'https://127.0.0.1/test', 'https://example.com/test', 'https://fcm.googleapis.com.attacker.invalid/test', 'https://user:pass@fcm.googleapis.com/test', 'https://fcm.googleapis.com:8443/test']) assert.equal(normalizePushSubscription({ endpoint, keys }), null)
 assert.equal(normalizePushSubscription({ endpoint: 'https://fcm.googleapis.com/test', keys: { ...keys, auth: 'short' } }), null)
 assert.equal(normalizePushSubscription({ endpoint: 'https://fcm.googleapis.com/test', keys: { ...keys, p256dh: Buffer.alloc(65).toString('base64url') } }), null)
 assert.equal(normalizePushSubscription({ endpoint: 'https://fcm.googleapis.com/test', keys, label: 'x'.repeat(81) }), null)
})

test('cached membership is actor-scoped and an unlinked account clears only its own context', () => {
 const values = new Map<string,string>()
 const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key,value) }, removeItem: (key: string) => { values.delete(key) } }
 writePushMembership(actorId, membership, storage)
 assert.deepEqual(readPushMembership(actorId, storage), membership)
 assert.equal(readPushMembership(recipientId, storage), null)
 writePushMembership(actorId, null, storage)
 assert.equal(readPushMembership(actorId, storage), null)
})

test('notification intent cannot prevent a collection save when UUID generation is unavailable', () => {
 const original = crypto.randomUUID
 Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
 try {
  assert.equal(captureAcquisition(null, card, { actorId, ownerId: actorId, membership }), undefined)
 } finally { Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original }) }
})
