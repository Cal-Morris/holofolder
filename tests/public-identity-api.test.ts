import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IdentityError,
  identityFailure,
  identityJson,
  requireIdentityOrigin,
} from '../lib/server/public-binder-identity';

// Synthetic requests only, no network or browser.
test('public identity writes allow the app and trusted Framer origin, rejecting cross-site writes', () => {
  for (const origin of ['https://app.holofolder.com', 'https://holofolder.com']) {
    requireIdentityOrigin(new Request('https://app.holofolder.com/app/api/account-identity', { headers: { origin } }));
  }
  requireIdentityOrigin(
    new Request('http://localhost:3441/app/api/account-identity', { headers: { origin: 'http://localhost:3441' } }),
  );
  for (const headers of [
    new Headers({ origin: 'https://synthetic.invalid' }),
    new Headers({ 'sec-fetch-site': 'cross-site' }),
  ]) {
    assert.throws(
      () => requireIdentityOrigin(new Request('https://app.holofolder.com/app/api/account-identity', { headers })),
      (error: unknown) => error instanceof IdentityError && error.status === 403,
    );
  }
});

test('identity responses are private and map unavailable, taken, invalid and unauthorized errors', async () => {
  const ok = identityJson({ username: 'synthetic' });
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  for (const [error, status] of [
    [{ code: '42P01' }, 503],
    [{ code: 'PGRST202' }, 503],
    [{ code: '23505' }, 409],
    [{ code: '22023' }, 400],
    [{ code: '42501' }, 403],
    [new IdentityError('Sign in', 401), 401],
  ] as const) {
    const response = identityFailure(error, 'Username');
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.ok((await response.json()).error);
  }
});
