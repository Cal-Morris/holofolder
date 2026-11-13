import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureScanDestination,
  mapScanCells,
  planPageFill,
  prepareScanDraft,
  scanDestinations,
  scanShowsDifferentCard,
} from '@/lib/scan-destinations';
import { syntheticSlotPickerSnapshot } from './fixtures/slot-picker';
import { pickerCandidate } from '@/lib/slot-picker';
import { parseInventoryCommand } from '@/lib/domain/inventory-commands';

/** storage_execute_v1 rejects a request that names one item or slot in two commands (invalid_inventory_repeated_entity). */
function assertEachEntityOnce(commands: readonly object[]) {
  const seen = new Set<string>();
  for (const command of commands) {
    const ids = new Set<string>();
    JSON.stringify(command, (key, value) => {
      if (typeof value === 'string' && ['itemId', 'inventoryItemId', 'newItemId'].includes(key))
        ids.add(`item:${value}`);
      if (key === 'destination' && value?.slot?.id) ids.add(`slot:${value.slot.id}`);
      return value;
    });
    for (const id of ids) {
      assert.ok(!seen.has(id), `${id} is named by more than one command`);
      seen.add(id);
    }
  }
}

function setup() {
  const seed = syntheticSlotPickerSnapshot();
  const snapshot = seed.inventory;
  const binder = snapshot.binders[0];
  // Synthetic empty repeated targets, an exact Trainer target and free cells.
  snapshot.items = [];
  snapshot.placements = [];
  binder.slots.forEach((s) => {
    s.inventoryItemId = null;
    s.status = null;
  });
  const view = {
    ownerUserId: snapshot.ownerUserId,
    collectionId: binder.collectionId,
    sessionId: 'session-a',
    rows: 2,
    cols: 4,
    pageSlotIds: binder.slots.map((s) => s.id),
  };
  const catalog = (id: string) => {
    const card = seed.cards.find((c) => c.id === id);
    return card ? pickerCandidate(card) : undefined;
  };
  const capture = captureScanDestination(snapshot, view);
  const context = {
    source: 'app' as const,
    clientId: null,
    operationId: 'synthetic-scan-operation',
    batchId: null,
    clientOccurredAt: null,
  };
  return { ...seed, snapshot, binder, view, catalog, capture, context };
}

test('maps shuffled detection cells to captured row/column IDs, occupancy alone has no card', () => {
  const s = setup();
  const mapped = mapScanCells(s.capture, [
    { index: 5, row: 1, col: 1, occupied: true },
    { index: 0, row: 0, col: 0, occupied: true },
  ]);
  assert.deepEqual(
    mapped.map((c) => c.slotId),
    ['slot-a', 'slot-f'],
  );
  assert.throws(() => prepareScanDraft(s.snapshot, s.view, s.capture, [], s.context, s.catalog), /unconfirmed/);
  assert.equal(s.snapshot.items.length, 0);
  assert.throws(() => mapScanCells(s.capture, [{ index: 0, row: 1, col: 0, occupied: true }]), /cell/);
});

test('rejects reordered, revision, grid, page and session/owner changes rather than positional retargeting', () => {
  for (const change of ['order', 'revision', 'grid', 'page', 'session', 'owner', 'collection'] as const) {
    const s = setup();
    if (change === 'order') s.binder.slots.reverse();
    if (change === 'revision') s.binder.layoutRevision++;
    if (change === 'grid') s.view.cols = 3;
    if (change === 'page') s.view.pageSlotIds.reverse();
    if (change === 'session') s.view.sessionId = 'session-b';
    if (change === 'owner') s.view.ownerUserId = 'other-owner';
    if (change === 'collection') s.view.collectionId = 'other-collection';
    assert.throws(
      () =>
        prepareScanDraft(
          s.snapshot,
          s.view,
          s.capture,
          [{ cellIndex: 0, slotId: 'slot-a', card: s.cards[0], copy: 'raw' }],
          s.context,
          s.catalog,
        ),
      /scan-stale/,
    );
  }
});

