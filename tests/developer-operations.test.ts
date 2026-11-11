import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVELOPER_OPERATIONS, matchRestOperation } from '@/lib/developer-api/operations';
test('REST dispatch uses a finite allowlist and static paths win over ids', () => {
  assert.equal(matchRestOperation('PUT', '/binders/order')?.operation.name, 'reorder_binders');
  assert.equal(matchRestOperation('GET', '/cards/base1-1')?.params.id, 'base1-1');
  assert.equal(matchRestOperation('POST', '/admin/sync-card-db'), null);
  assert.equal(matchRestOperation('GET', '/keys'), null);
  assert.equal(new Set(DEVELOPER_OPERATIONS.map((op) => op.name)).size, DEVELOPER_OPERATIONS.length);
});
test('operation inputs reject excess fields, oversized batches and missing write preconditions', () => {
  const schema = (name: string) => DEVELOPER_OPERATIONS.find((op) => op.name === name)!.schema;
  assert.equal(schema('list_cards').safeParse({ limit: 101 }).success, false);
  assert.equal(schema('list_cards').safeParse({ ownerId: 'someone-else' }).success, false);
  assert.equal(schema('create_binder').safeParse({ name: 'Synthetic binder' }).success, false);
  assert.equal(
    schema('get_prices').safeParse({ cards: Array.from({ length: 26 }, () => ({ cardId: 'base1-1' })) }).success,
    false,
  );
});

test('settings replacement requires a snapshot fingerprint', async () => {
  const { getDefaultBinderSettings } = await import('../lib/settings');
  const schema = DEVELOPER_OPERATIONS.find((op) => op.name === 'update_settings')!.schema;
  assert.equal(schema.safeParse(getDefaultBinderSettings()).success, false);
  assert.equal(schema.safeParse({ ...getDefaultBinderSettings(), baseFingerprint: 'a'.repeat(64) }).success, true);
});

test('set listing accepts an exact release year and rejects malformed years', () => {
  const schema = DEVELOPER_OPERATIONS.find((op) => op.name === 'list_sets')!.schema;
  assert.equal(schema.safeParse({ year: '2017' }).success, true);
  for (const year of ['17', '2017-01', '2017,2018', '2017%']) assert.equal(schema.safeParse({ year }).success, false);
});
