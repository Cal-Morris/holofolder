import assert from 'node:assert/strict';

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-server-key';
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import('bun:test');
  const actor = '00000000-0000-4000-8000-000000000001',
    owner = '00000000-0000-4000-8000-000000000002';
  let signedIn = true,
    oauth = false,
    partner = false,
    partnerAllowed = true,
    missing = false;
  let auditReads = 0,
    viaServer = false;
  let operation: unknown = null;
  let affected: unknown = null;
  const rls = {
    from(table: string) {
      if (table === 'collection_activity' && !viaServer)
        throw new Error('Signed-in clients must not read stored history');
      const filters: Record<string, unknown> = {};
      const query = {
        select(columns: string) {
          if (table === 'collection_activity') {
            assert.ok(!columns.includes('recovery_state'));
            assert.ok(!columns.includes('command_evidence'));
          }
          return query;
        },
        eq(k: string, v: unknown) {
          filters[k] = v;
          return query;
        },
        or() {
          return query;
        },
        limit() {
          return query;
        },
        order() {
          return query;
        },
        lt() {
          return query;
        },
        contains(_key: string, value: unknown) {
          affected = value;
          return query;
        },
        gte() {
          return query;
        },
        lte() {
          return query;
        },
        maybeSingle: async () => ({
          data: partner ? { id: 'synthetic-membership', owner_user_id: owner, user1_id: owner, user2_id: actor } : null,
          error: null,
        }),
        then(resolve: (v: unknown) => void) {
          auditReads++;
          operation = filters.operation_id;
          assert.equal(filters.owner_user_id, partner && partnerAllowed ? owner : actor);
          resolve({
            data: missing ? null : [{ id: '9223372036854775807', changes: [] }],
            error: missing ? { code: '42703' } : null,
          });
        },
      };
      return query;
    },
    rpc: async () => ({ data: partnerAllowed, error: null }),
    auth: {
      getClaims: async () => ({
        data: { claims: signedIn ? { sub: actor, ...(oauth ? { client_id: 'synthetic-oauth' } : {}) } : null },
        error: null,
      }),
    },
  };
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => rls }));
  // Membership and billing come from the session client; stored history (whole rows) is read server-side only.
  mock.module('../../lib/supabase/admin', () => ({
    createAdminClient: () => ({
      from: (table: string) => {
        assert.equal(table, 'collection_activity');
        viaServer = true;
        try {
          return rls.from(table);
        } finally {
          viaServer = false;
        }
      },
    }),
  }));
  const { firstPartyActivity } = await import('../../lib/server/collection-activity');
  const request = (query = '') =>
    firstPartyActivity(new Request('https://synthetic.test/app/api/collection-activity' + query));
  let response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await response.json()).scope.ownerId, actor);
  partner = true;
  response = await request();
  assert.equal((await response.json()).scope.ownerId, owner);
  partnerAllowed = false;
  response = await request();
  assert.equal((await response.json()).scope.ownerId, actor);
  response = await request('?operationId=synthetic-op');
  assert.equal(response.status, 200);
  assert.equal(operation, 'synthetic-op');
  response = await request('?inventoryItemId=synthetic-copy');
  assert.equal(response.status, 200);
  assert.deepEqual(affected, { inventoryItemIds: ['synthetic-copy'] });
  const count = auditReads;
  for (const query of [
    '?itemId=synthetic-copy',
    '?operationId=',
    '?operationId=one&operationId=two',
    '?operationId=synthetic-op&ownerId=' + owner,
    '?id=1&operationId=synthetic-op',
  ]) {
    response = await request(query);
    assert.equal(response.status, 400);
    assert.equal(auditReads, count);
  }
  response = await request('?ownerId=' + owner);
  assert.equal(response.status, 400);
  assert.equal(auditReads, count);
  response = await request('?actorId=not-a-uuid');
  assert.equal(response.status, 400);
  response = await request('?scope=1');
  assert.equal(response.status, 200);
  assert.equal(auditReads, count);
  missing = true;
  response = await request();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'audit_unavailable');
  signedIn = false;
  response = await request();
  assert.equal(response.status, 401);
  signedIn = true;
  oauth = true;
  response = await request();
  assert.equal(response.status, 401);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
