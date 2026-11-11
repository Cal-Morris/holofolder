import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBulkSelection } from '@/lib/binder-bulk-editing';
import { previewBulkFill, prepareBulkFillIntent, automaticBulkFillChoices, isFillSpacer } from '@/lib/binder-bulk-fill';
import { syntheticSlotPickerSnapshot } from './fixtures/slot-picker';
import { pickerCandidate } from '@/lib/slot-picker';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';

const context = {
  source: 'app' as const,
  clientId: null,
  operationId: 'bulk-fill-operation',
  batchId: null,
  clientOccurredAt: '2026-11-10T00:00:00Z',
};
function setup() {
  const { inventory: snapshot, cards } = syntheticSlotPickerSnapshot();
  const scope = { ownerUserId: snapshot.ownerUserId, collectionId: snapshot.binders[0].collectionId, slotId: null };
  const catalog = (id: string) => {
    const c = cards.find((c) => c.id === id);
    return c ? pickerCandidate(c) : undefined;
  };
  const source = snapshot.items.find((i) => i.id === 'unassigned-a')!;
  source.identity = { kind: 'card', cardId: 'synthetic-snorlax-a', language: 'en', finish: 'holo' };
  snapshot.items.find((i) => i.id === 'unassigned-b')!.identity = structuredClone(source.identity);
  snapshot.binders[0].slots[4].target = { kind: 'card', cardId: 'synthetic-snorlax-a', language: 'en', finish: 'holo' };
  snapshot.binders[0].slots[5].target = { kind: 'pokemon', pokemonId: 143 };
  snapshot.binders[0].slots[6].target = null;
  const selection = captureBulkSelection(snapshot, scope, ['slot-g', 'slot-f', 'slot-e']);
  return { snapshot, scope, catalog, selection };
}
test('manual pairing uses saved destination order and distinct actual copy IDs in one atomic request', () => {
  const { snapshot, scope, catalog, selection } = setup();
  const choices = { 'slot-e': 'unassigned-b', 'slot-f': 'unassigned-a', 'slot-g': 'unassigned-grade' };
  const before = structuredClone(snapshot);
  const preview = previewBulkFill(snapshot, scope, selection, choices, catalog);
  assert.equal(preview.ready, true);
  assert.deepEqual(
    preview.rows.map((r) => r.slotId),
    ['slot-e', 'slot-f', 'slot-g'],
  );
  const draft = prepareBulkFillIntent(snapshot, scope, selection, choices, context, catalog);
  assert.equal(draft.intent.kind, 'inventory');
  assert.deepEqual(
    draft.intent.request.commands.map((c) => c.kind),
    ['assign', 'assign', 'assign'],
  );
  const after = projectSlotIntent(snapshot, draft.intent, catalog);
  assert.deepEqual(after.items, snapshot.items);
  assert.equal(after.placements.length, snapshot.placements.length + 3);
  assert.deepEqual(snapshot, before);
});
test('automatic matching is opt-in, exact language/finish, each recorded Unassigned copy once; free stays explicit', () => {
  const { snapshot, scope, catalog, selection } = setup();
  const choices = automaticBulkFillChoices(snapshot, scope, selection, catalog);
  assert.deepEqual(choices, { 'slot-e': 'unassigned-a', 'slot-f': 'unassigned-b' });
  const preview = previewBulkFill(snapshot, scope, selection, choices, catalog);
  assert.equal(preview.ready, false);
  assert.match(preview.rows[2].reason!, /Choose/);
  snapshot.items.find((i) => i.id === 'unassigned-a')!.identity = {
    kind: 'card',
    cardId: 'synthetic-snorlax-a',
    language: 'ja',
    finish: 'holo',
  };
  assert.equal(automaticBulkFillChoices(snapshot, scope, selection, catalog)['slot-e'], 'unassigned-b');
});
test('mixed occupied, mismatch, missing and assigned copies are visible refusals, never overwrite or move', () => {
  const { snapshot, scope, catalog } = setup();
  const selection = captureBulkSelection(snapshot, scope, ['slot-a', 'slot-e', 'slot-f', 'slot-g']);
  const choices = {
    'slot-a': 'unassigned-b',
    'slot-e': 'unassigned-grade',
    'slot-f': 'missing',
    'slot-g': snapshot.items[0].id,
  };
  const result = previewBulkFill(snapshot, scope, selection, choices, catalog);
  assert.equal(result.ready, false);
  assert.match(result.rows[0].reason!, /Occupied/);
  assert.match(result.rows[1].reason!, /match/);
  assert.match(result.rows[2].reason!, /unavailable/);
  assert.match(result.rows[3].reason!, /assigned/);
  assert.throws(() => prepareBulkFillIntent(snapshot, scope, selection, choices, context, catalog));
});
test('duplicate copy choices, unresolved catalog, empty selections and stale evidence never hand off', () => {
  const { snapshot, scope, catalog, selection } = setup();
  const choices = { 'slot-e': 'unassigned-a', 'slot-f': 'unassigned-a', 'slot-g': 'unassigned-b' };
  assert.equal(previewBulkFill(snapshot, scope, selection, choices, catalog).ready, false);
  assert.throws(() => prepareBulkFillIntent(snapshot, scope, selection, choices, context, catalog));
  assert.equal(previewBulkFill(snapshot, scope, selection, choices, () => undefined).ready, false);
  assert.equal(previewBulkFill(snapshot, scope, captureBulkSelection(snapshot, scope, []), {}, catalog).ready, false);
  snapshot.inventoryRevision++;
  assert.throws(() => prepareBulkFillIntent(snapshot, scope, selection, choices, context, catalog), /review/);
});
test('copied explicit preset spacers are excluded, ordinary free pockets require manual choices', () => {
  const { snapshot, scope, catalog } = setup();
  const binder = snapshot.binders[0];
  const source = { id: 'synthetic', version: '1' };
  binder.presetManifest = { source, name: 'Synthetic', entries: [{ id: 'gap', target: null }] };
  binder.slots[6].presetOrigin = { source, entryId: 'gap' };
  assert.equal(isFillSpacer(binder, binder.slots[6]), true);
  const selection = captureBulkSelection(snapshot, scope, ['slot-g']);
  assert.match(
    previewBulkFill(snapshot, scope, selection, { 'slot-g': 'unassigned-a' }, catalog).rows[0].reason!,
    /Spacer/,
  );
});
test('command/work/byte bounds reject whole group with smaller-selection guidance, no split', () => {
  const { snapshot, scope, catalog } = setup();
  const free = snapshot.binders[0].slots[6],
    item = snapshot.items.find((i) => i.id === 'unassigned-a')!;
  const choices: Record<string, string> = {};
  for (let i = 0; i < 101; i++) {
    const id = `bulk-destination-${i}`,
      copyId = `bulk-copy-${i}`;
    snapshot.binders[0].slots.push({ ...free, id });
    snapshot.items.push({ ...item, id: copyId });
    choices[id] = copyId;
  }
  const selection = captureBulkSelection(snapshot, scope, Object.keys(choices));
  assert.match(previewBulkFill(snapshot, scope, selection, choices, catalog).error!, /smaller selection/);
  assert.throws(() => prepareBulkFillIntent(snapshot, scope, selection, choices, context, catalog));
  delete choices['bulk-destination-100'];
  const bounded = captureBulkSelection(snapshot, scope, Object.keys(choices));
  assert.equal(
    prepareBulkFillIntent(snapshot, scope, bounded, choices, context, catalog).intent.request.commands.length,
    100,
  );
  assert.throws(() =>
    prepareBulkFillIntent(snapshot, scope, bounded, choices, { ...context, clientId: 'x'.repeat(300000) }, catalog),
  );
});
test('explicit skipped destinations do not consume mutation commands or silently disappear from review', () => {
  const { snapshot, scope, catalog } = setup();
  const free = snapshot.binders[0].slots[6];
  const choices: Record<string, string | null> = { 'slot-g': 'unassigned-a' };
  for (let i = 0; i < 100; i++) {
    const id = `skip-${i}`;
    snapshot.binders[0].slots.push({ ...free, id });
    choices[id] = null;
  }
  const selection = captureBulkSelection(snapshot, scope, Object.keys(choices));
  const preview = previewBulkFill(snapshot, scope, selection, choices, catalog);
  assert.equal(preview.rows.length, 101);
  assert.equal(preview.ready, true);
  assert.equal(
    prepareBulkFillIntent(snapshot, scope, selection, choices, context, catalog).intent.request.commands.length,
    1,
  );
});

