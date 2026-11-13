import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFingerprintManifest,
  cosine,
  decodeFingerprintFiles,
  encodeFingerprintFiles,
  fingerprintImageKeys,
  l2Normalize,
  parseFingerprintManifest,
  pickStoredKey,
  planFingerprintUpdate,
  quantizeInt8,
  type FingerprintCard,
  type FingerprintEntry,
} from '../lib/card-assets/fingerprints';

// Synthetic fixtures: card ids, keys, ETags and vectors below are made up for these tests.
const DIM = 4;
const entry = (id: string, key = `k/${id}`, etag = 'e1', values = [1, 2, 3, 4]): FingerprintEntry => ({
  id,
  key,
  etag,
  vector: quantizeInt8(l2Normalize(values)),
});
const card = (overrides: Partial<FingerprintCard>): FingerprintCard => ({
  id: 'zz1-001',
  set_id: 'zz1',
  series_id: 'zz',
  local_id: '001',
  name_json: { en: 'Synthetic' },
  image_languages_json: ['en'],
  external_ids_json: {},
  ...overrides,
});

describe('quantizeInt8', () => {
  test('keeps the direction of a unit vector (cosine above 0.999)', () => {
    const vector = l2Normalize(Array.from({ length: 384 }, (_, i) => Math.sin(i * 1.7) * (i % 7 === 0 ? 3 : 1)));
    const quantized = quantizeInt8(vector);
    assert.equal(Math.max(...quantized.map(Math.abs)), 127);
    assert.ok(cosine(quantized, vector) > 0.999);
  });

  test('leaves a zero vector at zero', () => {
    assert.deepEqual([...quantizeInt8([0, 0, 0])], [0, 0, 0]);
  });
});

describe('fingerprint files', () => {
  test('round-trip in card id order, with a stable content-hashed name', () => {
    const rows = [entry('b', 'k/b', 'e2', [-1, 0, 0.5, 0.25]), entry('a')];
    const { info, files } = encodeFingerprintFiles('en', rows, DIM);
    assert.match(info.vectors, /^en-[0-9a-f]{16}\.bin$/);
    assert.equal(info.ids, info.vectors.replace('.bin', '.ids.json'));
    assert.equal(info.count, 2);
    assert.equal(files[info.vectors].byteLength, 2 * DIM);
    assert.equal(info.bytes, files[info.vectors].byteLength + files[info.ids].byteLength);
    const text = new TextDecoder();
    const decoded = decodeFingerprintFiles(
      files[info.vectors],
      text.decode(files[info.ids]),
      text.decode(files[info.sources]),
      DIM,
    );
    assert.deepEqual(
      decoded.map((row) => [row.id, row.key, row.etag, [...row.vector]]),
      [...rows].reverse().map((row) => [row.id, row.key, row.etag, [...row.vector]]),
    );
    assert.equal(encodeFingerprintFiles('en', [...rows].reverse(), DIM).info.vectors, info.vectors);
    assert.notEqual(encodeFingerprintFiles('en', [rows[1]], DIM).info.vectors, info.vectors);
  });

  test('refuse misaligned files', () => {
    assert.throws(() => decodeFingerprintFiles(new Uint8Array(DIM), '["a","b"]', '[["k","e"],["k","e"]]', DIM));
    assert.throws(() => decodeFingerprintFiles(new Uint8Array(DIM), '["a"]', '[]', DIM));
    assert.throws(() => encodeFingerprintFiles('en', [{ ...entry('a'), vector: new Int8Array(3) }], DIM));
  });

  test('manifest round-trips and rejects other models or odd file names', () => {
    const { info } = encodeFingerprintFiles('ja', [entry('a')], DIM);
    const manifest = buildFingerprintManifest({ ja: info }, new Date('2026-11-12T00:00:00Z'));
    assert.deepEqual(parseFingerprintManifest(structuredClone(manifest)), manifest);
    assert.equal(manifest.builtAt, '2026-11-12T00:00:00.000Z');
    assert.equal(parseFingerprintManifest({ ...manifest, model: { ...manifest.model, id: 'other/model' } }), null);
    assert.equal(parseFingerprintManifest({ ...manifest, languages: { ja: { ...info, vectors: '../x.bin' } } }), null);
  });
});

