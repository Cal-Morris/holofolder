import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MCP_RESOURCE } from '@/lib/developer-api/oauth'
import { MCP_METADATA_URL, protectedResourceMetadata } from '@/lib/server/mcp/metadata'

test('MCP discovery stays on the direct developer host and identifies the exact resource', () => {
  const resource = new URL('https://app.holofolder.com/app/mcp')
  assert.equal(MCP_RESOURCE, resource.href)
  assert.equal(new URL(MCP_METADATA_URL).origin, resource.origin)
  const metadata = protectedResourceMetadata('https://synthetic.supabase.co/auth/v1')
  assert.equal(metadata.resource, resource.href)
  assert.deepEqual(metadata.authorization_servers, ['https://synthetic.supabase.co/auth/v1'])
})

test('direct REST responses support browser clients without cookie credentials', async () => {
  const { restOptions, restResponse, developerErrorResponse } = await import('@/lib/server/developer-access/request')
  const preflight = restOptions()
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
  for (const header of ['Authorization', 'Content-Type', 'Idempotency-Key']) {
    assert.ok(preflight.headers.get('access-control-allow-headers')?.includes(header))
  }
  for (const response of [Response.json({ synthetic: true }), developerErrorResponse(new Error('synthetic'), 'synthetic')]) {
    restResponse(response)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.equal(response.headers.get('access-control-allow-credentials'), null)
    assert.ok(response.headers.get('access-control-expose-headers')?.includes('Retry-After'))
  }
})