test('non-Pokémon Energy/supporter accept only explicit compatible targets/free slots', () => {
  const s = setup(),
    trainer = s.cards[2],
    energy = s.cards[3];
  assert.deepEqual(
    scanDestinations(s.snapshot, s.view, trainer).map((s) => s.id),
    ['slot-c', 'slot-d', 'slot-f', 'slot-g'],
  );
  assert.throws(
    () =>
      prepareScanDraft(
        s.snapshot,
        s.view,
        s.capture,
        [{ cellIndex: 0, slotId: 'slot-a', card: energy, copy: 'raw' }],
        s.context,
        s.catalog,
      ),
    /target-mismatch/,
  );
  const result = prepareScanDraft(
    s.snapshot,
    s.view,
    s.capture,
    [{ cellIndex: 0, slotId: 'slot-g', card: trainer, copy: 'raw' }],
    s.context,
    s.catalog,
  );
  assert.equal(result.preview.binders[0].slots.find((s) => s.id === 'slot-g')!.inventoryItemId !== null, true);
  assert.equal(s.snapshot.items.length, 0);
  assert.equal(result.preview.items.at(-1)!.grading, null);
});

test('repeated species require selected destination and batch cannot duplicate cells or slots', () => {
  const s = setup(),
    card = s.cards[0];
  const choice = { cellIndex: 1, slotId: 'slot-b', card, copy: 'raw' as const };
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, [choice], s.context, s.catalog);
  assert.equal(result.preview.binders[0].slots[0].inventoryItemId, null);
  assert.notEqual(result.preview.binders[0].slots[1].inventoryItemId, null);
  assert.throws(() =>
    prepareScanDraft(s.snapshot, s.view, s.capture, [{ ...choice, slotId: '' }], s.context, s.catalog),
  );
  assert.throws(
    () => prepareScanDraft(s.snapshot, s.view, s.capture, [choice, choice], s.context, s.catalog),
    /duplicate/,
  );
});

test('raw creation beside graded-only eligible copies stays unsupported', () => {
  const s = setup(),
    card = s.cards[0];
  const graded = syntheticSlotPickerSnapshot().inventory.items.find((i) => i.grading)!;
  s.snapshot.items.push({ ...graded, id: 'graded-copy', identity: { kind: 'card', cardId: card.id, language: 'en' } });
  assert.throws(
    () =>
      prepareScanDraft(
        s.snapshot,
        s.view,
        s.capture,
        [{ cellIndex: 0, slotId: 'slot-a', card, copy: 'raw' }],
        s.context,
        s.catalog,
      ),
    /raw-creation-unavailable/,
  );
  assert.equal(s.snapshot.placements.length, 0);
});

test('two confirmed duplicate printings get distinct raw item IDs in one batch', () => {
  const s = setup();
  const result = prepareScanDraft(
    s.snapshot,
    s.view,
    s.capture,
    [
      { cellIndex: 0, slotId: 'slot-a', card: s.cards[0], copy: 'raw' },
      { cellIndex: 1, slotId: 'slot-b', card: s.cards[0], copy: 'raw' },
    ],
    s.context,
    s.catalog,
  );
  assert.equal(result.preview.placements.length, 2);
  assert.equal(new Set(result.preview.placements.map((p) => p.inventoryItemId)).size, 2);
  assert.equal(result.preview.inventoryRevision, s.snapshot.inventoryRevision + 1);
});

