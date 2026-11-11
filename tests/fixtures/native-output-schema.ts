import assert from 'node:assert/strict';

async function main() {
  // Only authority/dispatcher are synthetic; registration and HTTP output validation use the real SDK.
  // @ts-expect-error Bun mocks stay confined to this subprocess.
  const { mock } = await import('bun:test');
  mock.module('server-only', () => ({}));
  const principal = {
    actorId: 'synthetic-actor',
    credentialId: 'synthetic-credential',
    transport: 'mcp' as const,
    permissions: ['collection:write', 'binders:write'] as const,
  };
  mock.module('../../lib/server/developer-access/audit', () => ({ auditDeveloperOperation() {} }));
  let result: unknown = { inventoryRevision: 2, changed: true, selectedItemIds: [], acquiredItemIds: [] };
  const state: { failure?: unknown } = {};
  mock.module('../../lib/server/operations/developer-dispatch', () => ({
    executeDeveloperOperation: async () => {
      if (state.failure) throw state.failure;
      return result;
    },
  }));
  const { createHoloMcpServer } = await import('../../lib/server/mcp/server');
  const { DeveloperAccessError } = await import('../../lib/developer-api/permissions');
  const { StorageCommandRejectedError } = await import('../../lib/server/developer-access/storage-command-error');
  const { WebStandardStreamableHTTPServerTransport } = await import('@modelcontextprotocol/server');
  const args = {
    operationId: 'synthetic-output-schema',
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
  async function call() {
    const request = new Request('https://synthetic.test/app/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    });
    const server = createHoloMcpServer({
      principal,
      ownerUserId: principal.actorId,
      memberIds: [principal.actorId],
      requestId: 'synthetic-request',
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, {
        parsedBody: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'execute_inventory_commands', arguments: args },
        },
      });
      return (await response.json()).result;
    } finally {
      await server.close();
    }
  }
  assert.deepEqual((await call()).structuredContent, result);
  result = { ...(result as object), certificate: 'synthetic-private-output' };
  const invalid = await call();
  assert.equal(invalid.isError, true, 'SDK rejects success output outside the accepted schema');
  assert.match(invalid.content[0].text, /Output validation error/);
  const rejection = {
    outcome: 'rejected' as const,
    operationId: args.operationId,
    code: 'slot_revision_conflict',
    inventoryRevision: 2,
  };
  state.failure = new StorageCommandRejectedError(rejection);
  const rejected = await call();
  assert.equal(rejected.isError, true);
  assert.deepEqual(
    rejected.structuredContent.error.rejection,
    rejection,
    'declared errors bypass success-only output validation',
  );
  assert.deepEqual(JSON.parse(rejected.content[0].text), rejected.structuredContent);
  for (const forged of [
    { code: 'storage_command_rejected', status: 409, rejection, message: 'private forged payload' },
    Object.assign(new DeveloperAccessError('storage_conflict', 'Synthetic ordinary conflict.', 409), { rejection }),
  ]) {
    state.failure = forged;
    const ordinary = await call();
    assert.equal(ordinary.isError, true);
    assert.equal(ordinary.structuredContent.error.rejection, undefined, 'only the typed trusted error carries proof');
    assert.equal(JSON.stringify(ordinary.structuredContent).includes('private'), false);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