test('a target edited from a copied spacer uses its current target for manual and automatic fill', () => {
  const { snapshot, scope, catalog } = setup();
  const binder = snapshot.binders[0],
    slot = binder.slots[6];
  const source = { id: 'synthetic', version: '1' };
  binder.presetManifest = { source, name: 'Synthetic', entries: [{ id: 'original-gap', target: null }] };
  slot.presetOrigin = { source, entryId: 'original-gap' };
  slot.target = { kind: 'pokemon', pokemonId: 143 };
  const selection = captureBulkSelection(snapshot, scope, [slot.id]);
  assert.equal(isFillSpacer(binder, slot), false);
  const choices = automaticBulkFillChoices(snapshot, scope, selection, catalog);
  assert.deepEqual(choices, { [slot.id]: 'unassigned-a' });
  assert.equal(previewBulkFill(snapshot, scope, selection, choices, catalog).ready, true);
  const draft = prepareBulkFillIntent(snapshot, scope, selection, { [slot.id]: 'unassigned-a' }, context, catalog);
  assert.equal(
    projectSlotIntent(snapshot, draft.intent, catalog).placements.find((p) => p.slotId === slot.id)?.inventoryItemId,
    'unassigned-a',
  );
  assert.equal(binder.presetManifest.entries[0].target, null);
});
