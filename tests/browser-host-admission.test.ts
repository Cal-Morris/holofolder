import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserHostAdmission } from '@/lib/collection/browser-host-admission';

describe('browser host admission', () => {
  test('saved view, production, hostname and env alone cannot admit the host', () => {
    for (const local of [false, true])
      for (const host of ['holofolder.com', 'app.holofolder.com', 'localhost.evil.test', null])
        assert.equal(browserHostAdmission(local, '1', false, host).admitted, false);
    assert.equal(browserHostAdmission(false, '1', false, 'localhost:3427').admitted, false);
    assert.equal(browserHostAdmission(true, '1', true, 'localhost:3427').admitted, false);
    assert.equal(browserHostAdmission(true, undefined, false, 'localhost:3427').admitted, false);
  });
  test('only explicit server harness plus loopback allows synthetic execution', () => {
    assert.deepEqual(browserHostAdmission(true, '1', false, '127.0.0.1:3427'), {
      admitted: true,
      evidence: 'synthetic-local-only',
    });
  });
});

// Synthetic checked scope here represents the hook result, never cached DTO admission.
test('authenticated host requires the checked scope, synthetic admission never becomes authenticated', () => {
  const scope = { actorUserId: 'actor', ownerUserId: 'owner', authSessionId: 'auth', sessionId: 'lifetime' };
  assert.deepEqual(browserHostAdmission(false, undefined, true, 'holofolder.com', scope), {
    admitted: true,
    evidence: 'authenticated-session',
  });
  assert.equal(
    browserHostAdmission(false, '1', false, 'holofolder.com', { ...scope, authSessionId: '' }).admitted,
    false,
  );
  assert.equal(browserHostAdmission(false, '1', false, 'holofolder.com', null).admitted, false);
  assert.deepEqual(browserHostAdmission(true, '1', false, 'localhost:3427', scope), {
    admitted: true,
    evidence: 'synthetic-local-only',
  });
  assert.equal(browserHostAdmission(true, '1', true, 'holofolder.com', scope).admitted, false);
});