test('cached identity reuses exact eligible raw copy, preserves metadata and never steals placement', () => {
  const s = setup(),
    card = s.cards[0];
  s.snapshot.items.push({
    id: 'cached-raw',
    ownerUserId: s.snapshot.ownerUserId,
    identity: { kind: 'card', cardId: card.id, language: 'en' },
    grading: null,
    acquiredAt: '2026-01-01T00:00:00.000Z',
    version: 7,
  });
  const result = prepareScanDraft(
    s.snapshot,
    s.view,
    s.capture,
    [{ cellIndex: 1, slotId: 'slot-b', card, copy: 'raw' }],
    s.context,
    s.catalog,
  );
  assert.equal(result.preview.placements[0].inventoryItemId, 'cached-raw');
  assert.equal(result.preview.items[0].acquiredAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(
    result.intent.request.commands.map((c) => c.kind),
    ['assign'],
  );
});

test('language and finish constraints need explicit compatible catalog evidence', () => {
  const s = setup(),
    card = { ...s.cards[2], aliasIds: ['trainer-alias'] };
  s.binder.slots[5].target = { kind: 'card', cardId: 'trainer-alias', language: 'en', finish: 'holo' };
  assert.equal(
    scanDestinations(s.snapshot, s.view, card).some((s) => s.id === 'slot-f'),
    false,
  );
  assert.equal(
    scanDestinations(s.snapshot, s.view, card, 'normal').some((s) => s.id === 'slot-f'),
    false,
  );
  assert.equal(
    scanDestinations(s.snapshot, s.view, card, 'holo').some((s) => s.id === 'slot-f'),
    true,
  );
  assert.equal(
    scanDestinations(s.snapshot, s.view, { ...card, language: 'ja' }, 'holo').some((s) => s.id === 'slot-f'),
    false,
  );
});

test('empty and filtered page orders cannot masquerade as a captured actual grid', () => {
  const s = setup();
  assert.throws(() => captureScanDestination(s.snapshot, { ...s.view, pageSlotIds: [] }), /scan-stale/);
  assert.throws(
    () => captureScanDestination(s.snapshot, { ...s.view, pageSlotIds: ['slot-a', 'slot-c'] }),
    /scan-stale/,
  );
  assert.throws(
    () =>
      mapScanCells(s.capture, [
        { index: 0, row: 0, col: 0, occupied: true },
        { index: 0, row: 0, col: 0, occupied: true },
      ]),
    /invalid-scan-cell/,
  );
});

test('explicit recorded graded copy retains exact ID and all private grading fields', () => {
  const s = setup(),
    card = s.cards[0];
  const grading = {
    provider: { kind: 'known' as const, id: 'ace' as const },
    grade: '9',
    scale: null,
    designation: null,
    subgrades: [],
    certificate: 'SYNTHETIC-CERT',
    holder: null,
    label: { variant: 'SYNTHETIC-LABEL', assetIds: ['synthetic-private-asset'] },
  };
  s.snapshot.items.push(
    ...['copy-a', 'copy-b'].map((id) => ({
      id,
      ownerUserId: s.snapshot.ownerUserId,
      identity: { kind: 'card' as const, cardId: card.id, language: 'en' as const },
      grading,
      acquiredAt: null,
      version: 3,
    })),
  );
  const result = prepareScanDraft(
    s.snapshot,
    s.view,
    s.capture,
    [{ cellIndex: 0, slotId: 'slot-b', card, copy: { inventoryItemId: 'copy-b', itemVersion: 3 } }],
    s.context,
    s.catalog,
  );
  assert.equal(result.preview.placements[0].inventoryItemId, 'copy-b');
  assert.deepEqual(result.preview.items.find((i) => i.id === 'copy-b')!.grading, grading);
  assert.throws(
    () =>
      prepareScanDraft(
        s.snapshot,
        s.view,
        s.capture,
        [{ cellIndex: 0, slotId: 'slot-b', card, copy: { inventoryItemId: 'copy-b', itemVersion: 2 } }],
        s.context,
        s.catalog,
      ),
    /copy-choice-required/,
  );
});

test('explicit mixed append preserves reviewer order, original slots and one atomic request', () => {
  const s = setup();
  s.binder.slots[0].wantedCards = [
    { card_id: s.cards[0].id, card_name: 'Synthetic want', added_at: '2026-01-01T00:00:00Z' },
  ];
  s.binder.presetManifest = {
    source: { id: 'synthetic-copy', version: 'v1' },
    name: 'Synthetic copied preset',
    entries: s.binder.slots.map((slot) => ({ id: slot.id, target: slot.target })),
  };
  s.binder.slots.forEach((slot) => {
    slot.presetOrigin = { source: { ...s.binder.presetManifest!.source }, entryId: slot.id };
  });
  const original = structuredClone(s.binder.slots);
  const draft = prepareScanDraft(
    s.snapshot,
    s.view,
    s.capture,
    [
      { cellIndex: 3, slotId: null, append: 'free', card: s.cards[3], copy: 'raw' },
      { cellIndex: 0, slotId: 'slot-a', card: s.cards[0], copy: 'raw' },
      { cellIndex: 1, slotId: null, append: 'card', card: s.cards[2], copy: 'raw' },
    ],
    s.context,
    s.catalog,
  );
  assert.deepEqual(
    draft.intent.request.commands.map((c) => c.kind),
    ['insertAssign', 'assign', 'insertAssign'],
  );
  const inserts = draft.intent.request.commands.filter((c) => c.kind === 'insertAssign');
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].before, null);
  assert.equal(inserts[0].target, null);
  assert.equal(inserts[1].target?.kind, 'card');
  assert.equal(inserts[0].selection?.kind, 'new');
  assert.deepEqual(
    draft.preview.binders[0].slots.slice(original.length).map((s) => s.id),
    inserts.map((c) => c.slotId),
  );
  assert.deepEqual(draft.preview.binders[0].slots.slice(1, original.length), original.slice(1));
  assert.equal(draft.preview.binders[0].layoutRevision, s.binder.layoutRevision + 1);
  assert.deepEqual(draft.preview.binders[0].presetManifest, s.binder.presetManifest);
  assert.deepEqual(draft.preview.binders[0].slots[0].wantedCards, original[0].wantedCards);
  assert.deepEqual(draft.preview.binders[0].slots[0].presetOrigin, original[0].presetOrigin);
  assert.equal(draft.preview.inventoryRevision, s.snapshot.inventoryRevision + 1);
  assert.equal(s.snapshot.items.length, 0);
});

