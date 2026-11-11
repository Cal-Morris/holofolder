import assert from 'node:assert/strict';

async function main() {
  // @ts-expect-error Bun mocks stay inside this synthetic subprocess.
  const { mock } = await import('bun:test');
  mock.module('server-only', () => ({}));
  const { storageCommandHarness } = await import('./storage-command-harness');
  const f = storageCommandHarness('synthetic-production-route');
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => f.client }));
  mock.module('../../lib/supabase/admin', () => ({ createAdminClient: () => f.client }));
  const inventory = await import('../../app/api/inventory/route');
  const slots = await import('../../app/api/binder-slots/route');
  const creation = await import('../../app/api/storage-collections/route');
  const recovery = await import('../../app/api/native-recovery/route');
  const restore = await import('../../app/api/raw-content-restore/route');
  const owner = '00000000-0000-4000-8000-0000000000e2';
  const collectionId = '22222222-2222-4222-8222-222222222222';
  const command = {
    operationId: 'synthetic-route-command',
    inventoryRevision: 7,
    collectionId,
    collectionVersion: 3,
    layoutRevision: 4,
    commands: [{ kind: 'create', ids: ['synthetic-new-slot'], beforeSlotId: null }],
  };
  const headers = {
    Origin: 'http://localhost:3529',
    'Content-Type': 'application/json',
    'X-Binder-Owner': owner,
    'X-Binder-Actor': owner,
    'X-Binder-Auth-Session': 'synthetic-e2e-auth-session',
    'X-Storage-Operation': command.operationId,
  };
  const request = (body: unknown = command, extra = {}) =>
    new Request('http://localhost:3529/app/api/binder-slots', {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  const privateReply = (r: Response) => {
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.headers.get('vary'), 'Cookie');
  };
  for (const extra of [
    { Origin: '' },
    { Origin: 'https://attacker.test' },
    { 'X-Binder-Actor': 'another-actor' },
    { 'X-Binder-Owner': 'another-owner' },
    { 'X-Binder-Auth-Session': 'old-session' },
  ]) {
    const response = await slots.POST(request(command, extra));
    assert.equal(response.status, 403);
    privateReply(response);
  }
  // A session revoked server-side (auth.sessions row gone, user banned or deleted) fails inventory_read_scope_v2.
  f.revoke();
  assert.equal((await slots.POST(request())).status, 401);
  f.revoke(false);
  const getClaims = f.client.auth.getClaims.bind(f.client.auth);
  for (const claims of [
    { sub: owner, role: 'authenticated', session_id: 'synthetic-e2e-auth-session', client_id: 'oauth-client' },
    { sub: 'another-actor', role: 'authenticated', session_id: 'synthetic-e2e-auth-session' },
    { sub: owner, role: 'anon', session_id: 'synthetic-e2e-auth-session' },
  ]) {
    f.client.auth.getClaims = async () => ({ data: { claims }, error: null }) as never;
    assert.ok([401, 403].includes((await slots.POST(request())).status));
  }
  f.client.auth.getClaims = getClaims;
  // A missing current partner billing policy cannot fall back to permissive membership.
  const partner = '33333333-3333-4333-8333-333333333333';
  f.tables.partnerships.push({ id: collectionId, owner_user_id: owner, user1_id: owner, user2_id: partner });
  f.setActor(partner);
  const rpc = f.client.rpc.bind(f.client);
  // inventory_read_scope_v2 resolves the partner's billing in SQL; a missing billing function is an error there.
  f.client.rpc = ((name: string, args: Record<string, unknown>) =>
    name === 'inventory_read_scope_v2'
      ? {
          abortSignal: async () => ({
            data: null,
            error: { code: '42883', message: 'synthetic missing billing_partner_allowed' },
          }),
        }
      : rpc(name, args)) as typeof f.client.rpc;
  const unavailableBilling = await slots.POST(request(command, { 'X-Binder-Actor': partner }));
  assert.equal(unavailableBilling.status, 503);
  privateReply(unavailableBilling);
  f.client.rpc = rpc;
  f.tables.partnerships.length = 0;
  f.setActor(owner);
  const accepted = await slots.POST(request());
  assert.equal(accepted.status, 200, await accepted.clone().text());
  privateReply(accepted);
  const receipt = await accepted.json();
  assert.equal('snapshot' in receipt, false);
  assert.deepEqual(await (await slots.POST(request())).json(), receipt);
  const changed = await slots.POST(request({ ...command, inventoryRevision: 8 }));
  assert.equal(changed.status, 409);
  assert.equal('rejection' in (await changed.json()), false, 'changed input cannot become terminal proof');
  const read = await inventory.GET(
    new Request('http://localhost:3529/app/api/inventory?requestId=synthetic-read&sessionId=synthetic-epoch'),
  );
  assert.equal(read.status, 200);
  privateReply(read);
  assert.equal((await read.json()).snapshot.binders[0].slots.length, 5);
  assert.equal((await inventory.GET(new Request('http://localhost:3529/app/api/inventory?owner=forged'))).status, 400);
  for (const handler of [inventory.POST, creation.POST]) {
    const response = await handler(request({}, { 'X-Storage-Operation': 'different-operation' }));
    assert.equal(response.status, 400);
    privateReply(response);
  }
  const preview = await recovery.POST(
    new Request('http://localhost:3529/app/api/native-recovery?operation=recovery.preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: '101', restoreUnassignedItemIds: [] }),
    }),
  );
  assert.equal(preview.status, 200);
  privateReply(preview);
  assert.equal((await preview.json()).preview.planToken, 'a'.repeat(64));
  const refusedRestore = await restore.POST(
    new Request('http://localhost:3529/app/api/raw-content-restore', { method: 'POST' }),
  );
  assert.equal(refusedRestore.status, 403);
  privateReply(refusedRestore);
  const { blankPreset } = await import('../../lib/binder-creation-draft');
  const createBody = {
    version: 1,
    operationId: 'synthetic-route-create',
    inventoryRevision: 8,
    collectionId: '33333333-3333-4333-8333-333333333333',
    name: 'Synthetic created storage',
    kind: 'binder',
    defaultPresentation: 'binder',
    grid: null,
    location: null,
    manifest: blankPreset(),
    slotIds: [],
  };
  const create = () => creation.POST(request(createBody, { 'X-Storage-Operation': createBody.operationId }));
  const created = await create();
  assert.equal(created.status, 200, await created.clone().text());
  privateReply(created);
  const createdBody = await created.json();
  assert.deepEqual(await (await create()).json(), createdBody);
  const addBody = {
    operationId: 'synthetic-route-add',
    inventoryRevision: 9,
    collections: [],
    commands: [
      {
        kind: 'add',
        itemId: 'synthetic-route-copy',
        identity: { kind: 'pokemon', pokemonId: 25 },
        grading: null,
        acquiredAt: null,
      },
    ],
  };
  const add = () => inventory.POST(request(addBody, { 'X-Storage-Operation': addBody.operationId }));
  const added = await add();
  assert.equal(added.status, 200, await added.clone().text());
  privateReply(added);
  assert.deepEqual(await (await add()).json(), await added.json());
  assert.equal('GET' in slots, false);
  for (const route of [slots, inventory]) for (const verb of ['PATCH', 'DELETE']) assert.equal(verb in route, false);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
