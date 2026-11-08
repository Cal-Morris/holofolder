import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPrivateArtworkStore, getPrivateArtworkConfig } from '../lib/server/binder-artwork-r2'

const config = { accountId: 'a'.repeat(32), accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret', bucket: 'synthetic-private-artwork' }
const owner = '3c71776e-02b5-4c0f-92b3-3447cb003539'
const id = 'upload:9ade73fb-d75e-4174-86a1-9e4769b85f30'
test('private artwork requires a dedicated bucket and credentials, never falls back to public card settings', () => {
  assert.equal(getPrivateArtworkConfig({ R2_ACCOUNT_ID: config.accountId, R2_BUCKET: 'public-cards', R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'y' }), null)
  assert.equal(getPrivateArtworkConfig({ R2_ACCOUNT_ID: config.accountId, R2_ARTWORK_BUCKET: 'public-cards', R2_BUCKET: 'public-cards', R2_ARTWORK_ACCESS_KEY_ID: 'x', R2_ARTWORK_SECRET_ACCESS_KEY: 'y' }), null)
})
test('signed uploads bind owner, immutable object, MIME and exact size; downloads expire in five minutes', async () => {
  const store = createPrivateArtworkStore(config)
  const upload = await store.prepareUpload(owner, id, 'image/png', 123)
  const url = new URL(upload.signedUploadUrl)
  assert.equal(url.hostname, `${config.accountId}.r2.cloudflarestorage.com`)
  assert.equal(url.pathname, `/${config.bucket}/${owner}/${id.slice(7)}`)
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300')
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match')
  assert.deepEqual(upload.headers, { 'Content-Type': 'image/png', 'If-None-Match': '*' })
  assert.equal(new URL(await store.downloadUrl(owner, id)).searchParams.get('X-Amz-Expires'), '300')
  await assert.rejects(store.prepareUpload(owner, id, 'text/html', 123))
  await assert.rejects(store.prepareUpload(owner, id, 'image/png', 5 * 1024 * 1024 + 1))
  await assert.rejects(store.downloadUrl('../other', id))
})
test('private artwork reads use only signed R2 requests and bound oversized responses', async () => {
  const requests: Request[] = []
  const store = createPrivateArtworkStore(config, async (input, init) => {
    requests.push(new Request(input, init))
    return new Response('synthetic', { headers: { 'content-length': String(6 * 1024 * 1024) } })
  })
  await assert.rejects(store.read(owner, id), /5 MB/)
  assert.equal(requests.length, 1)
  assert.ok(requests[0].headers.has('authorization'))
  assert.equal(new URL(requests[0].url).hostname, `${config.accountId}.r2.cloudflarestorage.com`)
})