test('empty native binder captures only a genuinely empty complete order and appends no padding', () => {
  const s = setup();
  s.binder.slots = [];
  s.view.pageSlotIds = [];
  const capture = captureScanDestination(s.snapshot, s.view);
  const result = prepareScanDraft(
    s.snapshot,
    s.view,
    capture,
    [{ cellIndex: 5, slotId: null, append: 'free', card: s.cards[3], copy: 'raw' }],
    s.context,
    s.catalog,
  );
  assert.equal(result.preview.binders[0].slots.length, 1);
  assert.equal(result.preview.binders[0].slots[0].target, null);
  assert.equal(mapScanCells(capture, [{ index: 5, row: 1, col: 1, occupied: true }])[0].slotId, null);
});

test('append requires an explicit free/target choice, preserves exact recorded copy and rejects reuse', () => {
  const s = setup(),
    card = s.cards[0];
  s.snapshot.items.push({
    id: 'recorded',
    ownerUserId: s.snapshot.ownerUserId,
    identity: { kind: 'card', cardId: card.id, language: 'en' },
    grading: null,
    acquiredAt: null,
    version: 4,
  });
  const choice = {
    cellIndex: 0,
    slotId: null,
    append: 'free' as const,
    card,
    copy: { inventoryItemId: 'recorded', itemVersion: 4 },
  };
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, [choice], s.context, s.catalog);
  assert.deepEqual(result.intent.request.commands[0], {
    kind: 'insertAssign',
    collectionId: s.view.collectionId,
    slotId: result.preview.binders[0].slots.at(-1)!.id,
    before: null,
    target: null,
    selection: { kind: 'existing', inventoryItemId: 'recorded', itemVersion: 4 },
  });
  assert.throws(
    () => prepareScanDraft(s.snapshot, s.view, s.capture, [{ ...choice, append: undefined }], s.context, s.catalog),
    /unconfirmed/,
  );
  assert.throws(
    () => prepareScanDraft(s.snapshot, s.view, s.capture, [choice, { ...choice, cellIndex: 1 }], s.context, s.catalog),
    /duplicate-scan-copy/,
  );
});

test('append capacity and cumulative order-work refuse the whole batch with smaller-page guidance', () => {
  for (const count of [4096, 4095, 3000]) {
    const s = setup();
    s.binder.slots = Array.from({ length: count }, (_, i) => ({ ...s.binder.slots[3], id: `capacity-${i}` }));
    s.view.pageSlotIds = s.binder.slots.slice(0, 8).map((s) => s.id);
    const capture = captureScanDestination(s.snapshot, s.view);
    const choices = Array.from({ length: count === 4096 ? 1 : 3 }, (_, i) => ({
      cellIndex: i,
      slotId: null,
      append: 'free' as const,
      card: s.cards[3],
      copy: 'raw' as const,
    }));
    assert.throws(() => prepareScanDraft(s.snapshot, s.view, capture, choices, s.context, s.catalog), /smaller page/);
    assert.equal(s.binder.slots.length, count);
    assert.equal(s.snapshot.items.length, 0);
  }
});