describe('planFingerprintUpdate', () => {
  const previous = [entry('a'), entry('b'), entry('gone')];

  test('embeds only new cards and cards whose image object changed', () => {
    const plan = planFingerprintUpdate(
      [
        { id: 'a', key: 'k/a' },
        { id: 'b', key: 'k/b-new' },
        { id: 'c', key: 'k/c' },
      ],
      previous,
    );
    assert.deepEqual(
      plan.keep.map((row) => row.id),
      ['a'],
    );
    assert.deepEqual(
      plan.embed.map((want) => want.id),
      ['b', 'c'],
    );
    assert.deepEqual(plan.dropped, ['gone']);
  });

  test('re-embeds when a rechecked ETag differs', () => {
    const plan = planFingerprintUpdate([{ id: 'a', key: 'k/a' }], previous, { etags: new Map([['k/a', 'e2']]) });
    assert.deepEqual(
      plan.embed.map((want) => want.id),
      ['a'],
    );
  });

  test('--set leaves other sets alone', () => {
    const plan = planFingerprintUpdate(
      [
        { id: 'a', key: 'k/a-new' },
        { id: 'x', key: 'k/x' },
      ],
      previous,
      { inScope: (id) => id === 'x' },
    );
    assert.deepEqual(
      plan.keep.map((row) => row.id),
      ['a'],
    );
    assert.deepEqual(
      plan.embed.map((want) => want.id),
      ['x'],
    );
  });
});

describe('fingerprintImageKeys', () => {
  test('uses the TCGdex print in the language, low rendition first', () => {
    const keys = fingerprintImageKeys(card({}), 'en');
    assert.equal(keys[0], 'pokemon/tcg/cards/en/zz1/001/low.webp');
    assert.ok(
      keys.indexOf('pokemon/tcg/cards/en/zz1/001/high.webp') > keys.indexOf('pokemon/tcg/cards/en/zz1/001/low.jpg'),
    );
    assert.equal(
      fingerprintImageKeys(card({ name_json: { ja: 'x' }, image_languages_json: ['ja'] }), 'ja')[0],
      'pokemon/tcg/cards/ja/zz1/001/low.webp',
    );
  });

  test('prefers the TCGdex print over a published render, then falls back to the source image the app shows', () => {
    const published = {
      assets: {
        en: { image: 'https://cdn.malie.io/file/malie-io/tcgl/cards/png/en/zz1/zz1_en_001_std.png' },
      },
    };
    const keys = fingerprintImageKeys(card({ external_ids_json: published }), 'en');
    assert.equal(keys[0], 'pokemon/tcg/cards/en/zz1/001/low.webp');
    assert.deepEqual(keys.slice(-2), [
      'pokemon/tcg/cards/src/malie/tcgl/zz1/zz1_en_001_std.low.webp',
      'pokemon/tcg/cards/src/malie/tcgl/zz1/zz1_en_001_std.webp',
    ]);
  });

  test('never uses a print in another language', () => {
    const pokemonCom = {
      pokemoncom: {
        image: 'https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/ZZ1/ZZ1_EN_1.png',
      },
    };
    const keys = fingerprintImageKeys(card({ image_languages_json: ['fr'], external_ids_json: pokemonCom }), 'en');
    assert.equal(keys.at(-2), 'pokemon/tcg/cards/src/pokemoncom/ZZ1/ZZ1_EN_1.low.webp');
    assert.ok(!keys.some((key) => key.includes('/fr/')));
    assert.ok(!fingerprintImageKeys(card({ image_languages_json: ['fr'] }), 'en').some((key) => key.includes('/fr/')));
  });

  test('pickStoredKey takes the first key the bucket holds', () => {
    const keys = fingerprintImageKeys(card({}), 'en');
    assert.equal(pickStoredKey(keys, new Set([keys[3], keys[1]])), keys[1]);
    assert.equal(pickStoredKey(keys, new Set()), null);
  });
});
