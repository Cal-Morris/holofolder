import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations'
import { docsOpenAPI } from '@/lib/docs-openapi'
import schema from '@/public/openapi.json'

test('the downloadable API contract covers every registered operation with authentication and permissions', () => {
  const paths: Record<string, Record<string, { operationId: string; description: string; tags: string[]; security: unknown[] }>> = schema.paths
  assert.equal(Object.values(paths).reduce((count, methods) => count + Object.keys(methods).length, 0), DEVELOPER_OPERATIONS.length)
  for (const operation of DEVELOPER_OPERATIONS) {
    const documented = paths[operation.path]?.[operation.method.toLowerCase()]
    assert.ok(documented, operation.name)
    assert.equal(documented.operationId, operation.name)
    assert.deepEqual(documented.security, [{ apiKey: [] }])
    assert.equal(documented.tags.length, 1)
    for (const permission of operation.permissions) assert.ok(documented.description.includes(permission), operation.name)
  }
  assert.equal(schema.servers[0].url, 'https://app.holofolder.com/app/api/v1')
})

test('native explorer pages cover the registry once and use the direct developer API without a proxy', async () => {
  const source = await docsOpenAPI.staticSource({ per: 'operation', groupBy: 'tag', baseDir: 'reference' })
  const files = source.files.filter(file => file.type === 'page')
  assert.equal(files.length, DEVELOPER_OPERATIONS.length)
  assert.equal(new Set(files.map(file => file.path)).size, files.length)
  const { bundled } = await docsOpenAPI.getSchema('holofolder')
  assert.equal(bundled.servers?.[0]?.url, 'https://app.holofolder.com/app/api/v1')
  assert.equal(docsOpenAPI.options.proxyUrl, undefined)
})

 test('operation history filter is present in generated discovery with read permission and no new authority', () => {
  const operation = schema.paths['/collection/audit'].get
  const parameter = operation.parameters.find(p => p.name === 'operationId')
  assert.ok(parameter)
  assert.equal(parameter.in, 'query')
  assert.equal(parameter.required, false)
  assert.equal(parameter.schema.maxLength, 200)
  assert.match(operation.description, /zero or multiple/)
  assert.match(operation.description, /collection:read/)
 })