test('a full 100-pocket page of new copies is one assign per pocket, inside the command cap', () => {
  const s = setup();
  s.binder.slots = Array.from({ length: 100 }, (_, i) => ({ ...s.binder.slots[3], id: `command-cap-${i}` }));
  s.view.rows = 10;
  s.view.cols = 10;
  s.view.pageSlotIds = s.binder.slots.map((s) => s.id);
  const capture = captureScanDestination(s.snapshot, s.view);
  const draft = prepareScanDraft(
    s.snapshot,
    s.view,
    capture,
    s.binder.slots.map((slot, cellIndex) => ({ cellIndex, slotId: slot.id, card: s.cards[3], copy: 'raw' })),
    s.context,
    s.catalog,
  );
  assert.equal(draft.intent.request.commands.length, 100);
  assert.equal(s.snapshot.items.length, 0);
});

test('append retains graded-only Raw refusal and cannot move an assigned copy', () => {
  const s = setup(),
    card = s.cards[0];
  const graded = syntheticSlotPickerSnapshot().inventory.items.find((i) => i.grading)!;
  s.snapshot.items.push({ ...graded, id: 'graded-copy', identity: { kind: 'card', cardId: card.id, language: 'en' } });
  const choice = { cellIndex: 0, slotId: null, append: 'card' as const, card, copy: 'raw' as const };
  assert.throws(
    () => prepareScanDraft(s.snapshot, s.view, s.capture, [choice], s.context, s.catalog),
    /raw-creation-unavailable/,
  );
  const item = s.snapshot.items[0];
  s.binder.slots[0].inventoryItemId = item.id;
  s.binder.slots[0].status = 'collected';
  s.snapshot.placements.push({
    inventoryItemId: item.id,
    collectionId: s.view.collectionId,
    slotId: 'slot-a',
    version: 0,
  });
  assert.throws(
    () =>
      prepareScanDraft(
        s.snapshot,
        s.view,
        s.capture,
        [{ ...choice, copy: { inventoryItemId: item.id, itemVersion: item.version } }],
        s.context,
        s.catalog,
      ),
    /copy-choice-required/,
  );
});

test('append accepts the exact 100-command and 4096-slot boundaries', () => {
  for (const count of [0, 4095]) {
    const s = setup();
    s.binder.slots = Array.from({ length: count }, (_, i) => ({ ...s.binder.slots[3], id: `boundary-${i}` }));
    s.view.rows = 10;
    s.view.cols = 10;
    s.view.pageSlotIds = s.binder.slots.slice(0, 100).map((s) => s.id);
    const capture = captureScanDestination(s.snapshot, s.view);
    const choices = Array.from({ length: count ? 1 : 100 }, (_, cellIndex) => ({
      cellIndex,
      slotId: null,
      append: 'free' as const,
      card: s.cards[3],
      copy: 'raw' as const,
    }));
    const result = prepareScanDraft(s.snapshot, s.view, capture, choices, s.context, s.catalog);
    assert.equal(result.intent.request.commands.length, choices.length);
    assert.equal(result.preview.binders[0].slots.length, count + choices.length);
    assert.equal(new Set(result.preview.placements.map((p) => p.inventoryItemId)).size, choices.length);
  }
});

