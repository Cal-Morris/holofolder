import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations';
import { includeFlag, withoutDuplicateTcgdexRest, auditEventSummary } from '@/lib/developer-api/lean';

test('include flags default on over REST and off over MCP; an explicit value wins', () => {
  assert.equal(includeFlag('rest', {}, 'includeDetails'), true);
  assert.equal(includeFlag('mcp', {}, 'includeDetails'), false);
  assert.equal(includeFlag('rest', { includeDetails: false }, 'includeDetails'), false);
  assert.equal(includeFlag('mcp', { includeDetails: true }, 'includeDetails'), true);
});

test('REST and MCP dispatch apply each include default per surface (synthetic data)', () => {
  execFileSync(process.execPath, [new URL('./fixtures/lean-developer-responses.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});

test('the synced tcgdex_rest copy is dropped only when it is exactly the top-level record', () => {
  const card = { id: 'synthetic-1', name: { en: 'Synthetic' }, attacks: [{ cost: ['Fire'] }] };
  const other = { cardId: 'synthetic-pokemontcg' };
  assert.deepEqual(
    withoutDuplicateTcgdexRest({ ...card, supplementalSources: { tcgdex_rest: card, pokemon_tcg: other } }),
    { ...card, supplementalSources: { pokemon_tcg: other } },
  );
  const drifted = { ...card, supplementalSources: { tcgdex_rest: { ...card, hp: 60 } } };
  assert.equal(withoutDuplicateTcgdexRest(drifted), drifted, 'a differing copy is kept');
  const plain = { ...card, supplementalSources: { tcgcsv: other } };
  assert.equal(withoutDuplicateTcgdexRest(plain), plain);
});

test('an audit summary counts changes and names only fields that changed', () => {
  assert.deepEqual(
    auditEventSummary({
      id: '1',
      changes: [
        { table: 'inventory_items', id: 'a', before: { finish: 'normal', grade: null }, after: null },
        { table: 'binder_slots', id: 'b', before: { target: 'x', note: 'same' }, after: { target: 'y', note: 'same' } },
      ],
    }),
    { id: '1', changeCount: 2, changedFields: ['finish', 'grade', 'target'] },
  );
});

test('include flags are optional booleans on exactly the lean operations', () => {
  const flags: Record<string, string> = {
    list_cards: 'includeDetails',
    get_card: 'includeDetails',
    get_similar_cards: 'includeDetails',
    suggest_cards: 'includeDetails',
    identify_card: 'includeDetails',
    get_set: 'includeRaw',
    get_series: 'includeRaw',
    get_prices: 'includeHistory',
    refresh_prices: 'includeHistory',
    check_deal: 'includeHistory',
    get_price_checks: 'includeItems',
    refresh_price_checks: 'includeItems',
    list_collection_audit: 'includeChanges',
  };
  for (const op of DEVELOPER_OPERATIONS) {
    const shape = 'shape' in op.schema ? (op.schema.shape as Record<string, unknown>) : {};
    const present = Object.keys(shape).filter((key) => /^include[A-Z]/.test(key));
    assert.deepEqual(present, flags[op.name] ? [flags[op.name]] : [], op.name);
  }
  const audit = DEVELOPER_OPERATIONS.find((op) => op.name === 'list_collection_audit')!.schema;
  assert.equal(audit.safeParse({ includeChanges: 'yes' }).success, false);
  assert.equal(audit.safeParse({ includeChanges: false }).success, true);
});
