import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDeveloperKey } from '../../lib/server/developer-access/key-secret';

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import('bun:test');
  mock.module('server-only', () => ({}));
  const actor = '00820000-0000-4000-8000-000000000002',
    owner = '00820000-0000-4000-8000-000000000001';
  let oauthSession = false,
    signedIn = true,
    revoked = false,
    paid = true,
    readonly = false,
    errorCode: string | null = null;
  let partnerAllowed = true,
    billingRpcFails = false;
  const credentialId = createHash('sha256').update('synthetic').digest('hex');
  const permissions = () => (readonly ? ['collection:read', 'binders:read'] : ['collection:write', 'binders:write']);
  mock.module('../../lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getClaims: async () => ({
          data: {
            claims: {
              sub: actor,
              role: 'authenticated',
              session_id: 'synthetic-auth-session',
              ...(oauthSession ? { client_id: 'synthetic-client' } : {}),
            },
          },
        }),
      },
      rpc: (name: string) => ({
        abortSignal: async () => {
          // Synthetic inventory_read_scope_v2: live session/user state, then partnership owner and billing.
          assert.equal(name, 'inventory_read_scope_v2');
          if (!signedIn) return { data: null, error: { code: '42501', message: 'inventory_sign_in_required' } };
          if (billingRpcFails) return { data: null, error: { code: '57014', message: 'synthetic timeout' } };
          return {
            data: {
              actor,
              owner: partnerAllowed ? owner : actor,
              session_id: 'synthetic-auth-session',
              partner_paused: !partnerAllowed,
            },
            error: null,
          };
        },
      }),
    }),
  }));
  const mcpIdentity = {
    actorId: actor,
    clientId: '00820000-0000-4000-8000-000000000003',
    sessionId: '00820000-0000-4000-8000-000000000004',
    grantId: '00820000-0000-4000-8000-000000000005',
    expiresAt: 2000000000,
  };
  mock.module('../../lib/server/developer-access/grants', () => ({ verifyMcpToken: async () => mcpIdentity }));
  const calls: Array<{ path: string; body: Record<string, unknown>; header: Record<string, unknown> | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    assert.equal(url.hostname, 'synthetic.supabase.test');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const header = JSON.parse(new Headers(init?.headers).get('x-holo-audit-context') ?? 'null');
    calls.push({ path: url.pathname, body, header });
    if (url.pathname.endsWith('/authenticate_developer_request'))
      return Response.json(
        revoked
          ? { error: 'invalid_api_key' }
          : {
              actor_id: actor,
              credential_id: credentialId,
              permissions: permissions(),
              owner_user_id: owner,
              member_ids: [owner, actor],
              billing_access: { perpetual: paid },
              budget: { allowed: true },
            },
      );
    if (url.pathname.endsWith('/authenticate_developer_oauth_request'))
      return Response.json(
        revoked
          ? { error: 'oauth_revoked' }
          : {
              credential_id: credentialId,
              permissions: permissions(),
              redirect_origin: 'https://holofolder.com',
              owner_user_id: owner,
              member_ids: [owner, actor],
              billing_access: { perpetual: paid },
              budget: { allowed: true },
            },
      );
    if (url.pathname.endsWith('/resolve_developer_access'))
      return Response.json({
        owner_user_id: owner,
        member_ids: [owner, actor],
        billing_access: { perpetual: paid },
        budget: { allowed: true },
      });
    if (url.pathname.endsWith('/partnerships'))
      return Response.json({ owner_user_id: owner, user1_id: owner, user2_id: actor });
    if (url.pathname.endsWith('/billing_partner_allowed'))
      return billingRpcFails
        ? Response.json({ code: '57014', message: 'synthetic timeout' }, { status: 500 })
        : Response.json(partnerAllowed);
    if (url.pathname.endsWith('/storage_execute_v1')) {
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      assert.equal(body.owner_id, partnerAllowed ? owner : actor);
      assert.deepEqual(header?.actor, { kind: 'user', userId: actor });
      assert.equal(header?.operationId, 'synthetic-bridge-auth');
      assert.equal(header?.batchId, 'synthetic-bridge-auth');
      assert.equal('actor' in body, false);
      assert.equal('source' in body, false);
      if (errorCode === 'ABORT') throw new DOMException('synthetic transport timeout', 'AbortError');
      if (errorCode)
        return Response.json(
          { code: errorCode, message: 'private SQL certificate', details: 'secret' },
          { status: 400 },
        );
      if (body.operation === 'collection.create')
        return Response.json({
          inventoryRevision: 2,
          changed: true,
          collectionId: '00830000-0000-4000-8000-000000000011',
          collectionVersion: 0,
          layoutRevision: 0,
          slotIds: [],
          recoverySupported: false,
          evidence: { certificate: 'private' },
        });
      return Response.json({
        inventoryRevision: 2,
        changed: true,
        selectedItemIds: [],
        acquiredItemIds: [],
        evidence: { certificate: 'private' },
      });
    }
    throw new Error('Unexpected request ' + url.pathname);
  };
  const { executeAppStorageRequest, executeDeveloperStorageOperation } =
    await import('../../lib/server/operations/storage-execution');
  const { requireRestContext, requireMcpContext } = await import('../../lib/server/developer-access/principal');
  const writes = ['collection:write', 'binders:write'] as const;
  const command = {
    operationId: 'synthetic-bridge-auth',
    inventoryRevision: 1,
    collections: [],
    commands: [
      {
        kind: 'add',
        itemId: 'synthetic-copy',
        identity: { kind: 'pokemon', pokemonId: 1 },
        grading: null,
        acquiredAt: null,
      },
    ],
  };
  const key = createDeveloperKey();
  const request = (extra: Record<string, string> = {}, value: unknown = command) =>
    new Request('https://holofolder.com/app/api/inventory', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Binder-Owner': owner,
        'X-Binder-Auth-Session': 'synthetic-auth-session',
        'x-holo-audit-context': '{"actor":{"kind":"user","userId":"forged"},"source":"migration"}',
        ...extra,
      },
      body: JSON.stringify(value),
    });
  // The real REST/MCP boundaries: authenticate once, then the shared developer executor.
  const rest = async (operation: 'inventory' | 'collection.create', value: unknown = command) =>
    executeDeveloperStorageOperation(
      await requireRestContext(request({ authorization: 'Bearer ' + key.key }, value), writes, 'write'),
      operation,
      value,
    );
  const mcp = async (operation: 'inventory' | 'collection.create', value: unknown = command) =>
    executeDeveloperStorageOperation(
      await requireMcpContext(mcpIdentity, request({ authorization: 'Bearer synthetic-oauth' }, value), 'write'),
      operation,
      value,
    );
  const count = () => calls.filter((c) => c.path.endsWith('/storage_execute_v1')).length;
  await executeAppStorageRequest(request(), 'inventory');
  assert.equal(calls.at(-1)?.header?.source, 'app');
  await executeAppStorageRequest(request(), 'inventory');
  assert.deepEqual(
    calls.at(-1)?.header,
    calls.filter((c) => c.path.endsWith('/storage_execute_v1'))[0].header,
    'delivery retry preserves trusted ledger intent',
  );
  let before = count();
  await assert.rejects(executeAppStorageRequest(request({ 'X-Binder-Auth-Session': '' }), 'inventory'), {
    code: 'storage_session_changed',
  });
  oauthSession = true;
  await assert.rejects(executeAppStorageRequest(request(), 'inventory'));
  oauthSession = false;
  signedIn = false;
  await assert.rejects(executeAppStorageRequest(request(), 'inventory'));
  signedIn = true;
  await assert.rejects(executeAppStorageRequest(request({ origin: 'https://attacker.invalid' }), 'inventory'));
  await assert.rejects(executeAppStorageRequest(request({ 'X-Binder-Owner': actor }), 'inventory'));
  await assert.rejects(executeAppStorageRequest(request({}, { ...command, source: 'app' }), 'inventory'));
  assert.equal(count(), before);
  await rest('inventory');
  assert.equal(calls.at(-1)?.header?.source, 'rest');
  assert.equal(calls.at(-1)?.header?.clientId, credentialId);
  await mcp('inventory');
  assert.equal(calls.at(-1)?.header?.source, 'mcp');
  before = count();
  readonly = true;
  await assert.rejects(rest('inventory'));
  await assert.rejects(mcp('inventory'));
  readonly = false;
  paid = false;
  await assert.rejects(rest('inventory'));
  await assert.rejects(mcp('inventory'));
  paid = true;
  revoked = true;
  await assert.rejects(rest('inventory'));
  await assert.rejects(mcp('inventory'));
  revoked = false;
  await assert.rejects(
    executeDeveloperStorageOperation(
      {
        principal: { actorId: actor, credentialId, transport: 'rest', permissions: ['collection:read'] },
        ownerUserId: owner,
        memberIds: [actor],
        requestId: 'synthetic',
      },
      'inventory',
      command,
    ),
  );
  await assert.rejects(
    executeDeveloperStorageOperation(
      {
        principal: { actorId: actor, credentialId, transport: 'rest', permissions: ['binders:write'] },
        ownerUserId: owner,
        memberIds: [actor],
        requestId: 'synthetic',
      },
      'slots',
      {},
    ),
  );
  assert.equal(count(), before);
  errorCode = '40001';
  await assert.rejects(
    executeAppStorageRequest(request(), 'inventory'),
    (e: unknown) => e instanceof Error && !e.message.includes('certificate') && 'status' in e && e.status === 409,
  );
  errorCode = 'ABORT';
  await assert.rejects(
    executeAppStorageRequest(request(), 'inventory'),
    (e: unknown) => e instanceof Error && 'status' in e && e.status === 503,
  );
  errorCode = null;
  const creation = {
    version: 1,
    operationId: 'synthetic-bridge-auth',
    inventoryRevision: 1,
    collectionId: '00830000-0000-4000-8000-000000000011',
    name: 'Synthetic creation',
    kind: 'custom',
    defaultPresentation: 'list',
    location: 'Synthetic shelf',
    grid: null,
    manifest: { source: { id: 'blank', version: '1' }, name: 'Blank', entries: [] },
    slotIds: [],
  };
  for (const source of ['app', 'rest', 'mcp']) {
    const result =
      source === 'app'
        ? await executeAppStorageRequest(request({}, creation), 'collection.create')
        : source === 'rest'
          ? await rest('collection.create', creation)
          : await mcp('collection.create', creation);
    assert.equal(result.collectionId, creation.collectionId);
    assert.equal('evidence' in result, false);
    assert.equal(result.recoverySupported, false);
    assert.equal(calls.at(-1)?.header?.source, source);
    assert.deepEqual(calls.at(-1)?.body.request, creation);
  }
  before = count();
  await assert.rejects(executeAppStorageRequest(request({}, { ...creation, ownerUserId: actor }), 'collection.create'));
  assert.equal(count(), before);
  assert.ok(calls.every((c) => c.header?.source !== 'migration'));
  // Billing-denied partner: the shared owner's command keeps its billing pause, own storage opens.
  partnerAllowed = false;
  before = count();
  await assert.rejects(executeAppStorageRequest(request(), 'inventory'), { code: 'upgrade_required' });
  assert.equal(count(), before, 'a command bound to the shared owner is never retargeted');
  await executeAppStorageRequest(request({ 'X-Binder-Owner': actor }), 'inventory');
  assert.equal(calls.at(-1)?.body.owner_id, actor);
  partnerAllowed = true;
  billingRpcFails = true;
  before = count();
  await assert.rejects(executeAppStorageRequest(request({ 'X-Binder-Owner': actor }), 'inventory'));
  assert.equal(count(), before, 'an unavailable billing check never falls back to own storage');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
