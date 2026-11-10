import assert from 'node:assert/strict'
import {assertSmokeResponse,assertStagedSmokeResponse,assertTerminalStorageSmokeResponse} from '../../scripts/api-smoke-assertions'
import { createHash } from 'node:crypto'
import { createDeveloperKey } from '../../lib/server/developer-access/key-secret'
import { DeveloperAccessError } from '../../lib/developer-api/permissions'
import type { DeveloperPermission } from '../../lib/developer-api/permissions'

async function main() {
  // Synthetic authentication/PostgREST only. No hosted network or production admission override.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role'
  process.env.VERCEL = '0'
  // @ts-expect-error Bun module mocks are isolated to this subprocess.
  const { mock } = await import('bun:test')
  mock.module('server-only', () => ({}))
  const wired = process.argv.includes('--wired')
  if (wired) mock.module('../../lib/server/operations/native-developer-admission', () => ({ requireNativeDeveloperAdmission() {} }))
  const actor = '00820000-0000-4000-8000-000000000002', owner = '00820000-0000-4000-8000-000000000001'
  let currentActor = actor, currentOwner = owner, readonly = false, paid = true, revoked = false, budget = true
  let terminal = false, forged: unknown = undefined
  let loseReply = false
  let error: string | null = null, privatePreview = false, missingScope: DeveloperPermission | null = null
  let credentialId = createHash('sha256').update('synthetic-native').digest('hex')
  const key = createDeveloperKey()
  const permissions = (): DeveloperPermission[] => (readonly ? ['collection:read', 'binders:read'] : ['collection:read', 'collection:write', 'binders:read', 'binders:write']).filter(p => p !== missingScope) as DeveloperPermission[]
  mock.module('../../lib/server/developer-access/grants', () => ({ authenticateMcpToken: async (token: string) => {
    if (revoked || token !== 'synthetic-oauth') throw new DeveloperAccessError('oauth_revoked', 'Synthetic denied credential.', 401)
    return { actorId: currentActor, credentialId, transport: 'mcp', permissions: permissions() }
  } }))
  const calls: { operation: string; request: Record<string, unknown>; header: Record<string, unknown> }[] = []
  const ledger = new Map<string, { body: string; result: unknown }>()
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    assert.equal(url.hostname, 'synthetic.supabase.test', 'no real network access')
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (url.pathname.endsWith('/consume_developer_budget')) return Response.json({ allowed: budget })
    if (url.pathname.endsWith('/authenticate_developer_request')) {
      assert.equal(body.key_id, key.id)
      assert.equal(body.presented_digest, key.digest)
      return Response.json(revoked ? { error: 'invalid_api_key' } : {
        actor_id: currentActor, credential_id: credentialId, owner_user_id: currentOwner, member_ids: [currentOwner, currentActor],
        permissions: permissions(), billing_access: { perpetual: paid }, budget: { allowed: budget },
      })
    }
    if (url.pathname.endsWith('/resolve_developer_access')) return Response.json({ owner_user_id: currentOwner,
      member_ids: [currentOwner, currentActor], billing_access: { perpetual: paid }, budget: { allowed: budget } })
    if (url.pathname.endsWith('/storage_execute_v1')) {
      const header = JSON.parse(new Headers(init?.headers).get('x-holo-audit-context')!)
      assert.deepEqual(header.actor, { kind: 'user', userId: currentActor })
      assert.equal(header.clientId, credentialId)
      assert.equal(body.owner_id, currentOwner)
      assert.ok(init?.signal instanceof AbortSignal)
      if ('operationId' in body.request) {
        assert.equal(header.operationId, body.request.operationId)
        assert.equal(header.batchId, body.request.operationId)
      }
      calls.push({ ...body, header })
      if (error) return Response.json({ code: error, message: 'private certificate SQL details', details: 'private' }, { status: 400 })
      const operation = body.operation as string, request = body.request
      let result: unknown
      if (operation.includes('preview')) result = { planVersion: operation.endsWith('v2') ? 2 : 1, eventId: request.eventId,
        supported: false, unsupported: ['synthetic unsupported dependency'], conflicts: [], changes: privatePreview ? [{ certificate: 'private' }] : [],
        restoreUnassignedItemIds: [], rootRevisionsAdvance: true, planToken: null }
      else if (operation.includes('apply')) result = { inventoryRevision: 2, eventId: '13', recoveredEventId: request.eventId, collections: [] }
      else if (operation === 'backup.arrangement') result = { inventoryRevision: 2, changed: true, collectionId: request.destinationCollectionId, collectionVersion: 1, layoutRevision: 1, slotIds: request.slots.map((s: { id: string }) => s.id), addedItemIds: [], removedEmptySlotIds: [], evidence: 'private' }
      else if (operation === 'collection.create') result = { inventoryRevision: 2, changed: true, collectionId: request.collectionId,
        collectionVersion: 0, layoutRevision: 0, slotIds: request.slotIds, recoverySupported: false, evidence: { certificate: 'private' } }
      else if (operation === 'slots') result = { inventoryRevision: 2, changed: true, collectionVersion: 1, layoutRevision: 1, removedSlotIds: [], evidence: 'private' }
      else result = { inventoryRevision: 2, changed: true, selectedItemIds: ['synthetic-copy'], acquiredItemIds: [], evidence: 'private' }
      if (forged !== undefined) return Response.json(forged)
      if (terminal && ['slots', 'inventory'].includes(operation)) result = { outcome: 'rejected', operationId: request.operationId, code: 'slot_revision_conflict', inventoryRevision: 2 }
      // Emulates the backend ledger only to prove exact forwarding/replay through both transports.
      if (request.operationId) {
        const ledgerKey = currentActor + ':' + request.operationId
        const serialized = JSON.stringify({ ...body, header: { ...header, operationId: request.operationId } })
        const previous = ledger.get(ledgerKey)
        if (previous && previous.body !== serialized) return Response.json({ code: '40001', message: 'private ledger mismatch' }, { status: 400 })
        if (previous) result = previous.result
        else ledger.set(ledgerKey, { body: serialized, result })
      }
      if (loseReply) { loseReply = false; throw new Error('synthetic lost reply after commit') }
      return Response.json(result)
    }
    if (url.pathname.endsWith('/collection_recovery_v1')) {
      return Response.json(body.operation === 'apply' ? { eventId: '13', recoveredEventId: body.request.eventId }
        : { planVersion: 1, eventId: body.request.eventId, supported: true, unsupported: [], conflicts: [], changes: [], planToken: 'c'.repeat(64), restoreUnassignedItemIds: [], rootRevisionsAdvance: false })
    }
    throw new Error('Unexpected dependency ' + url.pathname)
  }
  const { handleRestRequest } = await import('../../lib/server/developer-access/http')
  const { handleMcpRequest } = await import('../../lib/server/mcp/http')
  const { NATIVE_DEVELOPER_OPERATIONS } = await import('../../lib/developer-api/storage')
  const { DEVELOPER_OPERATIONS } = await import('../../lib/developer-api/operations')
  const collectionId = '00830000-0000-4000-8000-000000000011'
  const inventory = { operationId: 'synthetic-inventory-1', inventoryRevision: 1, collections: [], commands: [
    { kind: 'add', itemId: 'synthetic-copy', identity: { kind: 'pokemon', pokemonId: 1 }, grading: null, acquiredAt: null }] }
  const slots = { operationId: 'synthetic-slots-1', inventoryRevision: 1, collectionId, collectionVersion: 0, layoutRevision: 0,
    commands: [{ kind: 'create', ids: ['synthetic-slot'], beforeSlotId: null }] }
  const creation = { version: 1, operationId: 'synthetic-creation-1', inventoryRevision: 1, collectionId, name: 'Synthetic binder',
    kind: 'binder', defaultPresentation: 'binder', location: null, grid: null,
    manifest: { source: { id: 'synthetic', version: '1' }, name: 'Synthetic targets', entries: [{ id: 'synthetic-entry', target: { kind: 'pokemon', pokemonId: 1 } }] }, slotIds: ['synthetic-slot'] }
  const preview = { eventId: '12', restoreUnassignedItemIds: [] }
  const apply = { ...preview, operationId: 'synthetic-recovery-1', planVersion: 1, planToken: 'a'.repeat(64), confirmed: true }
  const v2 = { ...preview, planVersion: 2, replacementDefaultCollectionId: collectionId, inventoryRevision: 1, collections: [{ collectionId, version: 0, layoutRevision: 0 }] }
  const arrangement = { version: 1, operationId: 'synthetic-arrangement-1', inventoryRevision: 1, destinationCollectionId: collectionId,
    collections: [{ collectionId, version: 0, layoutRevision: 0 }], emptyDestinationSlots: [], manifest: null, copies: [],
    slots: [{ id: 'synthetic-import-slot', target: null, status: null, wantedCards: [], inventoryItemId: null, presetOrigin: null }] }
  const values: Record<string, Record<string, unknown>> = { import_storage_arrangement: arrangement, execute_inventory_commands: inventory, execute_slot_commands: slots, create_storage_collection: creation,
    preview_storage_recovery: preview, apply_storage_recovery: apply, preview_storage_recovery_v2: v2,
    apply_storage_recovery_v2: { ...v2, operationId: 'synthetic-recovery-v2', planToken: 'b'.repeat(64), confirmed: true } }
  async function call(transport: 'rest' | 'mcp', name: string, value: unknown) {
    const op = DEVELOPER_OPERATIONS.find(op => op.name === name)!
    const headers = { 'Content-Type': 'application/json', authorization: 'Bearer ' + (transport === 'rest' ? key.key : 'synthetic-oauth'),
      'x-holo-audit-context': JSON.stringify({ actor: { kind: 'user', userId: owner }, source: 'migration' }), Accept: 'application/json, text/event-stream' }
    const response = transport === 'rest' ? await handleRestRequest(new Request('https://synthetic.test/app/api/v1' + op.path, { method: 'POST', headers, body: JSON.stringify(value) }), { params: Promise.resolve({ path: op.path.slice(1).split('/') }) })
      : await handleMcpRequest(new Request('https://synthetic.test/app/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: value } }) }))
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    const raw = await response.json()
    const result = transport === 'mcp' && raw.result ? raw.result.structuredContent : raw
    return { status: response.status, result, raw }
  }
  const listingResponse = await handleMcpRequest(new Request('https://synthetic.test/app/mcp', { method: 'POST',
    headers: { authorization: 'Bearer synthetic-oauth', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }))
  const tools = (await listingResponse.json()).result.tools
  const { z } = await import('zod')
  for (const op of NATIVE_DEVELOPER_OPERATIONS) {
    const tool = tools.find((tool: { name: string }) => tool.name === op.name)
    assert.deepEqual(tool.outputSchema, z.toJSONSchema(op.responseSchema!), 'discovery advertises the exact accepted receipt')
    if (op.errorSchemas) assert.deepEqual(tool._meta['holofolder.com/errorSchemas']['409'], z.toJSONSchema(op.errorSchemas[409]!))
  }
  const paddedLegacy = await handleMcpRequest(new Request('https://synthetic.test/app/mcp', { method: 'POST', headers: { authorization: 'Bearer synthetic-oauth', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'preview_collection_recovery', arguments: { eventId: '12' } } }) + ' '.repeat(131072) }))
  assert.equal(paddedLegacy.status, 413, 'legacy MCP framing keeps its actual-byte limit, including whitespace')
  for (const transport of ['rest', 'mcp'] as const) {
    const legacyPreview = await call(transport, 'preview_collection_recovery', { eventId: '12' })
    assert.equal(legacyPreview.result.supported, true, JSON.stringify(legacyPreview.raw))
    assert.equal(legacyPreview.result.rootRevisionsAdvance, false)
    const legacyApply = await call(transport, 'apply_collection_recovery', apply)
    assert.deepEqual(legacyApply.result, { eventId: '13', recoveredEventId: '12' })
    for (const op of NATIVE_DEVELOPER_OPERATIONS) {
      // Different sources intentionally use different operation IDs; a cross-source replay must conflict.
      const value = { ...values[op.name] }
      if ('operationId' in value) value.operationId += '-' + transport
      const first = await call(transport, op.name, value)
      if (!wired) {
        assertStagedSmokeResponse(op.name, first.result)
        assert.equal(first.status, transport === 'rest' ? 503 : 200)
        if (transport === 'mcp') assert.equal(first.raw.result.isError, true)
      }
      else {
        assert.equal(first.status, 200, JSON.stringify(first.raw))
        assertSmokeResponse(op.name, first.result, value)
        assert.equal(first.result.error, undefined, JSON.stringify(first.raw))
        assert.equal(JSON.stringify(first.result).includes('private'), false)
        assert.equal(calls.at(-1)?.header.source, transport)
        assert.deepEqual(calls.at(-1)?.request, value)
        if ('operationId' in value) {
          const retry = await call(transport, op.name, value)
          assert.deepEqual(retry.result, first.result)
          const conflict = await call(transport, op.name, { ...value, ...('inventoryRevision' in value ? { inventoryRevision: 0 } : { eventId: '11' }) })
          assert.equal(conflict.result.error.code, 'storage_conflict')
        }
      }
    }
    if (wired) for (const [name, intent] of [['execute_slot_commands', slots], ['execute_inventory_commands', inventory]] as const) {
      const value = { ...intent, operationId: 'synthetic-terminal-' + name + '-' + transport }
      terminal = true
      const rejected = await call(transport, name, value)
      const proof = { outcome: 'rejected', operationId: value.operationId, code: 'slot_revision_conflict', inventoryRevision: 2 }
      assert.equal(rejected.status, transport === 'rest' ? 409 : 200)
      assert.equal(rejected.result.error.code, 'storage_command_rejected', JSON.stringify(rejected.raw))
      assert.deepEqual(rejected.result.error.rejection, proof)
      const op = DEVELOPER_OPERATIONS.find(op => op.name === name)!
      assert.ok(op.errorSchemas?.[409]?.safeParse(rejected.result).success)
      assertTerminalStorageSmokeResponse(name, rejected.result, value)
      assert.throws(() => assertSmokeResponse(name, rejected.result, value))
      assert.throws(() => assertTerminalStorageSmokeResponse(name, rejected.result, { ...value, operationId: 'synthetic-wrong' }))
      assert.equal(op.responseSchema!.safeParse(rejected.result).success, false)
      if (transport === 'mcp') {
        assert.equal(rejected.raw.result.isError, true)
        assert.deepEqual(JSON.parse(rejected.raw.result.content[0].text), rejected.result)
      }
      assert.deepEqual(Object.keys(rejected.result.error).sort(), ['code', 'message', 'rejection', 'requestId'])
      terminal = false
      const replay = await call(transport, name, value)
      assert.deepEqual(replay.result.error.rejection, proof, 'terminal replay remains rejected after predicates change')
      const changed = await call(transport, name, { ...value, inventoryRevision: 0 })
      assert.equal(changed.result.error.code, 'storage_conflict')
      assert.equal(changed.result.error.rejection, undefined)
      const differentId = await call(transport, name, { ...value, operationId: value.operationId + '-new' })
      assert.equal(differentId.result.error, undefined, 'a new ID never borrows terminal proof')
      for (const change of ['credential', 'owner', 'source'] as const) {
        const oldCredential = credentialId, oldOwner = currentOwner
        if (change === 'credential') credentialId = 'synthetic-other-credential'
        if (change === 'owner') currentOwner = actor
        const changedScope = await call(change === 'source' ? (transport === 'rest' ? 'mcp' : 'rest') : transport, name, value)
        assert.equal(changedScope.result.error.code, 'storage_conflict')
        assert.equal(changedScope.result.error.rejection, undefined)
        credentialId = oldCredential; currentOwner = oldOwner
      }
      currentActor = owner
      const anotherActor = await call(transport, name, value)
      assert.equal(anotherActor.result.error, undefined, 'another actor cannot borrow a terminal receipt')
      currentActor = actor
      const beforeDenial = calls.length
      for (const denial of ['readonly', 'unpaid', 'revoked', 'budget'] as const) {
        readonly = denial === 'readonly'; paid = denial !== 'unpaid'; revoked = denial === 'revoked'; budget = denial !== 'budget'
        const denied = await call(transport, name, value)
        assert.ok(denied.result.error)
        assert.equal(denied.result.error.rejection, undefined, 'current authority precedes replay data')
      }
      readonly = false; paid = true; revoked = false; budget = true
      assert.equal(calls.length, beforeDenial)
      terminal = true; loseReply = true
      const lostRejectionIntent = { ...value, operationId: value.operationId + '-lost-rejection' }
      const lostRejection = await call(transport, name, lostRejectionIntent)
      assert.equal(lostRejection.result.error.rejection, undefined)
      terminal = false
      const rejectionRetry = await call(transport, name, lostRejectionIntent)
      assert.deepEqual(rejectionRetry.result.error.rejection, { ...proof, operationId: lostRejectionIntent.operationId })
      for (const invalid of [
        null, { inventoryRevision: 0 }, { code: 'storage_conflict', message: 'private arbitrary 409' },
        { ...proof, operationId: 'synthetic-forged-id' }, { ...proof, code: 'private_unknown' },
        { ...proof, inventoryRevision: -1 }, { ...proof, inventoryRevision: Number.MAX_SAFE_INTEGER + 1 },
        { ...proof, certificate: 'private' }, { ...proof, outcome: 'accepted' },
        { ...proof, changed: true, selectedItemIds: [], acquiredItemIds: [], collectionVersion: 1, layoutRevision: 1, removedSlotIds: [] },
      ]) {
        forged = invalid
        const malformed = await call(transport, name, value)
        assert.equal(malformed.result.error.code, 'storage_unavailable', JSON.stringify(malformed.raw))
        assert.equal(malformed.result.error.rejection, undefined)
        assert.equal(JSON.stringify(malformed.result).includes('private'), false)
      }
      forged = undefined
      for (const code of ['40001', '23505', '57014', 'XX000', '409']) {
        error = code
        const unknown = await call(transport, name, value)
        assert.equal(unknown.result.error.rejection, undefined)
        assert.equal(unknown.result.error.code, ['40001', '23505'].includes(code) ? 'storage_conflict' : 'storage_unavailable')
      }
      error = null
      loseReply = true
      const lost = await call(transport, name, { ...value, operationId: value.operationId + '-lost' })
      assert.equal(lost.result.error.rejection, undefined)
      const retried = await call(transport, name, { ...value, operationId: value.operationId + '-lost' })
      assert.equal(retried.result.error, undefined, 'unknown lost reply retains original accepted replay')
    }
    // Assertion mode reaches the existing executor as the same canonical intent, with no reads/reconstruction.
    const emptySlot = { id: 'synthetic-destination', version: 3, inventoryItemId: null, itemVersion: null, placementVersion: null }
    const placedSlot = { id: 'synthetic-source', version: 2, inventoryItemId: 'synthetic-private-copy', itemVersion: 5, placementVersion: 4 }
    const placedItem = { itemId: 'synthetic-private-copy', itemVersion: 5, placement: { collectionId, slot: placedSlot } }
    const safeInventory = { operationId: 'synthetic-preserve-' + transport, inventoryRevision: 7,
      collections: [{ collectionId, version: 2, layoutRevision: 1 }], commands: [{ kind: 'move', item: placedItem,
        destination: { collectionId, slot: emptySlot }, occupied: 'cancel', fulfillWant: null }] }
    const safeSlots = { ...slots, operationId: 'synthetic-target-' + transport,
      commands: [{ kind: 'update', slot: emptySlot, target: null }] }
    for (const [name, intent] of [['execute_inventory_commands', safeInventory], ['execute_slot_commands', safeSlots]] as const) {
      const preserving = { ...intent, privateFields: 'preserve', expectedOwnerUserId: owner }
      if (wired) loseReply = true
      const lost = await call(transport, name, preserving)
      assert.ok(lost.result?.error || lost.raw.error || lost.raw.result?.isError)
      if (wired) {
        assert.deepEqual(calls.at(-1)?.request, intent, 'assertion is removed without adding private defaults')
        // A different later operation succeeds. Retrying the original must still send exactly the old intent.
        const later = await call(transport, name, { ...preserving, operationId: intent.operationId + '-later', inventoryRevision: 8 })
        assert.equal(later.result.error, undefined)
        const retry = await call(transport, name, preserving)
        assert.equal(retry.result.error, undefined, JSON.stringify(retry.raw))
        assert.deepEqual(calls.at(-1)?.request, intent)
        const compatibility = await call(transport, name, intent)
        assert.deepEqual(compatibility.result, retry.result, 'legacy mode has identical canonical ledger identity')
        const explicitReplacement = await call(transport, name, { ...intent, privateFields: 'replace' })
        assert.deepEqual(explicitReplacement.result, retry.result)
        const changed = await call(transport, name, { ...preserving, inventoryRevision: 8 })
        assert.equal(changed.result.error.code, 'storage_conflict', 'never refresh preconditions on retry')
        currentOwner = actor
        const beforeOwnerMismatch = calls.length
        const firstWrongRecipient = await call(transport, name, { ...preserving, operationId: intent.operationId + '-uncommitted' })
        assert.equal(firstWrongRecipient.result.error.code, 'storage_owner_changed')
        const changedRecipient = await call(transport, name, preserving)
        assert.equal(changedRecipient.result.error.code, 'storage_owner_changed', 'same operation must not retarget another owner')
        assert.equal(calls.length, beforeOwnerMismatch, 'recipient is fenced before SQL, including an uncommitted unknown outcome')
        currentOwner = owner
      } else assert.equal(lost.result.error.code, 'native_operations_staged')
    }
    for (const [index, commands] of [
      [{ kind: 'patchGrading', item: placedItem, patch: { grade: null, labelVariant: 'Synthetic new label' } }],
      [{ ...safeInventory.commands[0], fulfillWant: { index: 1, expectedPublic: { card_id: 'synthetic-card', card_name: 'Synthetic', added_at: '2020-01-01' } } }],
    ].entries()) {
      const originalIntent = { ...safeInventory, commands, operationId: 'synthetic-transactional-patch-' + transport + '-' + index }
      const supplied = { ...originalIntent, privateFields: 'preserve', expectedOwnerUserId: owner }
      const result = await call(transport, 'execute_inventory_commands', supplied)
      if (wired) {
        assert.equal(result.result.error, undefined)
        assert.deepEqual(calls.at(-1)?.request, originalIntent, 'both transports forward original public intent, never reconstructed private JSON')
        const replay = await call(transport, 'execute_inventory_commands', supplied)
        assert.deepEqual(replay.result, result.result)
      } else assert.equal(result.result.error.code, 'native_operations_staged')
    }
    const unsupported = [
      ['execute_inventory_commands', { ...safeInventory, commands: [{ kind: 'edit', item: placedItem, grading: null }] }],
      ['execute_inventory_commands', { ...safeInventory, commands: [{ ...safeInventory.commands[0], fulfillWant: { index: 0, expected: { card_id: 'synthetic-card', card_name: 'Synthetic', added_at: '2020-01-01' } } }] }],
      ['execute_slot_commands', { ...safeSlots, commands: [{ kind: 'update', slot: emptySlot, wantedCards: [] }] }],
    ] as const
    const beforeUnsupported = calls.length
    for (const [name, value] of unsupported) {
      const rejected = await call(transport, name, { ...value, privateFields: 'preserve', expectedOwnerUserId: owner })
      assert.ok(rejected.result?.error || rejected.raw.error || rejected.raw.result?.isError)
    }
    assert.equal(calls.length, beforeUnsupported, 'unsafe redacted replacement never reaches the executor')
    if (wired) for (const [index, [name, value]] of unsupported.entries()) {
      const replacement = { ...value, operationId: 'synthetic-explicit-replace-' + transport + '-' + index }
      const accepted = await call(transport, name, { ...replacement, privateFields: 'replace' })
      assert.equal(accepted.result.error, undefined, 'explicit clearing/full expected want keeps existing authorization and SQL semantics')
      assert.deepEqual(calls.at(-1)?.request, replacement)
    }
    const before = calls.length
    for (const [changes, expected] of [[{ readonly: true }, 'insufficient_permissions'], [{ paid: false }, 'premium_required'], [{ revoked: true }, transport === 'rest' ? 'invalid_api_key' : 'oauth_revoked'], [{ budget: false }, 'rate_limited']] as const) {
      readonly = 'readonly' in changes; paid = !('paid' in changes); revoked = 'revoked' in changes; budget = !('budget' in changes)
      const result = await call(transport, 'execute_inventory_commands', { ...inventory, privateFields: 'preserve', expectedOwnerUserId: owner })
      assert.equal(result.result.error?.code, expected, JSON.stringify(result.raw))
    }
    readonly = false; paid = true; revoked = false; budget = true
    for (const scope of ['collection:write', 'binders:write', 'collection:read'] as const) {
      missingScope = scope
      const denied = await call(transport, scope === 'collection:read' ? 'preview_storage_recovery' : 'execute_inventory_commands', scope === 'collection:read' ? preview : inventory)
      assert.equal(denied.result.error.code, 'insufficient_permissions')
    }
    missingScope = null
    for (const value of [{ ...slots, ownerId: owner }, { ...slots, inventoryRevision: -1 }, { ...slots, layoutRevision: undefined }, { ...slots, cursor: 'partial' }, { ...apply, confirmed: false }]) {
      const result = await call(transport, 'execute_slot_commands', value)
      assert.ok(result.result?.error || result.raw.error || result.raw.result?.isError, JSON.stringify(result.raw))
    }
    assert.equal(calls.length, before, 'denial and malformed intent cannot reach execution')
    // The real REST stream and JSON-RPC envelope both admit the documented larger intent.
    const largeCreation = { ...creation, operationId: 'synthetic-dex-' + transport,
      manifest: { ...creation.manifest, entries: Array.from({ length: 1025 }, (_, i) => ({ id: 'synthetic-entry-' + i, target: { kind: 'pokemon', pokemonId: i + 1 } })) },
      slotIds: Array.from({ length: 1025 }, (_, i) => 'synthetic-slot-' + i) }
    assert.ok(Buffer.byteLength(JSON.stringify(largeCreation)) > 65536)
    const large = await call(transport, 'create_storage_collection', largeCreation)
    assert.equal(large.result.error?.code, wired ? undefined : 'native_operations_staged', JSON.stringify(large.raw))
    if (wired) {
      for (const [sql, expected] of [['40001', 'storage_conflict'], ['42501', 'storage_access_denied'], ['HF402', 'premium_required'], ['0A000', 'recovery_unsupported'], ['22023', 'invalid_input'], ['XX000', 'storage_unavailable']]) {
        error = sql
        const result = await call(transport, 'execute_inventory_commands', inventory)
        assert.equal(result.result.error.code, expected)
        assert.equal(JSON.stringify(result.result).includes('private'), false)
      }
      error = null
      privatePreview = true
      const result = await call(transport, 'preview_storage_recovery', preview)
      assert.equal(result.result.error.code, 'storage_unavailable')
      privatePreview = false
      currentActor = owner; currentOwner = owner
      const own = await call(transport, 'execute_inventory_commands', { ...inventory, operationId: 'synthetic-owner-' + transport })
      assert.equal(own.result.error, undefined)
      currentActor = actor; currentOwner = actor
      const changedScope = await call(transport, 'execute_inventory_commands', { ...inventory, operationId: 'synthetic-unlinked-' + transport })
      assert.equal(changedScope.result.error, undefined)
      assert.equal(calls.at(-1)?.header.source, transport)
      currentOwner = owner
    }
  }
  if (!wired) assert.equal(calls.length, 0, 'production gate never invokes the executor')
  console.log(wired ? 'wired synthetic transports passed' : 'fixed admission passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
