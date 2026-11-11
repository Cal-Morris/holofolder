import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMcpClaims } from '@/lib/developer-api/oauth';
const claims = {
  iss: 'https://synthetic.supabase.co/auth/v1',
  sub: '00000000-0000-4000-8000-000000000001',
  client_id: '00000000-0000-4000-8000-000000000002',
  session_id: '00000000-0000-4000-8000-000000000003',
  developer_grant_id: '00000000-0000-4000-8000-000000000004',
  aud: 'https://app.holofolder.com/app/mcp',
  role: 'holo_mcp',
  exp: 2000000000,
};
test('MCP accepts only the exact resource, issuer and complete OAuth identity', () => {
  assert.equal(validateMcpClaims(claims, claims.iss, 1000).clientId, claims.client_id);
  for (const patch of [
    { aud: 'https://holofolder.com/app/mcp' },
    { aud: 'authenticated' },
    { role: 'authenticated' },
    { iss: 'https://attacker.test' },
    { exp: 999 },
    { client_id: undefined },
    { session_id: 'invalid' },
    { developer_grant_id: undefined },
  ])
    assert.throws(() => validateMcpClaims({ ...claims, ...patch }, claims.iss, 1000));
});

test('MCP browser origins are bound to the consenting client, opaque origins are denied', async () => {
  const { validateMcpOrigin } = await import('@/lib/developer-api/oauth');
  validateMcpOrigin(undefined, 'https://synthetic-client.test');
  validateMcpOrigin('https://holofolder.com', 'https://synthetic-client.test');
  validateMcpOrigin('https://synthetic-client.test', 'https://synthetic-client.test');
  assert.throws(() => validateMcpOrigin('https://attacker.test', 'https://synthetic-client.test'));
  assert.throws(() => validateMcpOrigin('null', 'null'));
});

test('failed OAuth revocation remains distinguishable and retryable after reload', async () => {
  const { needsOAuthRevocation } = await import('../lib/developer-api/oauth');
  assert.equal(needsOAuthRevocation({ revoked_at: '2026-11-08T00:00:00Z', auth_revoked_at: null }), true);
  assert.equal(
    needsOAuthRevocation({ revoked_at: '2026-11-08T00:00:00Z', auth_revoked_at: '2026-11-08T00:00:01Z' }),
    false,
  );
  assert.equal(needsOAuthRevocation({ revoked_at: null, auth_revoked_at: null }), false);
});

test('OAuth handoff recognizes only HTTP loopback callbacks', async () => {
  const oauth = await import('@/lib/developer-api/oauth');
  assert.equal(typeof oauth.isLoopbackOAuthRedirect, 'function');
  for (const url of [
    'http://localhost:1455/auth/callback',
    'http://127.0.0.1:54321/callback',
    'https://[::1]:8080/callback',
    'http://LOCALHOST/callback',
  ]) {
    assert.equal(oauth.isLoopbackOAuthRedirect(url), true, url);
  }
  for (const url of [
    'https://client.example/callback',
    'http://localhost.evil.example/callback',
    'http://localhost@evil.example/callback',
    'myapp://localhost/callback',
    'not a URL',
    '/callback',
  ]) {
    assert.equal(oauth.isLoopbackOAuthRedirect(url), false, url);
  }
});
