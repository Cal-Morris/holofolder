import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceCardRows } from '../lib/card-db-source-import';

// Synthetic source fixture, not a real card.
const source = {
  set: {
    id: 'TEST',
    name: { ja: '合成セット' },
    serie: { id: 'TEST-S', name: { ja: '合成' } },
    cardCount: { official: 1 },
    releaseDate: { ja: '2020-01-01' },
  },
  name: { ja: '合成カード' },
  variants: [{ type: 'holo' }],
  dexId: [460],
};
test('keeps Japanese identity, explicit finishes, image evidence and source provenance', () => {
  const result = buildSourceCardRows(source, '001', 'ja', 'abc123', true);
  assert.equal(result.card.id, 'TEST-001');
  assert.deepEqual(result.card.name_json, { ja: '合成カード' });
  assert.equal(result.card.name_en, '合成カード');
  assert.deepEqual(result.card.image_languages_json, ['ja']);
  assert.equal(result.card.variants_json.holo, true);
  assert.equal(result.card.variants_json.normal, false);
  assert.equal(result.set.release_date, '2020-01-01');
  assert.deepEqual(result.dexLinks, [{ card_id: 'TEST-001', dex_id: 460 }]);
  assert.equal(result.card.raw_json.sourceCommit, 'abc123');
  assert.equal(result.card.external_ids_json.catalog, undefined);
});
test('never fabricates an image or language and rejects invalid source identity', () => {
  const result = buildSourceCardRows(source, '001', 'ja', 'abc123', false);
  assert.deepEqual(result.card.image_languages_json, []);
  assert.equal((result.card.external_ids_json.tcgdex as Record<string, unknown>)?.image, undefined);
  assert.throws(() => buildSourceCardRows({ ...source, name: { en: 'Synthetic' } }, '001', 'ja', 'abc', false));
  assert.throws(() => buildSourceCardRows(source, '../001', 'ja', 'abc', false));
});

test('rejects reuse of a set ID for a different regional release', async () => {
  const { hasSourceSetConflict } = await import('../lib/card-db-source-import');
  const row = buildSourceCardRows(source, '001', 'ja', 'abc', false).set;
  assert.equal(hasSourceSetConflict({ ...row, official_card_count: 111, release_date: '1999-01-01' }, row), true);
  assert.equal(hasSourceSetConflict(row, row), false);
});

test('retains all attested names without declaring unverified image languages', () => {
  const localized = { ...source, name: { en: 'Synthetic card', ja: '合成カード' } };
  const row = buildSourceCardRows(localized, '001', 'ja', 'abc', false, 'data/Synthetic/TEST/001.ts');
  assert.deepEqual(row.card.name_json, localized.name);
  assert.equal(row.card.name_en, 'Synthetic card');
  assert.deepEqual(row.card.image_languages_json, []);
  assert.equal(row.card.raw_json.sourcePath, 'data/Synthetic/TEST/001.ts');
});