test('replacing a filled pocket unassigns the recorded copy and only when explicitly chosen', () => {
  const seed = syntheticSlotPickerSnapshot();
  const snapshot = seed.inventory;
  const binder = snapshot.binders[0];
  const view = {
    ownerUserId: snapshot.ownerUserId,
    collectionId: binder.collectionId,
    sessionId: 'session-a',
    rows: 2,
    cols: 4,
    pageSlotIds: binder.slots.map((s) => s.id),
  };
  const catalog = (id: string) => {
    const card = seed.cards.find((c) => c.id === id);
    return card ? pickerCandidate(card) : undefined;
  };
  const capture = captureScanDestination(snapshot, view);
  const context = {
    source: 'app' as const,
    clientId: null,
    operationId: 'synthetic-replace',
    batchId: null,
    clientOccurredAt: null,
  };
  const item = seed.cards.find((c) => c.id === 'synthetic-item')!;
  const energy = seed.cards.find((c) => c.id === 'synthetic-energy')!;
  // slot-d (free target) records synthetic-energy as item-d.
  assert.equal(scanShowsDifferentCard([item], { kind: 'card', cardId: 'synthetic-energy' }), true);
  assert.equal(scanShowsDifferentCard([item, energy], { kind: 'card', cardId: 'synthetic-energy' }), false);
  assert.equal(scanShowsDifferentCard([], { kind: 'card', cardId: 'synthetic-energy' }), false);
  const choice = { cellIndex: 3, slotId: 'slot-d', card: item, copy: 'raw' as const };
  assert.throws(() => prepareScanDraft(snapshot, view, capture, [choice], context, catalog), /target-mismatch/);
  const result = prepareScanDraft(snapshot, view, capture, [{ ...choice, replace: true }], context, catalog);
  const assign = result.intent.request.commands.find((c) => c.kind === 'assign');
  assert.ok(assign && assign.kind === 'assign');
  assert.equal(assign.occupied, 'unassign');
  assert.equal(assign.destination.slot.inventoryItemId, 'item-d');
  assert.equal(
    result.preview.placements.some((p) => p.inventoryItemId === 'item-d'),
    false,
  );
  assert.ok(result.preview.items.some((i) => i.id === 'item-d'));
  assert.throws(
    () =>
      prepareScanDraft(
        snapshot,
        view,
        capture,
        [{ ...choice, card: energy, copy: { inventoryItemId: 'item-d', itemVersion: 1 }, replace: true }],
        context,
        catalog,
      ),
    /replace-same-card|copy-choice/,
  );
});

test('page fill starts at the tapped pocket, wraps round, skips pockets kept for other cards', () => {
  const s = setup();
  const [snorlaxA, snorlaxB, trainer] = s.cards;
  const choices = planPageFill(s.snapshot, s.view, 'slot-d', [
    { card: trainer },
    { card: snorlaxA },
    { card: snorlaxB },
    { card: trainer },
  ]);
  // From d: trainer takes d, Snorlax A takes e, Snorlax B skips f (kept for the trainer) for g, the second trainer gets f.
  assert.deepEqual(
    choices.map((c) => c.slotId),
    ['slot-d', 'slot-e', 'slot-g', 'slot-f'],
  );
  const result = prepareScanDraft(s.snapshot, s.view, s.capture, choices, s.context, s.catalog);
  assert.equal(result.preview.binders[0].slots.filter((slot) => slot.inventoryItemId !== null).length, 4);
  assert.throws(
    () =>
      planPageFill(
        s.snapshot,
        s.view,
        'slot-a',
        Array.from({ length: 8 }, () => ({ card: trainer })),
      ),
    /page-full/,
  );
});

test('page review of several new cards sends a request the server parser and storage function accept', () => {
  const s = setup();
  const [snorlaxA, snorlaxB, trainer] = s.cards;
  const draft = prepareScanDraft(
    s.snapshot,
    s.view,
    s.capture,
    [
      { cellIndex: 0, slotId: 'slot-a', card: snorlaxA, copy: 'raw' },
      { cellIndex: 1, slotId: 'slot-b', card: snorlaxB, copy: 'raw' },
      { cellIndex: 6, slotId: 'slot-g', card: trainer, copy: 'raw' },
      ...planPageFill(s.snapshot, s.view, 'slot-c', [{ card: trainer }]),
    ],
    s.context,
    s.catalog,
  );
  // Exactly what the queue sends over the wire, read back the way the server reads it.
  const body = JSON.stringify(draft.intent.request);
  const sent = parseInventoryCommand(JSON.parse(body));
  assert.deepEqual(
    sent.commands.map((c) => c.kind),
    ['assign', 'assign', 'assign', 'assign'],
  );
  assertEachEntityOnce(sent.commands);
  assert.equal(draft.preview.placements.length, 4);
});
