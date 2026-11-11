import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogFingerprint, catalogDatabaseIdentity } from '../lib/card-catalog-safety';

test('a stale catalog plan detects changed metadata, added cards and changed sets', () => {
  const snapshot = { cards: [{ id: 'saved', name: 'old', external_ids_json: {} }], sets: [{ id: 'set', name: 'old' }] };
  assert.equal(catalogFingerprint(snapshot), catalogFingerprint(structuredClone(snapshot)));
  assert.notEqual(
    catalogFingerprint(snapshot),
    catalogFingerprint({ ...snapshot, cards: [{ ...snapshot.cards[0], name: 'new' }] }),
  );
  assert.notEqual(
    catalogFingerprint(snapshot),
    catalogFingerprint({ ...snapshot, cards: [...snapshot.cards, { ...snapshot.cards[0], id: 'new' }] }),
  );
  assert.notEqual(
    catalogFingerprint(snapshot),
    catalogFingerprint({ ...snapshot, sets: [{ id: 'set', name: 'new' }] }),
  );
});

test('backup identity distinguishes projects sharing a Supabase pooler host without retaining secrets', () => {
  const first = 'postgresql://project_a:secret@shared-pooler.test:5432/postgres';
  const second = 'postgresql://project_b:secret@shared-pooler.test:5432/postgres';
  assert.notEqual(catalogDatabaseIdentity(first), catalogDatabaseIdentity(second));
  assert.equal(catalogDatabaseIdentity(first), catalogDatabaseIdentity(first.replace('secret', 'rotated')));
  assert.equal(catalogDatabaseIdentity(first).length, 64);
});
