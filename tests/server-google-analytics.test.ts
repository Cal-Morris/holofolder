import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequestPayload, trackApiRequest } from '../lib/server/google-analytics';

test('api_request payload hashes the credential and carries no ids', async () => {
  const payload = await apiRequestPayload('synthetic-credential', {
    transport: 'mcp',
    operation: 'search_cards',
    outcome: 'success',
  });
  assert.match(payload.client_id, /^[0-9a-f]{32}$/);
  assert.equal(
    payload.client_id,
    (await apiRequestPayload('synthetic-credential', payload.events[0].params)).client_id,
  );
  assert.equal(JSON.stringify(payload).includes('synthetic-credential'), false);
  assert.deepEqual(payload.events[0], {
    name: 'api_request',
    params: { transport: 'mcp', operation: 'search_cards', outcome: 'success', code: 'ok', engagement_time_msec: 1 },
  });
});

test('outside production nothing is sent', () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response();
  }) as typeof fetch;
  try {
    trackApiRequest('synthetic-credential', { transport: 'rest', operation: 'list_binders', outcome: 'success' });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
