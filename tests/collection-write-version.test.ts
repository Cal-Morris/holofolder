import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveRemoteCollectionItem, deleteRemoteCollectionItem } from '../lib/collection/remote'
import { collectionFingerprint, COLLECTION_FINGERPRINT_VERSION } from '../lib/collection/sync'
import type { CollectedPokemon } from '../lib/domain/cards'

test('current queued saves and deletes identify the assignee-aware fingerprint protocol', async () => {
  const item: CollectedPokemon = { id: "synthetic-row", pokemon_id: 1, pokemon_name: 'Synthetic fixture', status: 'collected', card_id: 'synthetic-card', wanted_cards: [], collected_at: '2026-11-07' }
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init })
    return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ item })
  }) as typeof fetch
  try {
    const baseFingerprint = collectionFingerprint(item)
    await saveRemoteCollectionItem(item, { baseFingerprint })
    await deleteRemoteCollectionItem(1, { baseFingerprint })
    assert.equal(JSON.parse(String(calls[0].init?.body)).fingerprintVersion, COLLECTION_FINGERPRINT_VERSION)
    assert.equal(new URL(calls[1].url, 'https://synthetic.test').searchParams.get('fingerprintVersion'), String(COLLECTION_FINGERPRINT_VERSION))
  } finally { globalThis.fetch = original }
})
