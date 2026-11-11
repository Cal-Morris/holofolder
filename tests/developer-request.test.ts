import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDeveloperJson, developerErrorResponse, bearerCredential } from '@/lib/server/developer-access/request';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';

test('body reader caps actual streamed bytes, including without Content-Length', async () => {
  assert.deepEqual(
    await readDeveloperJson(new Request('https://example.test', { method: 'POST', body: '{"name":"Synthetic key"}' })),
    { name: 'Synthetic key' },
  );
  await assert.rejects(
    readDeveloperJson(new Request('https://example.test', { method: 'POST', body: 'x'.repeat(65537) })),
    /64 KiB/,
  );
  await assert.rejects(
    readDeveloperJson(new Request('https://example.test', { method: 'POST', body: 'not JSON' })),
    /valid JSON/,
  );
});
test('credentials are only accepted through one bearer header', () => {
  assert.equal(bearerCredential(new Request('https://example.test?key=secret')), null);
  assert.equal(
    bearerCredential(new Request('https://example.test', { headers: { Authorization: 'Bearer secret' } })),
    'secret',
  );
  for (const authorization of ['Basic secret', 'Bearer x, Bearer y', 'Bearer', 'Bearer x y'])
    assert.equal(bearerCredential(new Request('https://example.test', { headers: { authorization } })), null);
});
test('errors redact dependencies, retain request ids and mark private', async () => {
  const response = developerErrorResponse(new Error('postgres://secret'), 'synthetic-request');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(JSON.stringify(await response.json()).includes('postgres'), false);
  const limited = developerErrorResponse(
    new DeveloperAccessError('rate_limited', 'Try again.', 429, 5),
    'synthetic-request',
  );
  assert.equal(limited.headers.get('retry-after'), '5');
});

test('foreign binders and origin failures retain their safe status instead of looking like outages', async () => {
  const { BinderAccessError } = await import('../lib/server/binders');
  const { AppearanceError } = await import('../lib/server/binder-appearance');
  assert.equal(developerErrorResponse(new BinderAccessError(), 'synthetic').status, 404);
  assert.equal(
    developerErrorResponse(new AppearanceError('Request origin is not allowed', 403), 'synthetic').status,
    403,
  );
});
