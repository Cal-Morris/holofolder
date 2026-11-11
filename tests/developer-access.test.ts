import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { developerEntitled, normalizePermissions, requirePermissions } from '@/lib/developer-api/permissions';
import { createDeveloperKey, parseDeveloperKey, verifyDeveloperKey } from '@/lib/server/developer-access/key-secret';

describe('developer access', () => {
  test('requires subscription or perpetual access regardless of UI enforcement', () => {
    assert.equal(developerEntitled({ source: 'subscription', enforced: false }), true);
    assert.equal(developerEntitled({ source: 'perpetual', enforced: true }), true);
    for (const source of ['trial', 'free', undefined])
      assert.equal(developerEntitled({ source, enforced: false }), false);
  });
  test('permissions never silently accept unknown values or escalate', () => {
    assert.deepEqual(normalizePermissions(['catalog:read', 'catalog:read', 'collection:write']), [
      'catalog:read',
      'collection:write',
    ]);
    assert.throws(() => normalizePermissions(['admin:all']));
    assert.throws(() => normalizePermissions('catalog:read'));
    assert.throws(() => requirePermissions(['catalog:read'], ['collection:write']));
    requirePermissions(['collection:read', 'collection:write'], ['collection:write']);
  });
  test('keys are unpredictable, parseable and never recoverable from their digest', () => {
    const a = createDeveloperKey(),
      b = createDeveloperKey();
    assert.notEqual(a.key, b.key);
    assert.deepEqual(parseDeveloperKey(a.key), { id: a.id, secret: a.key.split('.')[1] });
    assert.equal(verifyDeveloperKey(a.key, a.digest), true);
    assert.equal(verifyDeveloperKey(b.key, a.digest), false);
    assert.equal(verifyDeveloperKey(a.key, 'malformed'), false);
    assert.equal(a.digest.includes(a.key), false);
    for (const value of ['', 'hf_', 'hf_bad.secret', a.key + 'extra', 'x'.repeat(10000)])
      assert.equal(parseDeveloperKey(value), null);
  });
});

test('key inputs bound names, expiry and permissions', async () => {
  const { normalizeKeyInput } = await import('@/lib/developer-api/keys');
  assert.deepEqual(normalizeKeyInput({ name: '  Synthetic script  ' }), {
    name: 'Synthetic script',
    expiryDays: 90,
    permissions: ['catalog:read', 'prices:read', 'binders:read', 'collection:read', 'settings:read'],
  });
  for (const input of [
    { name: '' },
    { name: 'x'.repeat(61) },
    { name: 'ok', expiryDays: 0 },
    { name: 'ok', permissions: ['admin:all'] },
  ])
    assert.throws(() => normalizeKeyInput(input));
});
